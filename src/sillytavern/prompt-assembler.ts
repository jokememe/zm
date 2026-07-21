/**
 * Prompt Assembler — flat prompt_order + prompts[] + WI + 变量
 * 须先 normalize（assemble 内会再 normalize 一次保证契约）
 */

import type { ChatPreset, Lorebook, ChatMessage, MatchedEntry, LorebookEntry } from './types'
import { createLorebookEngine } from './lorebook-engine'
import { formatVariablesForPrompt } from './variables'
import {
  normalizePresetSettings,
  isFullStPreset,
  type FlatPromptOrderItem,
  type NormalizedPromptBlock,
} from './preset-normalize'
import { applyPromptRegex, extractRegexScripts, type RegexScript } from './regex-scripts'

export interface AssembleOptions {
  userInput: string
  history: ChatMessage[]
  preset: ChatPreset
  lorebooks: Lorebook[]
  userName: string
  characterName: string
  variables?: Record<string, string | number>
  extraVariables?: Record<string, any>
  formatPrompt?: string
  /** 默认：完整 ST 预设仍追加游戏 format（宗门气数标签）；可关 */
  appendFormatPrompt?: boolean
}

export interface AssembleResult {
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  matchedEntries: MatchedEntry[]
  systemPrompt: string
  normalizedSettings?: Record<string, unknown>
}

const BEFORE_POSITIONS = new Set<LorebookEntry['position']>([
  'before_char',
  'before_example',
  'example_msg_top',
])
const AFTER_POSITIONS = new Set<LorebookEntry['position']>([
  'after_char',
  'after_example',
  'example_msg_bottom',
  'at_depth',
  'outlet',
])

export function assemblePrompt(options: AssembleOptions): AssembleResult {
  const {
    userInput,
    history,
    preset,
    lorebooks,
    userName,
    characterName,
    variables,
    extraVariables,
    formatPrompt,
  } = options

  const settings = normalizePresetSettings((preset.settings || {}) as Record<string, unknown>)
  const scripts = extractRegexScripts(settings) as RegexScript[]
  const fullSt = isFullStPreset(settings)
  // 完整 ST 仍追加 format（宗门结算依赖标签）；若调用方显式 false 则不追加
  const appendFormat =
    options.appendFormatPrompt !== undefined
      ? options.appendFormatPrompt
      : true

  const allMatchedEntries: MatchedEntry[] = []
  const scanText = userInput + ' ' + history.slice(-4).map((m) => m.content).join(' ')

  for (const book of lorebooks) {
    const engine = createLorebookEngine(book)
    const matches = engine.recursiveScan(scanText, 3)
    allMatchedEntries.push(...matches)
  }

  const uniqueEntries = Array.from(
    new Map(allMatchedEntries.map((e) => [e.entry.id, e])).values(),
  ).sort((a, b) => (a.entry.order ?? 0) - (b.entry.order ?? 0) || b.score - a.score)

  const wiFormat =
    typeof settings.wi_format === 'string' && settings.wi_format.trim()
      ? settings.wi_format
      : '{0}'

  function formatWi(entries: MatchedEntry[]): string {
    if (!entries.length) return ''
    return entries
      .map((e) => wiFormat.replace('{0}', e.entry.content))
      .join('\n\n')
  }

  const maxContextTokens =
    (settings.openai_max_context as number) ||
    (settings.max_length as number) ||
    8192
  let currentTokens = 0

  const recentHistory: { role: 'system' | 'user' | 'assistant'; content: string }[] = []
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i]
    if (msg.role === 'system') continue
    let content = msg.content
    content = applyPromptRegex(content, scripts, msg.role === 'user')
    const msgTokens = content.length / 4
    if (currentTokens + msgTokens > maxContextTokens * 0.75) break
    recentHistory.unshift({ role: msg.role, content })
    currentTokens += msgTokens
  }

  const promptOrder = (settings.prompt_order || []) as FlatPromptOrderItem[]
  const prompts = (settings.prompts || []) as NormalizedPromptBlock[]
  const promptMap = new Map(prompts.map((p) => [p.identifier, p]))

  function resolvePromptContent(identifier: string): string | null {
    if (identifier === 'worldInfoBefore') {
      const entries = uniqueEntries.filter(
        (e) => e.entry.constant || BEFORE_POSITIONS.has(e.entry.position),
      )
      const text = formatWi(entries)
      return text || null
    }
    if (identifier === 'worldInfoAfter') {
      const entries = uniqueEntries.filter(
        (e) => !e.entry.constant && AFTER_POSITIONS.has(e.entry.position),
      )
      const text = formatWi(entries)
      return text || null
    }

    if (identifier === 'charDescription') {
      return (
        (settings.character_description as string) ||
        (settings.description as string) ||
        null
      )
    }
    if (identifier === 'charPersonality') {
      return (
        (settings.character_personality as string) ||
        (settings.personality as string) ||
        null
      )
    }
    if (identifier === 'scenario') {
      return (settings.scenario as string) || null
    }
    if (identifier === 'personaDescription') {
      return (settings.persona_description as string) || null
    }
    if (identifier === 'dialogueExamples') {
      return (
        (settings.dialogue_examples as string) ||
        (settings.mes_example as string) ||
        null
      )
    }
    if (identifier === 'groupNudge') {
      return (settings.group_nudge_prompt as string) || null
    }
    if (identifier === 'impersonate') {
      return (settings.impersonation_prompt as string) || null
    }
    if (identifier === 'quietPrompt') {
      return (settings.quiet_prompt as string) || null
    }
    if (identifier === 'bias') return null

    const custom = promptMap.get(identifier)
    if (custom) {
      if (custom.enabled === false) return null
      // marker 且无内容：动态位（chatHistory 等已单独处理）
      if (custom.marker && !custom.content?.trim()) return null
      if (custom.content?.trim()) return custom.content
    }

    const direct = settings[identifier]
    if (typeof direct === 'string' && direct.trim()) return direct
    return null
  }

  const assembledMessages: { role: 'system' | 'user' | 'assistant'; content: string }[] = []
  let systemAccumulator = ''
  let hasChatHistory = false
  let wiBeforeUsed = false

  for (const item of promptOrder) {
    if (item.enabled === false) continue

    if (item.identifier === 'chatHistory') {
      hasChatHistory = true
      if (systemAccumulator) {
        assembledMessages.push({ role: 'system', content: systemAccumulator })
        systemAccumulator = ''
      }
      assembledMessages.push(...recentHistory)
      continue
    }

    let rawContent = resolvePromptContent(item.identifier)
    if (item.identifier === 'worldInfoBefore' && rawContent) wiBeforeUsed = true
    // after 且 before 已塞了全量 constant-only 重复时允许空
    if (!rawContent) continue

    let content = replaceMacros(rawContent, {
      userName,
      characterName,
      userInput,
      variables,
    })
    if (!content.trim()) continue

    const fromPrompt = promptMap.get(item.identifier)
    const role = (item.role || fromPrompt?.role || 'system') as
      | 'system'
      | 'user'
      | 'assistant'

    if (role === 'system') {
      systemAccumulator += (systemAccumulator ? '\n\n' : '') + content
    } else {
      if (systemAccumulator) {
        assembledMessages.push({ role: 'system', content: systemAccumulator })
        systemAccumulator = ''
      }
      assembledMessages.push({ role, content })
    }
  }

  // 深度注入：injection_position === 1 的块插入历史末尾前
  const depthInjections = prompts.filter(
    (p) =>
      p.enabled !== false &&
      p.injection_position === 1 &&
      p.content?.trim() &&
      !promptOrder.some((o) => o.identifier === p.identifier && o.enabled !== false),
  )
  if (depthInjections.length && hasChatHistory) {
    // 已在 history 段后处理：追加到 system
    for (const d of depthInjections) {
      const c = replaceMacros(d.content || '', {
        userName,
        characterName,
        userInput,
        variables,
      })
      if (c.trim()) {
        systemAccumulator += (systemAccumulator ? '\n\n' : '') + c
      }
    }
  }

  const variablesBlock = formatVariablesForPrompt(variables || {})
  if (variablesBlock) {
    systemAccumulator += (systemAccumulator ? '\n\n' : '') + variablesBlock
  }
  if (extraVariables && Object.keys(extraVariables).length > 0) {
    const extraBlock = formatVariablesForPrompt(extraVariables)
    if (extraBlock) {
      systemAccumulator += (systemAccumulator ? '\n\n' : '') + extraBlock
    }
  }

  if (appendFormat && formatPrompt) {
    // 完整 ST 也追加：保证 maintext/vars 结算；标注目的避免 silently drop
    systemAccumulator +=
      (systemAccumulator ? '\n\n' : '') +
      (fullSt ? `【宗门结算格式】\n${formatPrompt}` : formatPrompt)
  }

  if (systemAccumulator) {
    // 插到最前，保持 ST 习惯：system 在历史前
    assembledMessages.unshift({ role: 'system', content: systemAccumulator })
  }

  if (!hasChatHistory) {
    assembledMessages.push(...recentHistory)
  }

  // worldInfo 若 order 未引用，保底注入
  if (!wiBeforeUsed && uniqueEntries.length) {
    const wi = formatWi(uniqueEntries)
    if (wi) {
      const sys = assembledMessages.find((m) => m.role === 'system')
      if (sys) sys.content = wi + '\n\n' + sys.content
      else assembledMessages.unshift({ role: 'system', content: wi })
    }
  }

  let finalUser = applyPromptRegex(userInput, scripts, true)
  assembledMessages.push({ role: 'user', content: finalUser })

  const systemPrompt = assembledMessages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n')

  return {
    messages: assembledMessages,
    matchedEntries: uniqueEntries,
    systemPrompt,
    normalizedSettings: settings,
  }
}

interface MacroContext {
  userName: string
  characterName: string
  userInput: string
  variables?: Record<string, string | number>
}

export function replaceMacros(template: string, context: MacroContext): string {
  let result = template
    .replace(/\{\{user\}\}/gi, context.userName)
    .replace(/\{\{char\}\}/gi, context.characterName)
    .replace(/\{\{original\}\}/gi, context.userInput)
    .replace(/\{\{newline\}\}/gi, '\n')

  if (context.variables) {
    for (const [key, value] of Object.entries(context.variables)) {
      const v = String(value)
      result = result.replace(new RegExp(`\\{\\{${escapeRegExp(key)}\\}\\}`, 'g'), v)
      result = result.replace(
        new RegExp(`\\{\\{getvar::${escapeRegExp(key)}\\}\\}`, 'gi'),
        v,
      )
      result = result.replace(
        new RegExp(`\\{\\{getglobalvar::${escapeRegExp(key)}\\}\\}`, 'gi'),
        v,
      )
    }
  }

  // 未解析 getvar 置空，避免漏出宏
  result = result.replace(/\{\{getvar::[^}]+\}\}/gi, '')
  result = result.replace(/\{\{getglobalvar::[^}]+\}\}/gi, '')

  return result
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
