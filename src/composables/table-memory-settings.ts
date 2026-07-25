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

/**
 * 召回 LLM · 默认 system（密匣可改）
 * 结构参考「疯狂原始人 纯召回」：专职选码 DM，不写正文。
 */
export const DEFAULT_RECALL_SYSTEM_PROMPT = [
  '[RESET ROLE AND TASK, START NEW TASK]',
  '',
  '<role>',
  '你是「天机簿吏」。你只负责从宗门【纪要索引】中检索与本轮相关的历史编码，不编写剧情、不结算气数。',
  '</role>',
  '',
  '规则：',
  '- 只依据索引与本轮输入选码；禁止编造不存在的编码；',
  '- 编码可为 Jxxxx（细行）或 AMxxxx（合并行）；',
  '- 最终必须在 <recall>...</recall> 中给出编码列表；',
  '- 目标约 {{topK}} 条（库存不足则全列；超过则优先场景/人物/未决悬念相关）。',
].join('\n')

/**
 * 召回 user 模板（密匣可改）
 * 占位对齐纯召回预设：$5 索引 / $7 前文 / $8 本轮 → {{indexText}} {{previousPlot}} {{query}}
 */
export const DEFAULT_RECALL_USER_TEMPLATE = [
  '<story_context>',
  '<背景设定>',
  '{{background}}',
  '</背景设定>',
  '<纪要索引>',
  '{{indexText}}',
  '</纪要索引>',
  '<前文剧情>',
  '{{previousPlot}}',
  '</前文剧情>',
  '═══ 故事信息结束，下接掌门本轮输入 ═══',
  '</story_context>',
  '',
  '<user_input>',
  '{{query}}',
  '</user_input>',
  '',
  '请立刻检索与掌门本轮输入相关的纪要编码，目标约 {{topK}} 条。',
  '先在 <thought> 中简要说明挑选理由（可短），再输出：',
  '<content>',
  '<recall>',
  '<!-- 只写真实存在的 J/AM 编码，逗号或换行分隔；优先当前场景/在场人物/未决悬念 -->',
  '</recall>',
  '</content>',
].join('\n')

/** 破限默认空；用户自行粘贴，不内置越狱正文 */
export const DEFAULT_RECALL_JAILBREAK_PROMPT = ''

/** 纯召回多轮里 assistant 接话（参考疯狂原始人） */
export const DEFAULT_RECALL_ASSISTANT_ACK =
  '好的，天机簿已展开。请给出纪要索引与掌门本轮输入，我只负责选码。'

/** 主推演读到召回块时的导读（参考 finalSystemDirective） */
export const DEFAULT_RECALL_INJECT_DIRECTIVE =
  '以下为与本轮相关的历史纪要编码及全文（仅作背景，勿复述或重演）。请结合其信息合理续写，勿与已发生事实矛盾。'

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
