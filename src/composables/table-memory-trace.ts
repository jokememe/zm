/**
 * yuzuki-Memory 独立「追溯填表」任务 — 对标 task-runner.runTrace 的实时路径。
 * 在主剧情落盘后，用主/次 API 再抽一轮 <Memory> 并写回表格。
 */
import type { AppSettings } from '@/sillytavern/types'
import { normalizeBaseUrl } from '@/composables/api-cache'
import {
  applyAssistantMemoryTags,
  hasMemoryTag,
  loadTableMemory,
  formatWorldStateInjection,
  type TableMemoryState,
} from '@/composables/table-memory'
import { buildMemoryTraceMessages } from '@/composables/table-memory-prompts'
import { syncTableMemoryFromGame } from '@/composables/table-memory-sync'

export type MemoryTraceOutcome =
  | { status: 'skipped'; reason: string }
  | { status: 'empty'; text: string }
  | { status: 'applied'; count: number; text: string }
  | { status: 'failed'; error: string; text?: string }

function secondaryReady(api: AppSettings['api']): boolean {
  const s = api.secondary
  if (!s?.enabled) return false
  return !!(normalizeBaseUrl(s.baseUrl || '') && s.apiKey?.trim() && s.model?.trim())
}

/** 优先次 API（便宜/快），否则主 API — 与 settle 一致 */
export function resolveMemoryTraceTarget(
  settings: AppSettings,
): 'secondary' | 'primary' | null {
  if (secondaryReady(settings.api)) return 'secondary'
  const api = settings.api
  if (normalizeBaseUrl(api.baseUrl || '') && api.apiKey?.trim() && api.model?.trim()) {
    return 'primary'
  }
  return null
}

export function buildMemoryTraceRequestBody(input: {
  model: string
  userText: string
  maintext: string
  sum?: string
  state?: TableMemoryState
}): {
  messages: Array<{ role: 'system' | 'user'; content: string }>
  body: Record<string, unknown>
} {
  const state = input.state || loadTableMemory()
  const messages = buildMemoryTraceMessages({
    userText: input.userText,
    maintext: input.maintext,
    sum: input.sum,
    state,
  })
  return {
    messages,
    body: {
      model: input.model,
      messages,
      stream: false,
      temperature: 0.2,
      max_tokens: 1200,
    },
  }
}

/**
 * 执行一轮记忆追溯：组装 yuzuki 式 prompt → LLM → 解析 Memory → 落盘。
 */
export async function runMemoryTrace(input: {
  userText: string
  maintext: string
  sum?: string
  settings: AppSettings
  /** 为 false 时跳过（例如本地示意回合） */
  enabled?: boolean
  postChat: (args: {
    target: 'primary' | 'secondary'
    body: Record<string, unknown>
  }) => Promise<{ ok: true; text: string } | { ok: false; error: string }>
}): Promise<MemoryTraceOutcome> {
  if (input.enabled === false) {
    return { status: 'skipped', reason: 'disabled' }
  }

  const target = resolveMemoryTraceTarget(input.settings)
  if (!target) {
    return { status: 'skipped', reason: 'api_not_ready' }
  }

  // 追溯前先用经营底表对齐，再 load
  try {
    syncTableMemoryFromGame()
  } catch {
    /* ignore */
  }
  const state = loadTableMemory()

  const api = input.settings.api
  const model =
    target === 'secondary' && api.secondary?.enabled
      ? String(api.secondary.model || '').trim()
      : String(api.model || '').trim()
  if (!model) {
    return { status: 'skipped', reason: 'no_model' }
  }

  const { body } = buildMemoryTraceRequestBody({
    model,
    userText: input.userText,
    maintext: input.maintext,
    sum: input.sum,
    state,
  })

  const res = await input.postChat({ target, body })
  if (!res.ok) {
    return { status: 'failed', error: res.error }
  }

  const text = String(res.text || '')
  if (!hasMemoryTag(text)) {
    return { status: 'empty', text }
  }

  const applied = applyAssistantMemoryTags(text)
  if (!applied.success || applied.count <= 0) {
    return { status: 'empty', text }
  }
  return { status: 'applied', count: applied.count, text }
}

/** 供 UI 展示：当前注入预览 */
export function getMemoryInjectionPreview(): string {
  loadTableMemory()
  return formatWorldStateInjection()
}
