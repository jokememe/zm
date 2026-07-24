/**
 * 表格记忆调度 / 合并 / 召回参数 — 对齐 shujuku AutoCardUpdater 默认值。
 * UI 文案见 SettingsModal「显示」页；此处仅数据契约与钳制。
 */
import type { AppSettings } from '@/sillytavern/types'

/** 与 ACU 默认一致；字段说明供设置页与状态面板共用语义 */
export interface TableMemorySchedulerSettings {
  /** 一次填表回看最近多少条 AI 楼正文（默认 3） */
  autoUpdateThreshold: number
  /** 距上次填表再攒几层才自动填；1=几乎每层；0=关自动（默认 1） */
  autoUpdateFrequency: number
  /** 落后多楼时每批处理几层（默认 3） */
  updateBatchSize: number
  /** 多批同时请求记忆 API 的上限（默认 1 串行） */
  maxConcurrentGroups: number
  /** 最新若干层先不触发、不写入（防删楼改口，默认 0） */
  skipUpdateFloors: number
  /** 只保留最近 N 次「已填表楼层」标记；0=不清理（默认 100） */
  retainRecentLayers: number
  /** 细行过多时合并为 auto_merged 粗行 */
  autoMergeEnabled: boolean
  /** 细行达到此数触发合并（默认 20） */
  autoMergeThreshold: number
  /** 合并时队尾留几条细行不压（默认 0） */
  autoMergeReserve: number
  /** 合并调用每批打包几条细行（默认 5） */
  mergeBatchSize: number
  /** 推演注入是否做纪要 Top-K 全文召回 */
  recallEnabled: boolean
  /** 纪要轻量索引最多条数（默认 50） */
  recallIndexTop: number
  /** 召回写入 prompt 的全文条数（默认 20） */
  recallTopK: number
  /** 角色/物品/设定注入字符软上限 */
  entityInjectMaxChars: number
  /** 召回纪要正文合计字符软上限 */
  journalInjectMaxChars: number
  /**
   * 精确召回（走记忆 API 选编码）的 system 提示词。
   * 可用占位：{{topK}}。空串 = 用内置默认。
   */
  recallSystemPrompt: string
  /**
   * 精确召回 user 模板。
   * 可用占位：{{topK}} {{query}} {{previousPlot}} {{indexText}}。空串 = 用内置默认。
   */
  recallUserTemplate: string
  /**
   * 召回支路 · 破限（jailbreak）。
   * 主推演心法的 jailbreak **不会**进记忆 API / 纪要注入；这里是专用挂点。
   * - 非空时：作为独立 system 插在召回 system 与 user 之间（侧路选码）
   * - 非空时：亦前缀到注入主推演的「召回纪要」块（主模型读档案时）
   * 占位同 user：{{topK}} {{query}} {{previousPlot}} {{indexText}}
   * 默认空 = 不插破限。
   */
  recallJailbreakPrompt: string
}

/** 召回 LLM · 默认 system（可在密匣改写） */
export const DEFAULT_RECALL_SYSTEM_PROMPT =
  '你是记忆索引召回器。根据用户意图与前文，从纪要索引中选出最相关的编码。' +
  '最终只输出 <recall>编码1,编码2,...</recall>，数量尽量接近 {{topK}} 条（库存不足则全选）。' +
  '编码必须真实存在于索引中，禁止编造。字典序或相关度均可，逗号分隔。'

/** 召回 LLM · 默认 user 模板（可在密匣改写） */
export const DEFAULT_RECALL_USER_TEMPLATE = [
  '【前文】',
  '{{previousPlot}}',
  '【本回用户】',
  '{{query}}',
  '【纪要索引 MEMORY_INDEX_DB】',
  '{{indexText}}',
  '',
  '请输出 <recall>...</recall>，目标约 {{topK}} 条编码。',
].join('\n')

/** 破限默认空；用户自行粘贴，不内置越狱正文 */
export const DEFAULT_RECALL_JAILBREAK_PROMPT = ''

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
  recallSystemPrompt: DEFAULT_RECALL_SYSTEM_PROMPT,
  recallUserTemplate: DEFAULT_RECALL_USER_TEMPLATE,
  recallJailbreakPrompt: DEFAULT_RECALL_JAILBREAK_PROMPT,
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
    // system/user：空 → 展示/运行用内置默认；破限：空就保持空（不替用户塞越狱）
    recallSystemPrompt: clampPromptText(raw?.recallSystemPrompt, d.recallSystemPrompt),
    recallUserTemplate: clampPromptText(raw?.recallUserTemplate, d.recallUserTemplate),
    recallJailbreakPrompt: clampPromptAllowEmpty(raw?.recallJailbreakPrompt),
  }
}

const PROMPT_MAX = 12_000

/** 有非空白内容则用用户稿；否则用默认。过长截断。 */
function clampPromptText(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback
  // 显式空串：仍返回默认展示用；真正「自定义」以 trim 非空为准
  if (!raw.trim()) return fallback
  return raw.length > PROMPT_MAX ? raw.slice(0, PROMPT_MAX) : raw
}

/** 允许空串（破限默认可关）；有内容则截断保存 */
function clampPromptAllowEmpty(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const t = raw
  if (!t.trim()) return ''
  return t.length > PROMPT_MAX ? t.slice(0, PROMPT_MAX) : t
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
