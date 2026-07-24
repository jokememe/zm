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
  /**
   * 至少保留最近 N 条 user/assistant（近端优先）。
   * 0 = 仅按 token 预算；默认由调用方从 settings.historyKeepMessages 传入。
   */
  historyKeepMessages?: number
}

/** 粗估 token（与现有拼装一致：字数/4） */
export function estimateTokensRough(text: string): number {
  return Math.max(0, String(text || '').length / 4)
}

/**
 * 从会话历史选出注入 prompt 的近期消息。
 * - keepMessages &gt; 0：先锁定最近 N 条（近端必留）
 * - 再在 token 预算内尽量向前多装旧消息
 * - system 角色跳过
 */
export function selectRecentHistory(
  history: ChatMessage[],
  opts: {
    maxContextTokens?: number
    budgetRatio?: number
    keepMessages?: number
    transformContent?: (content: string, role: string) => string
  } = {},
): { role: 'user' | 'assistant'; content: string }[] {
  const maxContextTokens = opts.maxContextTokens ?? 8192
  const budgetRatio = opts.budgetRatio ?? 0.75
  const budget = Math.max(256, maxContextTokens * budgetRatio)
  const keep = Math.max(0, Math.min(64, Math.round(opts.keepMessages ?? 0)))
  const transform =
    opts.transformContent ?? ((c: string) => c)

  type Row = { role: 'user' | 'assistant'; content: string; tokens: number }
  const candidates: Row[] = []
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i]
    if (msg.role !== 'user' && msg.role !== 'assistant') continue
    const content = transform(msg.content, msg.role)
    candidates.push({
      role: msg.role,
      content,
      tokens: estimateTokensRough(content),
    })
  }
  // candidates[0] = 最新

  const selected: Row[] = []
  let used = 0

  for (let i = 0; i < candidates.length; i++) {
    const row = candidates[i]
    const withinKeep = keep > 0 && selected.length < keep
    if (withinKeep) {
      selected.push(row)
      used += row.tokens
      continue
    }
    // 超出保底条数后：仅 token 预算允许才继续装更旧的
    if (used + row.tokens > budget) break
    selected.push(row)
    used += row.tokens
  }

  // selected 仍是新→旧，反转为时间正序
  return selected.reverse().map(({ role, content }) => ({ role, content }))
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
  const keepMessages =
    typeof options.historyKeepMessages === 'number' && Number.isFinite(options.historyKeepMessages)
      ? Math.max(0, Math.min(64, Math.round(options.historyKeepMessages)))
      : 12

  const recentHistory = selectRecentHistory(history, {
    maxContextTokens,
    budgetRatio: 0.75,
    keepMessages,
    transformContent: (content, role) =>
      applyPromptRegex(content, scripts, role === 'user'),
  })

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
