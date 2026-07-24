/**
 * yuzuki-Memory 独立「追溯填表」任务 — 对标 task-runner.runTrace 的实时路径。
 * 在主剧情落盘后，用记忆 API（或回退通道）再抽一轮 <Memory> 并写回表格。
 */
import type { AppSettings, SideApiChannel } from '@/sillytavern/types'
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

export type MemoryTraceTarget = 'memory' | 'secondary' | 'primary'

export type MemoryTraceOutcome =
  | { status: 'skipped'; reason: string }
  | { status: 'empty'; text: string }
  | { status: 'applied'; count: number; text: string }
  | { status: 'failed'; error: string; text?: string }

function channelReady(ch?: SideApiChannel | null): boolean {
  if (!ch?.enabled) return false
  return !!(normalizeBaseUrl(ch.baseUrl || '') && ch.apiKey?.trim() && ch.model?.trim())
}

function primaryReady(api: AppSettings['api']): boolean {
  return !!(normalizeBaseUrl(api.baseUrl || '') && api.apiKey?.trim() && api.model?.trim())
}

/**
 * 记忆追溯路由：
 * 1. 记忆 API 已启用且配齐 → 只用 memory（不抢主/次）
 * 2. 记忆 API 已启用但未配齐 → 跳过（不静默偷主 API）
 * 3. 记忆 API 未启用 → 兼容旧行为：次 API → 主 API
 */
export function resolveMemoryTraceTarget(
  settings: AppSettings,
): MemoryTraceTarget | null {
  const api = settings.api
  const mem = api.memory
  if (mem?.enabled) {
    return channelReady(mem) ? 'memory' : null
  }
  if (channelReady(api.secondary)) return 'secondary'
  if (primaryReady(api)) return 'primary'
  return null
}

export function buildMemoryTraceRequestBody(input: {
  model: string
  userText: string
  maintext: string
  sum?: string
  state?: TableMemoryState
  temperature?: number
  maxTokens?: number
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
  const temperature =
    typeof input.temperature === 'number' && Number.isFinite(input.temperature)
      ? input.temperature
      : 0.2
  const maxTokens =
    typeof input.maxTokens === 'number' && Number.isFinite(input.maxTokens)
      ? Math.max(256, Math.round(input.maxTokens))
      : 1200
  return {
    messages,
    body: {
      model: input.model,
      messages,
      stream: false,
      temperature,
      max_tokens: maxTokens,
    },
  }
}

function resolveEndpoint(
  target: MemoryTraceTarget,
  api: AppSettings['api'],
): { model: string; temperature?: number; maxTokens?: number } {
  if (target === 'memory' && api.memory?.enabled) {
    return {
      model: String(api.memory.model || '').trim(),
      temperature: api.memory.temperature,
      maxTokens: api.memory.maxTokens,
    }
  }
  if (target === 'secondary' && api.secondary?.enabled) {
    return {
      model: String(api.secondary.model || '').trim(),
      temperature: api.secondary.temperature,
      maxTokens: api.secondary.maxTokens,
    }
  }
  return {
    model: String(api.model || '').trim(),
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
    target: MemoryTraceTarget
    body: Record<string, unknown>
  }) => Promise<{ ok: true; text: string } | { ok: false; error: string }>
}): Promise<MemoryTraceOutcome> {
  if (input.enabled === false) {
    return { status: 'skipped', reason: 'disabled' }
  }

  const target = resolveMemoryTraceTarget(input.settings)
  if (!target) {
    const memOn = !!input.settings.api.memory?.enabled
    return {
      status: 'skipped',
      reason: memOn ? 'memory_api_not_ready' : 'api_not_ready',
    }
  }

  // 追溯前先用经营底表对齐，再 load
  try {
    syncTableMemoryFromGame()
  } catch {
    /* ignore */
  }
  const state = loadTableMemory()

  const ep = resolveEndpoint(target, input.settings.api)
  if (!ep.model) {
    return { status: 'skipped', reason: 'no_model' }
  }

  const { body } = buildMemoryTraceRequestBody({
    model: ep.model,
    userText: input.userText,
    maintext: input.maintext,
    sum: input.sum,
    state,
    temperature: ep.temperature,
    maxTokens: ep.maxTokens,
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
