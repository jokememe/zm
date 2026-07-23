/**
 * Post-story settle: secondary (or primary) JSON delta → validate → apply
 * 设计目标：快、少调用。单次尝试、短 prompt、小 max_tokens；不链式二次回退。
 */
import type { AppSettings } from '@/sillytavern/types'
import type { SettlementMode, WorldSnapshot } from '@/types/world'
import {
  parseSettlePayload,
  validateWorldDelta,
} from '@/composables/world-delta'
import {
  snapshotWorldState,
  applyValidatedDelta,
} from '@/composables/world-state'
import { normalizeBaseUrl } from '@/composables/api-cache'

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

const SETTLE_SCHEMA_HINT = `只输出严格 JSON（双引号键值，无尾逗号，无其它文字）：
{"resources":{"灵石":0},"ops":[],"summary":""}
ops 可选：disciple.add|update|remove，faction.update，city.update，notify.push
字段用 id 或 name 定位；无变更时 ops=[] resources={} summary="无"
最多 8 条 op。禁止单引号、禁止 markdown 代码块外的解释。`

function buildSettleMessages(input: {
  userText: string
  maintext: string
  sum: string
  snap: WorldSnapshot
}): Array<{ role: string; content: string }> {
  // 优先 sum + 短剧情，控制 token
  const main = clipText(input.maintext, 700)
  const user = clipText(input.userText, 280)
  const sum = clipText(input.sum, 200)
  const body = [
    formatSnapshotForSettle(input.snap),
    `玩家：${user || '无'}`,
    `sum：${sum || '无'}`,
    `剧情：${main || '无'}`,
    SETTLE_SCHEMA_HINT,
  ].join('\n')
  return [
    {
      role: 'system',
      content:
        '局面结算器。根据本回对话输出严格 JSON 补丁，禁止故事与解释。',
    },
    { role: 'user', content: body },
  ]
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
  const v = validateWorldDelta(parsed.delta, snap0)
  if (!v.ok) {
    return {
      status: 'failed',
      error: v.errors.join('；'),
      stateAfter: snapshotWorldState(),
    }
  }

  const hasRes = parsed.delta.resources && Object.keys(parsed.delta.resources).length > 0
  const hasOps = (parsed.delta.ops?.length ?? 0) > 0
  if (!hasRes && !hasOps) {
    return {
      status: 'empty',
      summary: parsed.delta.summary,
      stateAfter: snapshotWorldState(),
    }
  }

  const applied = applyValidatedDelta(parsed.delta)
  const stateAfter = snapshotWorldState()
  if (!applied.changed) {
    return {
      status: 'empty',
      summary: parsed.delta.summary,
      stateAfter,
    }
  }
  return {
    status: 'applied',
    lines: applied.lines,
    summary: parsed.delta.summary,
    stateAfter,
  }
}
