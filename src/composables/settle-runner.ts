/**
 * Post-story settle: secondary (or primary) JSON delta → validate → apply
 * 设计目标：准、快、少调用。短契约 + 相关快照 + 小 max_tokens；不链式二次回退。
 */
import type { AppSettings } from '@/sillytavern/types'
import type { SettlementMode, WorldSnapshot } from '@/types/world'
import {
  parseSettlePayload,
  sanitizeWorldDelta,
  validateWorldDelta,
  normalizeResourceDeltasAgainstSnap,
} from '@/composables/world-delta'
import {
  snapshotWorldState,
  applyValidatedDelta,
} from '@/composables/world-state'
import { normalizeBaseUrl } from '@/composables/api-cache'
import { extractChatCompletionText } from '@/sillytavern/api-tools'
import {
  isRetryableFailureMessage,
  withRetry,
  withRetryHint,
  DEFAULT_API_MAX_ATTEMPTS,
} from '@/composables/api-retry'

/** settle 输出上限：短 JSON 足够，过大只会拖慢思考模型 */
export const SETTLE_MAX_TOKENS = 640
/** 正文/玩家输入截断：结算不需要全文笔 */
export const SETTLE_CLIP = {
  maintext: 420,
  userText: 200,
  sum: 120,
} as const

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
  | { status: 'skipped'; reason: 'off' | 'secondary_only_unavailable'; attempts?: number }
  | {
      status: 'empty'
      summary?: string
      stateAfter: WorldSnapshot
      attempts?: number
    }
  | {
      status: 'applied'
      lines: string[]
      summary?: string
      stateAfter: WorldSnapshot
      attempts?: number
    }
  | {
      status: 'failed'
      error: string
      stateAfter: WorldSnapshot
      attempts?: number
    }

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

/** 正文是否点名该实体（用于快照裁剪，避免整本图鉴拖慢） */
export function textMentionsName(focus: string, name: string): boolean {
  const n = String(name || '').trim()
  if (!n || n.length < 2) return false
  const f = String(focus || '')
  if (!f) return false
  return f.includes(n)
}

/**
 * 局面快照：资源全量；实体优先「正文点名」+ 名册短表。
 * 比整本图鉴短，模型更少分心、首 token 更快。
 */
export function formatSnapshotForSettle(
  snap: WorldSnapshot,
  opts?: { focusText?: string },
): string {
  const res = snap.resources
  const focus = String(opts?.focusText || '')
  const pick = <T extends { name: string }>(
    list: T[],
    maxDetail: number,
    maxCatalog: number,
    fmtDetail: (x: T) => string,
    fmtCat: (x: T) => string,
  ): string => {
    if (!list.length) return '无'
    const mentioned = list.filter((x) => textMentionsName(focus, x.name))
    const detailSrc =
      mentioned.length > 0
        ? mentioned.slice(0, maxDetail)
        : list.slice(0, Math.min(maxDetail, list.length))
    const detailIds = new Set(detailSrc.map((x) => (x as { id?: string }).id || x.name))
    const detail = detailSrc.map(fmtDetail).join('；')
    const rest = list
      .filter((x) => !detailIds.has((x as { id?: string }).id || x.name))
      .slice(0, maxCatalog)
      .map(fmtCat)
    if (!rest.length) return detail
    return `${detail}｜其余 ${rest.join('、')}`
  }

  const disc = pick(
    snap.disciples,
    10,
    14,
    (d) => `${d.id}:${d.name}|${d.realm}|${d.status}`,
    (d) => `${d.id}:${d.name}`,
  )
  const fac = pick(
    snap.factions,
    6,
    10,
    (f) => `${f.id}:${f.name}|${f.relation}|${f.stance}`,
    (f) => `${f.id}:${f.name}`,
  )
  const city = pick(
    snap.cities,
    6,
    10,
    (c) => `${c.id}:${c.name}|${c.attitude}|${c.influence}`,
    (c) => `${c.id}:${c.name}`,
  )
  const manuals = pick(
    snap.manuals || [],
    4,
    8,
    (m) => `${m.id}:${m.name}|${m.sealed ? '封' : '开'}`,
    (m) => `${m.id}:${m.name}`,
  )
  const treasures = pick(
    snap.treasures || [],
    4,
    8,
    (t) => `${t.id}:${t.name}|${t.owner || '库藏'}`,
    (t) => `${t.id}:${t.name}`,
  )
  const forge = pick(
    snap.forgeQueue || [],
    4,
    6,
    (g) => `${g.id}:${g.name}|${g.progress}%`,
    (g) => `${g.id}:${g.name}`,
  )
  const relList = snap.relationEdges || []
  const rel =
    relList.length === 0
      ? '无'
      : relList
          .slice(0, 6)
          .map((e) => `${e.from}→${e.to}|${e.type}`)
          .join('；')
  const heirs = pick(
    snap.heirs || [],
    4,
    6,
    (h) => `${h.id}:${h.name}|分${h.score}`,
    (h) => `${h.id}:${h.name}`,
  )

  return [
    `资源 灵石${res.spiritStone} 灵谷${res.spiritGrain} 丹材${res.herb} 矿铁${res.ore} 声望${res.prestige} 气运${res.destiny}`,
    `弟子 ${disc}`,
    `势力 ${fac}`,
    `城池 ${city}`,
    `秘籍 ${manuals}`,
    `宝物 ${treasures}`,
    `锻器 ${forge}`,
    `关系 ${rel}`,
    `继位 ${heirs}`,
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
 * 靠短契约 + 示例 + 客户端 parse/sanitize/validate 兜底。
 */
export const SETTLE_SYSTEM_PROMPT = [
  '你是宗门经营游戏的局面结算器，不是说书人。',
  '只根据【当前局面】与本回【玩家/sum/剧情】输出一个可 JSON.parse 的变更对象。',
  '禁止故事、分析、markdown 围栏、思考标签、前后缀。',
  '禁止虚构正文未出现的收徒/新势力/新城池/新秘籍/新宝物/新关系；禁止编造不存在的弟子 id。',
  '正文出现的新实体必须用对应 *.add 入库，不可只 notify。',
  '无变更只输出：{"resources":{},"ops":[],"summary":"无"}',
].join('')

/**
 * 短契约：完整 op 表仍保留，砍掉冗长示例与重复说明（约 1/3 原文长度）。
 * 准确靠客户端 sanitize/validate；速度靠短 prompt。
 */
export const SETTLE_CONTRACT_HINT = `【输出契约】
只输出一个 JSON（双引号、无尾逗号、无其它文字）。不要单引号，不要 \`\`\`json。
根：{"resources":{},"ops":[],"summary":"一句"}

resources：键只能中文 灵石|灵谷|丹材|矿铁|声望|气运。
值必须是相对变化（可负），在当前库存上加减，不是覆盖绝对值。
正确：{"灵石":-30,"声望":1}。错误：把库存 260 写成 {"灵石":260}（会再加 260）。禁止英文键。

ops≤12。已在册→update；新实体→add。定位优先 id 或现用名。
改名：disciple.update 旧名 + patch.name=新名；禁止对已在册者 disciple.add 新名。
update 必须有 patch。

op 字面量与最小例：
- disciple.add {"op":"disciple.add","name":"陆承渊","realm":"炼气一层","role":"外门弟子","gender":"男"}
- disciple.update {"op":"disciple.update","name":"陆承渊","patch":{"loyalty":85,"status":"外勤"}}
  改名 {"op":"disciple.update","name":"陆承渊","patch":{"name":"陆九"}}
- disciple.remove {"op":"disciple.remove","name":"某某"}
- faction.add/update stance∈同盟|友好|中立|敌对|觊觎
  {"op":"faction.add","name":"霜刃盟","relation":-10,"stance":"中立"}
  {"op":"faction.update","name":"赤焰谷","patch":{"relation":-40,"stance":"敌对"}}
- city.add/update attitude∈恭顺|中立|犹豫|敌视
  {"op":"city.add","name":"落雁城","attitude":"中立","influence":20}
  {"op":"city.update","name":"青石城","patch":{"attitude":"犹豫"}}
- manual.add/update {"op":"manual.add","name":"霜刃心法","school":"剑道","grade":"玄品"}
- treasure.add/update {"op":"treasure.add","name":"玄铁令","type":"信物","owner":null}
- forge.add/update type∈法宝|飞剑|护甲|法器 progress0-100
- relation.add/update type∈师徒|道侣|结义|仇恨|竞争|血缘 from/to=id或名
- heir.add/update 指向在册弟子
- notify.push {"op":"notify.push","title":"山门来客","body":"…"}

弟子 status∈在宗|闭关|外勤|受伤|叛离风险。
只记正文已发生或明确立即生效的变更。`

/** 解析失败重试时追加，压模型只吐 JSON */
export const SETTLE_RETRY_HINT =
  '【重试】上轮输出无法解析。本轮只输出一个合法 JSON 对象，从 { 开始到 } 结束，不要任何其它文字。'

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
  /** 第 2 次及以后尝试时追加硬约束 */
  retryHint?: boolean
}): Array<{ role: string; content: string }> {
  const main = clipText(input.maintext, SETTLE_CLIP.maintext)
  const user = clipText(input.userText, SETTLE_CLIP.userText)
  const sum = clipText(input.sum, SETTLE_CLIP.sum)
  const focusText = [user, sum, main].filter(Boolean).join('\n')
  const body = [
    '【当前局面】',
    formatSnapshotForSettle(input.snap, { focusText }),
    `【玩家】${user || '无'}`,
    `【sum】${sum || '无'}`,
    `【剧情】${main || '无'}`,
    SETTLE_CONTRACT_HINT,
    input.retryHint ? SETTLE_RETRY_HINT : '',
  ]
    .filter(Boolean)
    .join('\n')
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

  // 非流式：短 JSON；失败（网络/解析）轻量重试 1 次，重试时加硬约束
  const loop = await withRetry(
    async (attempt) => {
      const messages = buildSettleMessages({
        userText: input.userText,
        maintext: input.maintext,
        sum: input.sum,
        snap: snap0,
        jailbreakPrompt: input.settings.settleJailbreakPrompt,
        retryHint: attempt > 1,
      })
      const body: Record<string, unknown> = {
        model: ep.model,
        messages,
        stream: false,
        temperature: 0,
        max_tokens: SETTLE_MAX_TOKENS,
      }
      const res = await input.postChat({ target, body })
      if (!res.ok) {
        return {
          status: 'failed' as const,
          error: res.error,
          stateAfter: snapshotWorldState(),
        }
      }
      const parsed = parseSettlePayload(res.text)
      if (!parsed.ok) {
        return {
          status: 'failed' as const,
          error: parsed.error,
          stateAfter: snapshotWorldState(),
        }
      }
      const sanitized = sanitizeWorldDelta(parsed.delta)
      // 模型常把库存绝对值当 delta → 客户端纠回相对量，防灵石翻倍
      const { resources: fixedRes, warnings: resWarn } = normalizeResourceDeltasAgainstSnap(
        sanitized.resources,
        snap0,
      )
      const delta = { ...sanitized, resources: fixedRes }
      const v = validateWorldDelta(delta, snap0)
      const clean = v.delta ?? { ops: [], resources: {} }
      const allWarn = [...resWarn, ...v.warnings]
      const hasRes = clean.resources && Object.keys(clean.resources).length > 0
      const hasOps = (clean.ops?.length ?? 0) > 0
      if (!hasRes && !hasOps) {
        const base = clean.summary || delta.summary || ''
        const skipHint = allWarn.length
          ? `（已跳过：${allWarn.slice(0, 2).join('；')}）`
          : ''
        const summary = (base + skipHint).trim() || undefined
        return {
          status: 'empty' as const,
          summary,
          stateAfter: snapshotWorldState(),
        }
      }
      const applied = applyValidatedDelta(clean)
      const stateAfter = snapshotWorldState()
      if (!applied.changed) {
        return {
          status: 'empty' as const,
          summary: clean.summary ?? delta.summary,
          stateAfter,
        }
      }
      const lines =
        allWarn.length > 0
          ? [...applied.lines, `（部分修正/跳过 ${allWarn.length} 项）`]
          : applied.lines
      return {
        status: 'applied' as const,
        lines,
        summary: clean.summary ?? delta.summary,
        stateAfter,
      }
    },
    {
      maxAttempts: DEFAULT_API_MAX_ATTEMPTS,
      shouldRetry: (r) =>
        r.status === 'failed' && isRetryableFailureMessage(r.error || ''),
    },
  )

  const out = loop.result
  if (out.status === 'failed') {
    return {
      ...out,
      error: withRetryHint(out.error, loop.attempts),
      attempts: loop.attempts,
    }
  }
  return { ...out, attempts: loop.attempts }
}
