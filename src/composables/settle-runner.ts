/**
 * Post-story settle: secondary (or primary) JSON delta → validate → apply
 * 设计目标：快、少调用。单次尝试、短 prompt、小 max_tokens；不链式二次回退。
 */
import type { AppSettings } from '@/sillytavern/types'
import type { SettlementMode, WorldSnapshot } from '@/types/world'
import {
  parseSettlePayload,
  sanitizeWorldDelta,
  validateWorldDelta,
} from '@/composables/world-delta'
import {
  snapshotWorldState,
  applyValidatedDelta,
} from '@/composables/world-state'
import { normalizeBaseUrl } from '@/composables/api-cache'
import { extractChatCompletionText } from '@/sillytavern/api-tools'

/**
 * Pure settle text extraction from a non-stream chat/completions body.
 * Uses extractChatCompletionText so secondary “thinking” models that leave
 * message.content empty still yield usable JSON from reasoning_* / multipart.
 */
export function textFromSettleCompletion(
  data: unknown,
): { ok: true; text: string } | { ok: false; error: string } {
  const extracted = extractChatCompletionText(data)
  const t = (extracted.text || '').trim()
  if (!t) {
    const bits = ['settle 返回为空']
    if (extracted.finishReason) bits.push(`finish_reason=${extracted.finishReason}`)
    if (extracted.hadReasoning) {
      bits.push('模型仅输出了思考未给出正文，可换非思考模型或增大 max_tokens')
    } else if (extracted.finishReason === 'length') {
      bits.push('输出被截断，请增大 max_tokens 或换更快模型')
    }
    return { ok: false, error: bits.join('；') }
  }
  return { ok: true, text: extracted.text }
}

export type SettleOutcome =
  | { status: 'skipped'; reason: 'off' | 'secondary_only_unavailable' }
  | { status: 'empty'; summary?: string; stateAfter: WorldSnapshot }
  | { status: 'applied'; lines: string[]; summary?: string; stateAfter: WorldSnapshot }
  | { status: 'failed'; error: string; stateAfter: WorldSnapshot }

/**
 * 选**一个**目标端点：有次用次，否则主。
 * 不再「次失败再打主」——链式回退会把超时叠成 60s+。
 */
export function resolveSettleTarget(
  mode: SettlementMode,
  secondaryEnabled: boolean,
):
  | { kind: 'skip'; reason: 'off' | 'secondary_only_unavailable' }
  | { kind: 'call'; targets: Array<'secondary' | 'primary'> } {
  if (mode === 'off') return { kind: 'skip', reason: 'off' }
  if (mode === 'secondary_only') {
    if (!secondaryEnabled) return { kind: 'skip', reason: 'secondary_only_unavailable' }
    return { kind: 'call', targets: ['secondary'] }
  }
  // secondary_then_primary：优先次，否则主；只打一枪
  if (secondaryEnabled) return { kind: 'call', targets: ['secondary'] }
  return { kind: 'call', targets: ['primary'] }
}

export function formatSnapshotForSettle(snap: WorldSnapshot): string {
  const res = snap.resources
  const disc = snap.disciples
    .slice(0, 12)
    .map((d) => `${d.id}:${d.name}|${d.realm}|${d.status}`)
    .join('；')
  const fac = snap.factions
    .map((f) => `${f.id}:${f.name}|${f.relation}|${f.stance}`)
    .join('；')
  const city = snap.cities
    .map((c) => `${c.id}:${c.name}|${c.attitude}|${c.influence}`)
    .join('；')
  return [
    `资源 灵石${res.spiritStone} 灵谷${res.spiritGrain} 丹材${res.herb} 矿铁${res.ore} 声望${res.prestige} 气运${res.destiny}`,
    `弟子 ${disc || '无'}`,
    `势力 ${fac || '无'}`,
    `城池 ${city || '无'}`,
  ].join('\n')
}

/** 压缩长文，避免 settle 输入过大拖慢推理 */
export function clipText(s: string, max: number): string {
  const t = (s || '').trim()
  if (t.length <= max) return t
  return t.slice(0, max) + '…'
}

/**
 * 局面结算系统提示。
 * 刻意不用 API 的 response_format / json_schema：多数中转与本地模型不支持，
 * 靠自然语言契约 + 示例 + 客户端 parse/sanitize/validate 兜底。
 */
export const SETTLE_SYSTEM_PROMPT = [
  '你是宗门经营游戏的局面结算器，不是说书人。',
  '唯一任务：根据【当前局面】与本回【玩家/sum/剧情】，输出一个可被 JSON.parse 的对象，表示本回应写入存档的变更。',
  '禁止：故事正文、分析过程、markdown 代码围栏、前后缀说明、思考标签。',
  '禁止：虚构正文未出现的收徒/交恶/纳贡；禁止编造快照中不存在的弟子 id。',
  '无任何局面变更时只输出：{"resources":{},"ops":[],"summary":"无"}',
].join('')

/**
 * 放在 user 末尾的契约说明（示例驱动，兼容不支持 structured output 的模型）。
 */
export const SETTLE_CONTRACT_HINT = `【输出契约·严格遵守】
只输出一个 JSON 对象（双引号键值，无尾逗号，无其它文字）。不要用单引号。不要包 \`\`\`json。

根结构：
{"resources":{},"ops":[],"summary":"一句话"}

resources：可选。键只能是中文：灵石、灵谷、丹材、矿铁、声望、气运。
值必须是相对变化（可负），在当前库存上加减，不是覆盖绝对值。
正确：{"灵石":-30,"声望":1} → 灵石减 30、声望加 1。
错误：把当前灵石 260 写成 {"灵石":260}（那会再加 260）；不要输出绝对值。
不要用英文键 spiritStone。

ops：数组，本回最多 12 条。op 只能是下列之一（字面量完全一致）：
- disciple.add：新人入宗。必须有 name。正文收了几个就写几条，勿漏名。
  例 {"op":"disciple.add","name":"陆承渊","realm":"炼气一层","role":"外门弟子","gender":"男"}
- disciple.update：改现有弟子。必须用快照里的 id 或 name，且必须有 patch 对象。
  例 {"op":"disciple.update","name":"陆承渊","patch":{"loyalty":85,"status":"外勤"}}
  错误示例（禁止）：{"op":"disciple.update","name":"陆承渊","loyalty":85}
- disciple.remove：离宗/除名。id 或 name 二选一。
  例 {"op":"disciple.remove","name":"某某"}
- faction.update：改势力。id 或 name + patch。
  例 {"op":"faction.update","name":"赤焰谷","patch":{"relation":-40,"stance":"敌对","recent":"遣使"}}
  stance 只能是：同盟、友好、中立、敌对、觊觎
- city.update：改城池。id 或 name + patch。
  例 {"op":"city.update","name":"青石城","patch":{"attitude":"犹豫","influence":40}}
  attitude 只能是：恭顺、中立、犹豫、敌视
- notify.push：系统风闻。必须有 title。
  例 {"op":"notify.push","title":"山门来客","body":"……"}

弟子 status 只能是：在宗、闭关、外勤、受伤、叛离风险。
定位优先用【当前局面】里的 id:名；改已有角色用 update，不要对已在册者再 add。
只记录正文已发生或明确承诺且应立即生效的变更。`

/** 组装 settle 的 messages（纯函数，便于单测；不依赖 API schema 能力）
 * 顺序：system 任务 →（可选）system 破限 → user 契约
 * 主推演心法 jailbreak 不会自动进来；破限只认 jailbreakPrompt。
 */
export function buildSettleMessages(input: {
  userText: string
  maintext: string
  sum: string
  snap: WorldSnapshot
  /** 次 API 结算专用破限；非空则插独立 system */
  jailbreakPrompt?: string | null
}): Array<{ role: string; content: string }> {
  const main = clipText(input.maintext, 700)
  const user = clipText(input.userText, 280)
  const sum = clipText(input.sum, 200)
  const body = [
    '【当前局面】',
    formatSnapshotForSettle(input.snap),
    `【玩家】${user || '无'}`,
    `【sum】${sum || '无'}`,
    `【剧情】${main || '无'}`,
    SETTLE_CONTRACT_HINT,
  ].join('\n')
  const msgs: Array<{ role: string; content: string }> = [
    { role: 'system', content: SETTLE_SYSTEM_PROMPT },
  ]
  const jb =
    typeof input.jailbreakPrompt === 'string' ? input.jailbreakPrompt.trim() : ''
  if (jb) {
    // 截断防 prompt 爆炸（与设置侧 12k 对齐，再保险）
    msgs.push({
      role: 'system',
      content: jb.length > 12_000 ? jb.slice(0, 12_000) : jb,
    })
  }
  msgs.push({ role: 'user', content: body })
  return msgs
}

function secondaryReady(api: AppSettings['api']): boolean {
  const s = api.secondary
  if (!s?.enabled) return false
  return !!(normalizeBaseUrl(s.baseUrl || '') && s.apiKey?.trim() && s.model?.trim())
}

function endpointFor(
  settings: AppSettings,
  target: 'primary' | 'secondary',
): { baseUrl: string; apiKey: string; model: string } {
  const api = settings.api
  if (target === 'secondary' && api.secondary?.enabled) {
    return {
      baseUrl: normalizeBaseUrl(api.secondary.baseUrl || ''),
      apiKey: String(api.secondary.apiKey || ''),
      model: String(api.secondary.model || '').trim(),
    }
  }
  return {
    baseUrl: normalizeBaseUrl(api.baseUrl || ''),
    apiKey: String(api.apiKey || ''),
    model: String(api.model || '').trim(),
  }
}

export async function runSettle(input: {
  userText: string
  maintext: string
  sum: string
  settings: AppSettings
  postChat: (args: {
    target: 'primary' | 'secondary'
    body: Record<string, unknown>
  }) => Promise<{ ok: true; text: string } | { ok: false; error: string }>
}): Promise<SettleOutcome> {
  const mode = (input.settings.settlementMode ||
    'secondary_then_primary') as SettlementMode
  const secOk = secondaryReady(input.settings.api)
  const plan = resolveSettleTarget(mode, secOk)

  if (plan.kind === 'skip') {
    return { status: 'skipped', reason: plan.reason }
  }

  const snap0 = snapshotWorldState()
  const target = plan.targets[0]
  const ep = endpointFor(input.settings, target)
  if (!ep.baseUrl || !ep.apiKey || !ep.model) {
    return {
      status: 'failed',
      error: `${target} API 未配齐`,
      stateAfter: snapshotWorldState(),
    }
  }

  // 单次调用：校验失败也不重打（避免超时叠乘）
  const messages = buildSettleMessages({
    userText: input.userText,
    maintext: input.maintext,
    sum: input.sum,
    snap: snap0,
    jailbreakPrompt: input.settings.settleJailbreakPrompt,
  })
  // 非流式：settle 只需短 JSON，很多中转不支持 stream
  const body: Record<string, unknown> = {
    model: ep.model,
    messages,
    stream: false,
    temperature: 0.1,
    max_tokens: 900,
  }
  const res = await input.postChat({ target, body })
  if (!res.ok) {
    return {
      status: 'failed',
      error: res.error,
      stateAfter: snapshotWorldState(),
    }
  }

  const parsed = parseSettlePayload(res.text)
  if (!parsed.ok) {
    return {
      status: 'failed',
      error: parsed.error,
      stateAfter: snapshotWorldState(),
    }
  }
  // 模型常一次加过多弟子 / 用 姓名 代替 name：先规范化再校验
  const delta = sanitizeWorldDelta(parsed.delta)
  const v = validateWorldDelta(delta, snap0)
  // partial：坏 op 已跳过；仅当清洗后仍无可写内容 → empty
  const clean = v.delta ?? { ops: [], resources: {} }
  const hasRes = clean.resources && Object.keys(clean.resources).length > 0
  const hasOps = (clean.ops?.length ?? 0) > 0
  if (!hasRes && !hasOps) {
    const base = clean.summary || delta.summary || ''
    const skipHint = v.warnings.length
      ? `（已跳过：${v.warnings.slice(0, 2).join('；')}）`
      : ''
    const summary = (base + skipHint).trim() || undefined
    return {
      status: 'empty',
      summary,
      stateAfter: snapshotWorldState(),
    }
  }

  const applied = applyValidatedDelta(clean)
  const stateAfter = snapshotWorldState()
  if (!applied.changed) {
    return {
      status: 'empty',
      summary: clean.summary ?? delta.summary,
      stateAfter,
    }
  }
  const lines =
    v.warnings.length > 0
      ? [...applied.lines, `（部分跳过 ${v.warnings.length} 项）`]
      : applied.lines
  return {
    status: 'applied',
    lines,
    summary: clean.summary ?? delta.summary,
    stateAfter,
  }
}
