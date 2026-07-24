/**
 * 表格记忆调度 / 合并 / 召回参数 — 对齐 shujuku AutoCardUpdater 默认值。
 * threshold=读深, frequency=每N层, batch, concurrent, skip, retain, merge, Top-K。
 */
import type { AppSettings } from '@/sillytavern/types'

/** 与 ACU 默认一致的调度与清理参数 */
export interface TableMemorySchedulerSettings {
  /** 上下文读深 M：一次填表读最近多少 AI 楼（默认 3） */
  autoUpdateThreshold: number
  /** 每 N 层自动填表一次（默认 1 = 每层） */
  autoUpdateFrequency: number
  /** 填表批大小：一批处理多少未更新楼（默认 3） */
  updateBatchSize: number
  /** 最大并发组（默认 1） */
  maxConcurrentGroups: number
  /** 跳过最近 X 层不计入触发（默认 0） */
  skipUpdateFloors: number
  /** 保留最近 N 次填表楼层标记；0=全部保留（默认 100） */
  retainRecentLayers: number
  /** 是否开启纪要自动合并（细行→粗行 auto_merged） */
  autoMergeEnabled: boolean
  /** 非 auto_merged 细行数达到该值时触发合并（默认 20） */
  autoMergeThreshold: number
  /** 合并时保留最近几条细行不并（默认 0） */
  autoMergeReserve: number
  /** 合并时每批送入 LLM 的细行数（默认 5） */
  mergeBatchSize: number
  /** 是否启用索引 Top-K 召回注入（默认 true） */
  recallEnabled: boolean
  /** 索引侧最多展示条数（~50，再交给 Top-K） */
  recallIndexTop: number
  /** 最终注入的全文纪要条数（~20） */
  recallTopK: number
  /** 实体表（角色/物品/设定）注入字符上限 */
  entityInjectMaxChars: number
  /** 召回纪要全文注入字符上限 */
  journalInjectMaxChars: number
}

export const DEFAULT_TABLE_MEMORY_SCHEDULER: TableMemorySchedulerSettings = {
  autoUpdateThreshold: 3,
  autoUpdateFrequency: 1,
  updateBatchSize: 3,
  maxConcurrentGroups: 1,
  skipUpdateFloors: 0,
  retainRecentLayers: 100,
  autoMergeEnabled: true,
  autoMergeThreshold: 20,
  autoMergeReserve: 0,
  mergeBatchSize: 5,
  recallEnabled: true,
  recallIndexTop: 50,
  recallTopK: 20,
  entityInjectMaxChars: 2800,
  journalInjectMaxChars: 3200,
}

function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.max(min, Math.min(max, Math.round(v)))
}

/** 从 AppSettings 取出并钳制调度参数 */
export function resolveTableMemoryScheduler(
  settings?: AppSettings | null,
): TableMemorySchedulerSettings {
  const raw = (settings as AppSettings & {
    tableMemoryScheduler?: Partial<TableMemorySchedulerSettings>
  })?.tableMemoryScheduler
  const d = DEFAULT_TABLE_MEMORY_SCHEDULER
  return {
    autoUpdateThreshold: clampInt(raw?.autoUpdateThreshold, 1, 50, d.autoUpdateThreshold),
    autoUpdateFrequency: clampInt(raw?.autoUpdateFrequency, 0, 100, d.autoUpdateFrequency),
    updateBatchSize: clampInt(raw?.updateBatchSize, 1, 20, d.updateBatchSize),
    maxConcurrentGroups: clampInt(raw?.maxConcurrentGroups, 1, 8, d.maxConcurrentGroups),
    skipUpdateFloors: clampInt(raw?.skipUpdateFloors, 0, 100, d.skipUpdateFloors),
    retainRecentLayers: clampInt(raw?.retainRecentLayers, 0, 2000, d.retainRecentLayers),
    autoMergeEnabled: raw?.autoMergeEnabled !== false,
    autoMergeThreshold: clampInt(raw?.autoMergeThreshold, 2, 200, d.autoMergeThreshold),
    autoMergeReserve: clampInt(raw?.autoMergeReserve, 0, 100, d.autoMergeReserve),
    mergeBatchSize: clampInt(raw?.mergeBatchSize, 1, 30, d.mergeBatchSize),
    recallEnabled: raw?.recallEnabled !== false,
    recallIndexTop: clampInt(raw?.recallIndexTop, 5, 200, d.recallIndexTop),
    recallTopK: clampInt(raw?.recallTopK, 1, 80, d.recallTopK),
    entityInjectMaxChars: clampInt(
      raw?.entityInjectMaxChars,
      500,
      20000,
      d.entityInjectMaxChars,
    ),
    journalInjectMaxChars: clampInt(
      raw?.journalInjectMaxChars,
      500,
      20000,
      d.journalInjectMaxChars,
    ),
  }
}

export function patchTableMemoryScheduler(
  current: AppSettings,
  partial: Partial<TableMemorySchedulerSettings>,
): AppSettings {
  const base = resolveTableMemoryScheduler(current)
  return {
    ...current,
    tableMemoryScheduler: resolveTableMemoryScheduler({
      ...current,
      tableMemoryScheduler: { ...base, ...partial },
    }),
  }
}
