/**
 * Post-story settle: secondary (or primary) JSON delta → validate → apply
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
  // secondary_then_primary
  if (secondaryEnabled) return { kind: 'call', targets: ['secondary', 'primary'] }
  return { kind: 'call', targets: ['primary'] }
}

export function formatSnapshotForSettle(snap: WorldSnapshot): string {
  const res = snap.resources
  const disc = snap.disciples
    .slice(0, 20)
    .map((d) => `${d.id}:${d.name}|${d.realm}|${d.status}|忠${d.loyalty}`)
    .join('\n')
  const fac = snap.factions
    .map((f) => `${f.id}:${f.name}|rel${f.relation}|${f.stance}`)
    .join('\n')
  const city = snap.cities
    .map((c) => `${c.id}:${c.name}|${c.attitude}|inf${c.influence}`)
    .join('\n')
  return [
    `资源：灵石${res.spiritStone} 灵谷${res.spiritGrain} 丹材${res.herb} 矿铁${res.ore} 声望${res.prestige} 气运${res.destiny}`,
    `历法：${snap.calendar.year}年 ${snap.calendar.season} 第${snap.calendar.day}日 宗门:${snap.sectName} 掌门:${snap.masterName}`,
    `弟子：\n${disc || '（无）'}`,
    `势力：\n${fac || '（无）'}`,
    `城池：\n${city || '（无）'}`,
  ].join('\n')
}

const SETTLE_SCHEMA_HINT = `只输出一个 JSON 对象（不要 Markdown 围栏外的说明），形状：
{
  "resources": { "灵石": -30 或 绝对数, "灵谷"|"丹材"|"矿铁"|"声望"|"气运": ... },
  "ops": [
    { "op":"disciple.add", "name":"...", "gender":"男|女", "realm":"...", "role":"...", "status":"在宗|闭关|外勤|受伤|叛离风险" },
    { "op":"disciple.update", "id":"d1" 或 "name":"...", "patch": { "loyalty":80, "status":"外勤", "realm":"..." } },
    { "op":"disciple.remove", "id":"..." 或 "name":"..." },
    { "op":"faction.update", "id":"fa1" 或 "name":"...", "patch": { "relation":40, "stance":"敌对|友好|同盟|中立|觊觎", "recent":"..." } },
    { "op":"city.update", "id":"c1" 或 "name":"...", "patch": { "attitude":"恭顺|中立|犹豫|敌视", "influence":55 } },
    { "op":"notify.push", "title":"...", "body":"..." }
  ],
  "summary": "一句话局面变化"
}
规则：
1. 你是自动局面分析：综合【玩家发言】【剧情】【sum】与【当前局面】，推断本回应写入的变更。
2. 玩家口头声明（如「收张三为徒」「与赤焰谷交恶」）若被剧情确认或未被明确否定，应结算；剧情否决则不结算。
3. 只记本回已生效的变更；禁止凭空新增未在对话中出现的人名/势力。
4. 无变更时 {"resources":{},"ops":[],"summary":"无局面变更"}；ops≤12，disciple.add≤3。`

function buildSettleMessages(input: {
  userText: string
  maintext: string
  sum: string
  snap: WorldSnapshot
  errorFeedback?: string
}): Array<{ role: string; content: string }> {
  const body = [
    '【任务】对本回对话做局面变量分析，输出 JSON 补丁（系统将自动写回名册/外交/城池/资源）。',
    '',
    '【当前局面】',
    formatSnapshotForSettle(input.snap),
    '',
    '【本回玩家】',
    input.userText || '（无）',
    '',
    '【本回剧情】',
    input.maintext || '（无）',
    '',
    '【本回 sum】',
    input.sum || '（无）',
    '',
    SETTLE_SCHEMA_HINT,
  ]
  if (input.errorFeedback) {
    body.push('', '【上次校验失败，请修正】', input.errorFeedback)
  }
  return [
    {
      role: 'system',
      content:
        '你是宗门自动局面分析器（变量结算）。只根据本回对话与当前局面输出严格 JSON 补丁，不要写故事，不要解释。',
    },
    { role: 'user', content: body.join('\n') },
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
  let lastError = '结算失败'

  for (const target of plan.targets) {
    const ep = endpointFor(input.settings, target)
    if (!ep.baseUrl || !ep.apiKey || !ep.model) {
      lastError = `${target} API 未配齐`
      continue
    }

    let errorFeedback: string | undefined
    for (let attempt = 0; attempt < 2; attempt++) {
      const messages = buildSettleMessages({
        userText: input.userText,
        maintext: input.maintext,
        sum: input.sum,
        snap: snap0,
        errorFeedback,
      })
      const body: Record<string, unknown> = {
        model: ep.model,
        messages,
        stream: false,
        temperature: 0.2,
        max_tokens: 1200,
      }
      const res = await input.postChat({ target, body })
      if (!res.ok) {
        lastError = res.error
        break // try next target
      }
      const parsed = parseSettlePayload(res.text)
      if (!parsed.ok) {
        lastError = parsed.error
        errorFeedback = parsed.error
        continue
      }
      const v = validateWorldDelta(parsed.delta, snap0)
      if (!v.ok) {
        lastError = v.errors.join('；')
        errorFeedback = lastError
        continue
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
  }

  return {
    status: 'failed',
    error: lastError,
    stateAfter: snapshotWorldState(),
  }
}
