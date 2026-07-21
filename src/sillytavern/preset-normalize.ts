/**
 * ST OpenAI 预设归一化契约（完整导入用）
 */

import { extractRegexScripts, type RegexScript } from './regex-scripts'
import { DEFAULT_PROMPT_ORDER } from './types'

export interface FlatPromptOrderItem {
  identifier: string
  enabled: boolean
  role?: 'system' | 'user' | 'assistant' | string
  name?: string
}

export interface NormalizedPromptBlock {
  identifier: string
  name?: string
  role?: string
  content?: string
  enabled?: boolean
  marker?: boolean
  system_prompt?: boolean
  injection_position?: number
  injection_depth?: number
  forbid_overrides?: boolean
  [key: string]: unknown
}

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `p-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** ST role 数字 → 字符串 */
export function normalizeRole(role: unknown): 'system' | 'user' | 'assistant' {
  if (role === 0 || role === '0' || role === 'system') return 'system'
  if (role === 1 || role === '1' || role === 'user') return 'user'
  if (role === 2 || role === '2' || role === 'assistant') return 'assistant'
  if (typeof role === 'string') {
    const r = role.toLowerCase()
    if (r === 'user' || r === 'assistant' || r === 'system') return r
  }
  return 'system'
}

function isNestedPromptOrder(raw: unknown): boolean {
  if (!Array.isArray(raw) || raw.length === 0) return false
  const first = raw[0] as Record<string, unknown>
  return first != null && typeof first === 'object' && Array.isArray(first.order)
}

function isFlatPromptOrder(raw: unknown): boolean {
  if (!Array.isArray(raw) || raw.length === 0) return false
  const first = raw[0] as Record<string, unknown>
  return (
    first != null &&
    typeof first === 'object' &&
    typeof first.identifier === 'string' &&
    !Array.isArray(first.order)
  )
}

/** 列出嵌套 order 的 character_id 组（UI 切换用） */
export function listPromptOrderGroups(
  raw: unknown,
): Array<{ character_id: number; length: number }> {
  let source = raw
  if (!isNestedPromptOrder(source) && source && typeof source === 'object') {
    const nested = (source as Record<string, unknown>)._raw_prompt_order
    if (isNestedPromptOrder(nested)) source = nested
  }
  if (!isNestedPromptOrder(source)) return []
  const groups = source as Array<{ character_id?: number; order?: unknown[] }>
  return groups.map((g) => ({
    character_id: typeof g.character_id === 'number' ? g.character_id : -1,
    length: Array.isArray(g.order) ? g.order.length : 0,
  }))
}

function pickNestedGroup(
  groups: Array<{ character_id?: number; order?: Array<Record<string, unknown>> }>,
  preferCharacterId?: number | null,
) {
  if (preferCharacterId != null) {
    const hit = groups.find((g) => g.character_id === preferCharacterId)
    if (hit) return hit
  }
  return (
    groups.find((g) => g.character_id === 100001) ||
    groups.find((g) => g.character_id === 100000) ||
    groups.reduce((best, g) => {
      const bl = best.order?.length ?? 0
      const gl = g.order?.length ?? 0
      return gl > bl ? g : best
    }, groups[0])
  )
}

/** ST 嵌套 order → flat */
export function flattenPromptOrder(
  raw: unknown,
  preferCharacterId?: number | null,
): FlatPromptOrderItem[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return DEFAULT_PROMPT_ORDER.map((p) => ({
      identifier: p.identifier,
      enabled: true,
      name: p.name,
      role: p.role,
    }))
  }

  if (isFlatPromptOrder(raw)) {
    return (raw as Array<Record<string, unknown>>).map((item) => ({
      identifier: String(item.identifier),
      enabled: item.enabled !== false,
      role: item.role !== undefined ? normalizeRole(item.role) : undefined,
      name: typeof item.name === 'string' ? item.name : undefined,
    }))
  }

  if (!isNestedPromptOrder(raw)) {
    return (raw as Array<Record<string, unknown>>)
      .filter((x) => x && typeof x.identifier === 'string')
      .map((item) => ({
        identifier: String(item.identifier),
        enabled: item.enabled !== false,
        role: item.role !== undefined ? normalizeRole(item.role) : undefined,
        name: typeof item.name === 'string' ? item.name : undefined,
      }))
  }

  const groups = raw as Array<{
    character_id?: number
    order?: Array<Record<string, unknown>>
  }>
  const pick = pickNestedGroup(groups, preferCharacterId)
  const order = pick?.order ?? []
  return order
    .filter((item) => item && typeof item.identifier === 'string')
    .map((item) => ({
      identifier: String(item.identifier),
      enabled: item.enabled !== false,
      role: item.role !== undefined ? normalizeRole(item.role) : undefined,
      name: typeof item.name === 'string' ? item.name : undefined,
    }))
}

export function normalizePromptsArray(raw: unknown): NormalizedPromptBlock[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((p) => p && typeof p === 'object')
    .map((p) => {
      const o = p as Record<string, unknown>
      const identifier = String(o.identifier ?? o.id ?? cryptoRandomId())
      let content = ''
      if (typeof o.content === 'string') content = o.content
      else if (typeof o.prompt === 'string') content = o.prompt
      else if (typeof o.injection === 'string') content = o.injection

      return {
        ...o,
        identifier,
        name: typeof o.name === 'string' && o.name.trim() ? o.name : undefined,
        role: normalizeRole(o.role ?? 'system'),
        content,
        // 同步回 content，方便 ST 字段统一
        prompt: content,
        enabled: o.enabled !== false,
        marker: !!(o.marker || o.system_prompt === true && !content),
        system_prompt: !!o.system_prompt,
        injection_position:
          typeof o.injection_position === 'number' ? o.injection_position : undefined,
        injection_depth: typeof o.injection_depth === 'number' ? o.injection_depth : undefined,
        forbid_overrides: !!o.forbid_overrides,
      } as NormalizedPromptBlock
    })
}

const TOP_LEVEL_FROM_PROMPT: Array<{ field: string; identifiers: string[] }> = [
  { field: 'main', identifiers: ['main', 'mainPrompt'] },
  { field: 'nsfw', identifiers: ['nsfw', 'nsfwPrompt'] },
  { field: 'jailbreak', identifiers: ['jailbreak', 'jailbreakPrompt'] },
  { field: 'enhanceDefinitions', identifiers: ['enhanceDefinitions'] },
  { field: 'impersonation_prompt', identifiers: ['impersonate', 'impersonation_prompt'] },
  { field: 'new_chat_prompt', identifiers: ['newChat', 'new_chat_prompt'] },
  { field: 'continue_nudge_prompt', identifiers: ['continueNudge', 'continue_nudge_prompt'] },
  { field: 'wi_format', identifiers: ['wiFormat', 'wi_format'] },
  { field: 'scenario', identifiers: ['scenario'] },
  { field: 'personality', identifiers: ['charPersonality', 'personality'] },
]

export function applySamplingAliases(settings: Record<string, unknown>): void {
  const map: Array<[string, string]> = [
    ['temperature', 'temp_openai'],
    ['temp', 'temp_openai'],
    ['max_tokens', 'openai_max_tokens'],
    ['max_length', 'openai_max_tokens'],
    ['top_p', 'top_p_openai'],
    ['top_k', 'top_k_openai'],
    ['frequency_penalty', 'freq_pen_openai'],
    ['presence_penalty', 'pres_pen_openai'],
    ['repetition_penalty', 'repetition_penalty_openai'],
    ['model', 'openai_model'],
    ['stream', 'stream_openai'],
  ]
  for (const [from, to] of map) {
    if (settings[to] === undefined && settings[from] !== undefined) {
      settings[to] = settings[from]
    }
  }
  // 数值钳制
  if (typeof settings.temp_openai === 'number') {
    settings.temp_openai = Math.min(2, Math.max(0, settings.temp_openai))
  }
  if (typeof settings.openai_max_tokens === 'number') {
    settings.openai_max_tokens = Math.max(1, Math.round(settings.openai_max_tokens as number))
  }
}

function backfillTopLevelFromPrompts(
  settings: Record<string, unknown>,
  prompts: NormalizedPromptBlock[],
): void {
  for (const { field, identifiers } of TOP_LEVEL_FROM_PROMPT) {
    const cur = settings[field]
    if (typeof cur === 'string' && cur.trim()) continue
    const hit = prompts.find(
      (p) => identifiers.includes(p.identifier) && typeof p.content === 'string' && p.content.trim(),
    )
    if (hit?.content) settings[field] = hit.content
  }
}

/** flat order 补全 name（来自 prompts） */
function enrichOrderNames(
  order: FlatPromptOrderItem[],
  prompts: NormalizedPromptBlock[],
): FlatPromptOrderItem[] {
  return order.map((item) => {
    if (item.name?.trim()) return item
    const p = prompts.find((x) => x.identifier === item.identifier)
    if (p?.name) return { ...item, name: p.name, role: item.role || p.role }
    const builtIn = DEFAULT_PROMPT_ORDER.find((x) => x.identifier === item.identifier)
    if (builtIn?.name) return { ...item, name: builtIn.name, role: item.role || builtIn.role }
    return item
  })
}

/**
 * 若 order 为空但有 prompts，用默认骨架 + 自定义块拼一条可用顺序
 */
function ensureOrderFromPrompts(
  order: FlatPromptOrderItem[],
  prompts: NormalizedPromptBlock[],
): FlatPromptOrderItem[] {
  if (order.length > 0) {
    // 把 prompts 里有、order 里没有的自定义块追加到 history 前
    const known = new Set(order.map((o) => o.identifier))
    const extras = prompts
      .filter((p) => !known.has(p.identifier) && !p.marker && p.content?.trim())
      .map((p) => ({
        identifier: p.identifier,
        enabled: p.enabled !== false,
        name: p.name,
        role: p.role,
      }))
    if (!extras.length) return order
    const histIdx = order.findIndex((o) => o.identifier === 'chatHistory')
    if (histIdx >= 0) {
      return [...order.slice(0, histIdx), ...extras, ...order.slice(histIdx)]
    }
    return [...order, ...extras]
  }
  if (!prompts.length) {
    return flattenPromptOrder(null)
  }
  const base = flattenPromptOrder(null)
  const custom = prompts
    .filter((p) => !base.some((b) => b.identifier === p.identifier))
    .map((p) => ({
      identifier: p.identifier,
      enabled: p.enabled !== false,
      name: p.name,
      role: p.role,
    }))
  const histIdx = base.findIndex((o) => o.identifier === 'chatHistory')
  if (histIdx >= 0) {
    return [...base.slice(0, histIdx), ...custom, ...base.slice(histIdx)]
  }
  return [...base, ...custom]
}

export function mergeFlatEnabledIntoRaw(
  raw: unknown,
  flat: FlatPromptOrderItem[],
): unknown {
  if (!isNestedPromptOrder(raw)) return raw
  const enabledMap = new Map(flat.map((f) => [f.identifier, f.enabled]))
  const groups = JSON.parse(JSON.stringify(raw)) as Array<{
    character_id?: number
    order?: Array<{ identifier: string; enabled?: boolean }>
  }>
  for (const g of groups) {
    if (!Array.isArray(g.order)) continue
    for (const item of g.order) {
      if (enabledMap.has(item.identifier)) {
        item.enabled = enabledMap.get(item.identifier)
      }
    }
  }
  return groups
}

export function normalizePresetSettings(
  rawInput: Record<string, unknown> | null | undefined,
  opts?: { flatIsAuthoritative?: boolean; preferCharacterId?: number | null },
): Record<string, unknown> {
  const raw = rawInput && typeof rawInput === 'object' ? { ...rawInput } : {}
  const settings: Record<string, unknown> = { ...raw }

  const existingOrder = settings.prompt_order
  const preferId =
    opts?.preferCharacterId ??
    (typeof settings._active_character_id === 'number'
      ? (settings._active_character_id as number)
      : null)

  if (isNestedPromptOrder(existingOrder)) {
    if (!settings._raw_prompt_order) {
      settings._raw_prompt_order = existingOrder
    }
    settings.prompt_order = flattenPromptOrder(existingOrder, preferId)
    if (preferId != null) settings._active_character_id = preferId
  } else if (isFlatPromptOrder(existingOrder)) {
    settings.prompt_order = flattenPromptOrder(existingOrder)
    if (opts?.flatIsAuthoritative) {
      delete settings._raw_prompt_order
    }
  } else if (isNestedPromptOrder(settings._raw_prompt_order) && !opts?.flatIsAuthoritative) {
    // 只有 raw 没有 flat：从 raw 重建
    settings.prompt_order = flattenPromptOrder(settings._raw_prompt_order, preferId)
  } else if (!existingOrder) {
    settings.prompt_order = flattenPromptOrder(null)
  } else {
    settings.prompt_order = flattenPromptOrder(existingOrder, preferId)
  }

  let prompts = normalizePromptsArray(settings.prompts)
  settings.prompts = prompts

  let order = settings.prompt_order as FlatPromptOrderItem[]
  order = ensureOrderFromPrompts(order, prompts)
  order = enrichOrderNames(order, prompts)
  settings.prompt_order = order

  applySamplingAliases(settings)

  const scripts = extractRegexScripts(settings) as RegexScript[]
  settings.regex_scripts = scripts

  backfillTopLevelFromPrompts(settings, prompts)

  // 元数据：方便 UI 显示完整度
  settings._meta = {
    orderCount: order.length,
    orderEnabled: order.filter((o) => o.enabled !== false).length,
    promptsCount: prompts.length,
    regexCount: scripts.length,
    hasNestedRaw: !!settings._raw_prompt_order,
  }

  return settings
}

export function resolveOrderDisplayName(
  item: FlatPromptOrderItem,
  prompts: NormalizedPromptBlock[],
): string {
  if (item.name?.trim()) return item.name
  const p = prompts.find((x) => x.identifier === item.identifier)
  if (p?.name?.trim()) return p.name
  const builtIn = DEFAULT_PROMPT_ORDER.find((x) => x.identifier === item.identifier)
  if (builtIn?.name) return builtIn.name
  return item.identifier
}

/** 从 ST JSON 推名称（避免「导入的预设」） */
export function resolvePresetDisplayName(
  data: Record<string, unknown>,
  fallbackFileName?: string,
): string {
  const candidates = [
    data.preset,
    data.name,
    data.prompt_name,
    data.chat_completion_source,
    (data as { openai_model?: string }).openai_model,
  ]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim() && c !== 'openai' && c !== 'custom') {
      return c.trim()
    }
  }
  if (fallbackFileName) {
    return fallbackFileName.replace(/\.json$/i, '').trim() || '未命名心法'
  }
  // 用 prompts 数量生成可辨识名
  const prompts = Array.isArray(data.prompts) ? data.prompts.length : 0
  const order = flattenPromptOrder(data.prompt_order)
  if (prompts > 0 || order.length > 0) {
    return `心法 · ${order.length}序 · ${prompts}块`
  }
  return '未命名心法'
}

export function denormalizePresetForExport(
  settings: Record<string, unknown>,
  meta?: { name?: string; description?: string },
): Record<string, unknown> {
  const s = { ...settings }
  delete s._meta
  const flat = flattenPromptOrder(s.prompt_order)
  if (s._raw_prompt_order) {
    s.prompt_order = mergeFlatEnabledIntoRaw(s._raw_prompt_order, flat)
  } else {
    // 导出 flat 亦可；包一层 100001 更贴 ST
    s.prompt_order = [
      {
        character_id: 100001,
        order: flat.map((f) => ({
          identifier: f.identifier,
          enabled: f.enabled !== false,
        })),
      },
    ]
  }
  delete s._raw_prompt_order
  delete s._active_character_id

  // prompts 写回 content + prompt 双字段
  if (Array.isArray(s.prompts)) {
    s.prompts = (s.prompts as NormalizedPromptBlock[]).map((p) => ({
      ...p,
      content: p.content ?? '',
      prompt: p.content ?? (p as { prompt?: string }).prompt ?? '',
    }))
  }

  const scripts = extractRegexScripts(s)
  s.regex_scripts = scripts
  const ext = (
    s.extensions && typeof s.extensions === 'object' ? { ...(s.extensions as object) } : {}
  ) as Record<string, unknown>
  ext.regex_scripts = scripts
  s.extensions = ext

  if (meta?.name) {
    s.name = meta.name
    s.preset = meta.name
  }
  if (meta?.description !== undefined) s.description = meta.description
  return s
}

export function getSamplingForApi(settings: Record<string, unknown>): {
  model?: string
  temperature?: number
  max_tokens?: number
  top_p?: number
  frequency_penalty?: number
  presence_penalty?: number
  stream?: boolean
  /** 非标准 OpenAI 字段，部分中转站支持 */
  top_k?: number
  min_p?: number
  repetition_penalty?: number
} {
  const n = normalizePresetSettings(settings)
  const out: Record<string, unknown> = {}
  if (n.openai_model != null && String(n.openai_model).trim()) out.model = n.openai_model
  if (n.temp_openai != null) out.temperature = n.temp_openai
  if (n.openai_max_tokens != null) out.max_tokens = n.openai_max_tokens
  if (n.top_p_openai != null) out.top_p = n.top_p_openai
  if (n.freq_pen_openai != null) out.frequency_penalty = n.freq_pen_openai
  if (n.pres_pen_openai != null) out.presence_penalty = n.pres_pen_openai
  // 天机默认非流式，避免半截解析；仍保留预设值供导出
  if (n.top_k_openai != null && Number(n.top_k_openai) > 0) out.top_k = n.top_k_openai
  if (n.min_p_openai != null && Number(n.min_p_openai) > 0) out.min_p = n.min_p_openai
  if (
    n.repetition_penalty_openai != null &&
    Number(n.repetition_penalty_openai) !== 1
  ) {
    out.repetition_penalty = n.repetition_penalty_openai
  }
  return out as ReturnType<typeof getSamplingForApi>
}

/** 是否算「完整 ST 预设」（有自定义块或较长 order） */
export function isFullStPreset(settings: Record<string, unknown>): boolean {
  const n = normalizePresetSettings(settings)
  const prompts = (n.prompts as NormalizedPromptBlock[]) || []
  const order = (n.prompt_order as FlatPromptOrderItem[]) || []
  return prompts.length >= 3 || order.length >= 8
}
