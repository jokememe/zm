/**
 * AI 楼层调度 — 对齐 shujuku processUpdates / trigger 逻辑（纯函数）。
 *
 * 触发条件：
 *   effectiveUnrecorded = max(0, (totalAiFloors - skip) - lastUpdatedAiFloor)
 *   当 frequency > 0 且 effectiveUnrecorded >= frequency 时触发
 *
 * 待更新楼层：
 *   有效 AI 索引 = 去掉最近 skip 层后的全部 AI 楼
 *   未更新 = 从 lastUpdated 起的有效楼
 *   上下文范围 = 有效楼末尾 threshold 层
 *   交集 = 本批 indices
 *   再按 batchSize 切批
 */
import type { TableMemorySchedulerSettings } from '@/composables/table-memory-settings'

export interface FloorScheduleInput {
  /** 当前会话 AI（assistant）楼层总数 */
  totalAiFloors: number
  /** 上次填表完成时的 AI 楼层号（1-based 计数） */
  lastUpdatedAiFloor: number
  /** 调度参数 */
  scheduler: Pick<
    TableMemorySchedulerSettings,
    | 'autoUpdateThreshold'
    | 'autoUpdateFrequency'
    | 'updateBatchSize'
    | 'skipUpdateFloors'
  >
  /**
   * AI 楼在消息数组中的下标列表（按时间从旧到新）。
   * 若省略，用 0..totalAiFloors-1 作为虚拟索引。
   */
  aiMessageIndices?: number[]
}

export interface FloorBatch {
  /** 本批要处理的消息下标 */
  indices: number[]
  /** 本批对应的 AI 楼层号（1-based，与 lastUpdated 同语义） */
  aiFloors: number[]
}

export interface FloorScheduleResult {
  shouldUpdate: boolean
  /** 有效未记录层数（已减 skip） */
  effectiveUnrecorded: number
  /** 物理未记录层数 */
  unrecorded: number
  /** 下次触发的目标 AI 楼层号 */
  nextTriggerFloor: number
  /** 本轮应处理的消息索引（在上下文读深内） */
  indicesToUpdate: number[]
  /** 按 batchSize 切好的批 */
  batches: FloorBatch[]
  reason: string
}

/** 统计会话中 assistant 楼层数 */
export function countAiFloors(
  messages: Array<{ role?: string } | null | undefined>,
): number {
  return (messages || []).filter((m) => m && m.role === 'assistant').length
}

/** 收集 assistant 消息在数组中的下标（旧→新） */
export function collectAiMessageIndices(
  messages: Array<{ role?: string } | null | undefined>,
): number[] {
  const out: number[] = []
  ;(messages || []).forEach((m, i) => {
    if (m && m.role === 'assistant') out.push(i)
  })
  return out
}

/**
 * 计算是否应自动填表，以及本批 indices。
 * 对齐 ACU：
 *   effectiveUnrecorded = (total - skip) - lastUpdated
 *   trigger when >= frequency
 */
export function planFloorUpdate(input: FloorScheduleInput): FloorScheduleResult {
  const total = Math.max(0, Math.floor(Number(input.totalAiFloors) || 0))
  const last = Math.max(0, Math.floor(Number(input.lastUpdatedAiFloor) || 0))
  const threshold = Math.max(1, Math.floor(input.scheduler.autoUpdateThreshold || 3))
  const frequency = Math.max(0, Math.floor(input.scheduler.autoUpdateFrequency ?? 1))
  const batchSize = Math.max(1, Math.floor(input.scheduler.updateBatchSize || 3))
  const skip = Math.max(0, Math.floor(input.scheduler.skipUpdateFloors || 0))

  const unrecorded = Math.max(0, total - last)
  const effectiveUnrecorded = Math.max(0, total - skip - last)
  const nextTriggerFloor = last + frequency + skip

  if (frequency <= 0) {
    return {
      shouldUpdate: false,
      effectiveUnrecorded,
      unrecorded,
      nextTriggerFloor: 0,
      indicesToUpdate: [],
      batches: [],
      reason: 'frequency_disabled',
    }
  }

  if (total <= 0) {
    return {
      shouldUpdate: false,
      effectiveUnrecorded: 0,
      unrecorded: 0,
      nextTriggerFloor,
      indicesToUpdate: [],
      batches: [],
      reason: 'no_ai_floors',
    }
  }

  if (effectiveUnrecorded < frequency) {
    return {
      shouldUpdate: false,
      effectiveUnrecorded,
      unrecorded,
      nextTriggerFloor,
      indicesToUpdate: [],
      batches: [],
      reason: 'not_ready',
    }
  }

  const allAi =
    input.aiMessageIndices && input.aiMessageIndices.length
      ? [...input.aiMessageIndices]
      : Array.from({ length: total }, (_, i) => i)

  // 有效范围：去掉最近 skip 层
  const effectiveAiIndices =
    skip > 0 && allAi.length > skip ? allAi.slice(0, -skip) : allAi

  // lastUpdatedAiFloor 是「已处理的 AI 楼数量」；从该数量起是未更新
  const startIndexInAiArray = Math.min(last, effectiveAiIndices.length)
  if (startIndexInAiArray >= effectiveAiIndices.length) {
    return {
      shouldUpdate: false,
      effectiveUnrecorded,
      unrecorded,
      nextTriggerFloor,
      indicesToUpdate: [],
      batches: [],
      reason: 'all_skipped_or_done',
    }
  }

  const unupdatedAiIndices = effectiveAiIndices.slice(startIndexInAiArray)
  // 上下文读深：以跳过层后的有效末尾为基准，往上 threshold 层
  const contextScopeIndices = effectiveAiIndices.slice(-threshold)
  const contextScopeSet = new Set(contextScopeIndices)
  const indicesToUpdate = unupdatedAiIndices.filter((idx) => contextScopeSet.has(idx))

  if (!indicesToUpdate.length) {
    return {
      shouldUpdate: false,
      effectiveUnrecorded,
      unrecorded,
      nextTriggerFloor,
      indicesToUpdate: [],
      batches: [],
      reason: 'outside_context_depth',
    }
  }

  // 映射消息下标 → AI 楼层号（1-based）
  const floorOfIndex = new Map<number, number>()
  allAi.forEach((msgIdx, aiOrd) => {
    floorOfIndex.set(msgIdx, aiOrd + 1)
  })

  const batches: FloorBatch[] = []
  for (let i = 0; i < indicesToUpdate.length; i += batchSize) {
    const slice = indicesToUpdate.slice(i, i + batchSize)
    batches.push({
      indices: slice,
      aiFloors: slice.map((idx) => floorOfIndex.get(idx) ?? 0).filter((n) => n > 0),
    })
  }

  return {
    shouldUpdate: true,
    effectiveUnrecorded,
    unrecorded,
    nextTriggerFloor,
    indicesToUpdate,
    batches,
    reason: 'ready',
  }
}

/**
 * 保留最近 N 次填表标记：超出则丢弃更早的。
 * 对应 purgeOldLayerData 的「只留近 N 层本地数据」语义（宗门侧是 meta 标记）。
 */
export function purgeOldFloorMarks(
  filledFloors: number[],
  retainRecentLayers: number,
): number[] {
  const list = (filledFloors || [])
    .map((n) => Math.floor(Number(n) || 0))
    .filter((n) => n > 0)
    .sort((a, b) => a - b)
  if (retainRecentLayers <= 0) return list
  if (list.length <= retainRecentLayers) return list
  return list.slice(list.length - retainRecentLayers)
}
