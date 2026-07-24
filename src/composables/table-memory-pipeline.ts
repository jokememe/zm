/**
 * 表格记忆完整流水线 — 对齐 shujuku AutoCardUpdater：
 * 楼层调度 → 填表（Memory 追溯）→ 纪要合并 → retain 清理 → 索引状态更新
 *
 * 次 API settle 与本流水线无关；本模块只走记忆 API / 回退通道。
 */
import type { AppSettings, ChatMessage } from '@/sillytavern/types'
import {
  createDefaultMeta,
  loadTableMemory,
  saveTableMemory,
  type TableMemoryState,
} from '@/composables/table-memory'
import { resolveTableMemoryScheduler } from '@/composables/table-memory-settings'
import {
  collectAiMessageIndices,
  countAiFloors,
  planFloorUpdate,
  purgeOldFloorMarks,
} from '@/composables/table-memory-scheduler'
import { runMemoryTrace, type MemoryTraceOutcome } from '@/composables/table-memory-trace'
import { runAutoMergeJournal } from '@/composables/table-memory-merge'
import { formatTableMemoryInjection } from '@/composables/table-memory-recall'

export type PipelinePostChat = (args: {
  target: 'memory' | 'secondary' | 'primary'
  body: Record<string, unknown>
}) => Promise<{ ok: true; text: string } | { ok: false; error: string }>

export interface PipelineRunInput {
  messages: ChatMessage[]
  userText: string
  maintext: string
  sum?: string
  settings: AppSettings
  /** 强制跑填表（忽略 frequency 门闩，手动触发用） */
  force?: boolean
  postChat: PipelinePostChat
  /** 合并/召回也复用同一 postChat 时，转为 messages 调用 */
}

export interface PipelineRunResult {
  scheduled: boolean
  scheduleReason: string
  totalAiFloors: number
  lastUpdatedAiFloor: number
  nextTriggerFloor: number
  batches: number
  fill: MemoryTraceOutcome | null
  merge: {
    status: 'skipped' | 'merged' | 'failed'
    reason?: string
    removed?: number
    added?: number
    error?: string
  } | null
  purgedMarks: number
  injectionPreview: string
}

/**
 * 执行一轮完整流水线。
 * - 非 force 时按 frequency/skip/threshold 决定是否填表
 * - 填表后写 lastUpdatedAiFloor
 * - 再检查纪要合并
 * - 再 purge 旧 filledFloors 标记
 */
export async function runTableMemoryPipeline(
  input: PipelineRunInput,
): Promise<PipelineRunResult> {
  const sch = resolveTableMemoryScheduler(input.settings)
  const totalAiFloors = countAiFloors(input.messages)
  const aiMessageIndices = collectAiMessageIndices(input.messages)

  const state = loadTableMemory()
  if (!state.meta) state.meta = createDefaultMeta()
  const lastUpdatedAiFloor = state.meta.lastUpdatedAiFloor || 0

  const plan = planFloorUpdate({
    totalAiFloors,
    lastUpdatedAiFloor,
    aiMessageIndices,
    scheduler: sch,
  })

  const shouldFill = input.force || plan.shouldUpdate
  state.meta.lastScheduleReason = input.force ? 'force' : plan.reason
  saveTableMemory(state)

  let fill: MemoryTraceOutcome | null = null
  let batches = 0

  if (shouldFill && input.settings.tableMemoryEnabled !== false) {
    batches = Math.max(1, plan.batches.length || 1)
    // 宗门侧：一批内用「本回 user+maintext」做一次追溯（多楼批时拼最近 batch 上下文）
    // 完整多楼重放可后续扩展；当前对齐「每触发一次抽一轮表」
    const batchMain = buildBatchContext(input.messages, plan.indicesToUpdate, {
      userText: input.userText,
      maintext: input.maintext,
      sum: input.sum,
    })

    fill = await runMemoryTrace({
      userText: batchMain.userText,
      maintext: batchMain.maintext,
      sum: batchMain.sum,
      settings: input.settings,
      enabled: true,
      postChat: input.postChat,
    })

    // 成功或 empty 都推进楼层游标（避免 empty 死循环每层重试）
    if (fill.status === 'applied' || fill.status === 'empty') {
      const s2 = loadTableMemory()
      if (!s2.meta) s2.meta = createDefaultMeta()
      // 推进到本批最高 AI 楼；force 时推进到当前 total
      const floorFromBatch = plan.batches.length
        ? Math.max(...plan.batches.flatMap((b) => b.aiFloors), lastUpdatedAiFloor)
        : totalAiFloors
      const newFloor = input.force
        ? Math.max(totalAiFloors, lastUpdatedAiFloor)
        : Math.max(floorFromBatch, lastUpdatedAiFloor)
      s2.meta.lastUpdatedAiFloor = newFloor
      s2.meta.filledFloors = [
        ...(s2.meta.filledFloors || []),
        newFloor,
      ]
      s2.meta.lastScheduleReason = plan.reason
      // 若本回 sum 可写入纪要细行
      maybeAppendJournalFromSum(s2, input.sum, newFloor)
      saveTableMemory(s2)
    }
  }

  // 合并
  let merge: PipelineRunResult['merge'] = null
  if (input.settings.tableMemoryEnabled !== false && sch.autoMergeEnabled) {
    merge = await runAutoMergeJournal({
      scheduler: sch,
      postChat: input.postChat
        ? async (messages) => {
            // 合并走记忆通道：构造 chat body
            const target = resolvePipelineTarget(input.settings)
            if (!target) throw new Error('api_not_ready')
            const model = resolveModel(input.settings, target)
            const res = await input.postChat({
              target,
              body: {
                model,
                messages,
                stream: false,
                temperature: 0.2,
                max_tokens: 2000,
              },
            })
            if (!res.ok) throw new Error(res.error)
            return res.text
          }
        : undefined,
    })
  }

  // retain 清理 filledFloors 标记
  let purgedMarks = 0
  {
    const s3 = loadTableMemory()
    if (!s3.meta) s3.meta = createDefaultMeta()
    const before = (s3.meta.filledFloors || []).length
    s3.meta.filledFloors = purgeOldFloorMarks(
      s3.meta.filledFloors || [],
      sch.retainRecentLayers,
    )
    purgedMarks = Math.max(0, before - s3.meta.filledFloors.length)
    saveTableMemory(s3)
  }

  const injectionPreview = formatTableMemoryInjection({
    state: loadTableMemory(),
    query: input.userText,
    scheduler: sch,
  })

  const sFinal = loadTableMemory()
  return {
    scheduled: shouldFill,
    scheduleReason: input.force ? 'force' : plan.reason,
    totalAiFloors,
    lastUpdatedAiFloor: sFinal.meta?.lastUpdatedAiFloor || 0,
    nextTriggerFloor: plan.nextTriggerFloor,
    batches,
    fill,
    merge,
    purgedMarks,
    injectionPreview,
  }
}

function resolvePipelineTarget(
  settings: AppSettings,
): 'memory' | 'secondary' | 'primary' | null {
  const api = settings.api
  const ready = (ch?: { enabled?: boolean; baseUrl?: string; apiKey?: string; model?: string }) =>
    !!(ch?.enabled && String(ch.baseUrl || '').trim() && String(ch.apiKey || '').trim() && String(ch.model || '').trim())
  if (api.memory?.enabled) return ready(api.memory) ? 'memory' : null
  if (ready(api.secondary)) return 'secondary'
  if (String(api.baseUrl || '').trim() && String(api.apiKey || '').trim() && String(api.model || '').trim()) {
    return 'primary'
  }
  return null
}

function resolveModel(
  settings: AppSettings,
  target: 'memory' | 'secondary' | 'primary',
): string {
  if (target === 'memory') return String(settings.api.memory?.model || '').trim()
  if (target === 'secondary') return String(settings.api.secondary?.model || '').trim()
  return String(settings.api.model || '').trim()
}

function buildBatchContext(
  messages: ChatMessage[],
  indices: number[],
  fallback: { userText: string; maintext: string; sum?: string },
): { userText: string; maintext: string; sum?: string } {
  if (!indices.length) return fallback
  // 取批内最后一条 assistant 与其前一条 user
  const lastIdx = indices[indices.length - 1]
  const asst = messages[lastIdx]
  let userText = fallback.userText
  for (let i = lastIdx - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') {
      userText = messages[i].content || userText
      break
    }
  }
  // 多楼时拼接 maintext（截断）
  const mains = indices
    .map((i) => messages[i])
    .filter((m) => m?.role === 'assistant')
    .map((m) => String(m.content || '').slice(0, 800))
  const maintext =
    mains.length > 1
      ? mains.join('\n---\n').slice(0, 2400)
      : fallback.maintext || String(asst?.content || '')
  return {
    userText,
    maintext,
    sum: fallback.sum,
  }
}

/** 从 sum 自动追加一条细纪要（无 Memory 时仍有索引原料） */
export function maybeAppendJournalFromSum(
  s: TableMemoryState,
  sum: string | undefined,
  aiFloor: number,
): boolean {
  const text = String(sum || '').trim()
  if (!text) return false
  const table = s.tables.find((t) => t.id === 'plot_journal')
  if (!table) return false
  if (!s.meta) s.meta = createDefaultMeta()
  const n = Math.max(1, s.meta.nextIndexCode || 1)
  const code = `J${String(n).padStart(4, '0')}`
  s.meta.nextIndexCode = n + 1
  if (!s.records[table.id]) s.records[table.id] = []
  // 去重：相同 sum 不重复写
  const exists = s.records[table.id].some(
    (r) => String(r.values?.['纪要'] || '').trim() === text,
  )
  if (exists) return false
  s.records[table.id].push({
    id: `record_j_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    values: {
      编码索引: code,
      概要: text.slice(0, 48),
      时间跨度: `楼${aiFloor}`,
      地点: '',
      纪要: text,
      标记: '',
    },
  })
  return true
}

/** 调度状态摘要（UI） */
export function getSchedulerStatus(settings: AppSettings, messages: ChatMessage[]) {
  const sch = resolveTableMemoryScheduler(settings)
  const totalAiFloors = countAiFloors(messages)
  const state = loadTableMemory()
  const last = state.meta?.lastUpdatedAiFloor || 0
  const plan = planFloorUpdate({
    totalAiFloors,
    lastUpdatedAiFloor: last,
    aiMessageIndices: collectAiMessageIndices(messages),
    scheduler: sch,
  })
  return {
    ...sch,
    totalAiFloors,
    lastUpdatedAiFloor: last,
    ...plan,
    journalFineCount: (state.records['plot_journal'] || []).filter(
      (r) => String(r.values?.['标记'] || '') !== 'auto_merged',
    ).length,
    journalTotal: (state.records['plot_journal'] || []).length,
  }
}
