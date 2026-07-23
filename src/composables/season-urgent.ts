/**
 * 岁月流转后：用主 API 生成本季「紧急与待决」。
 * 不走次 API；不依赖 response_format / json_schema。
 */
import type { AppSettings } from '@/sillytavern/types'
import type { EventChoice, Resources, UrgentEvent } from '@/types/game'
import type { WorldSnapshot } from '@/types/world'
import { RESOURCE_VAR_MAP } from '@/composables/game-bridge'
import { formatSnapshotForSettle, clipText } from '@/composables/settle-runner'
import { extractChatCompletionText } from '@/sillytavern/api-tools'
import { normalizeBaseUrl } from '@/composables/api-cache'
import { postChatCompletion } from '@/sillytavern'

const RESOURCE_CN = new Set(Object.keys(RESOURCE_VAR_MAP))
const SEVERITIES = new Set(['info', 'warn', 'critical'])

export const MAX_OPEN_URGENTS = 5
export const MAX_SEASON_NEW_EVENTS = 3

export const SEASON_URGENT_SYSTEM = [
  '你是修真宗门经营游戏的「季报待决」生成器，不是说书人。',
  '唯一任务：根据当前局面与近期记忆，为本季生成 1～3 条掌门待决事务。',
  '只输出可被 JSON.parse 的一个对象；禁止故事正文、markdown 围栏、前后缀解释。',
].join('')

export const SEASON_URGENT_CONTRACT = `【输出契约】
只输出一个 JSON 对象（双引号，无尾逗号，无其它文字）：
{"events":[...],"summary":"本季新务一句话"}

events 1～3 条。每条：
{
  "title":"短标题",
  "summary":"两句内说明事由与利害",
  "severity":"info|warn|critical",
  "source":"来源（如山门执事、灵田管事）",
  "choices":[
    {"id":"a","label":"选项名","effect":"效果简述","risk":"可选","resourceDelta":{"灵石":-10}},
    {"id":"b","label":"另一选项","effect":"…"}
  ]
}

规则：
- 每条 choices 2～3 个；id 用短英文字母数字
- resourceDelta 可选，键只能是：灵石、灵谷、丹材、矿铁、声望、气运；值为数字相对变化
- 若选项应转入天机叙事交涉，加 "openTianji":true（该选项可不写 resourceDelta）
- 事务须贴合局面与记忆，勿与【仍待决】标题重复
- 禁止虚构与当前宗门完全无关的跨界奇闻
- 无合适新务时：{"events":[],"summary":"本季暂无新待决"}`

export function buildSeasonUrgentMessages(input: {
  snap: WorldSnapshot
  year: number
  season: string
  memoryBrief: string
  openTitles: string[]
}): Array<{ role: string; content: string }> {
  const openLine =
    input.openTitles.length > 0
      ? input.openTitles.map((t) => `· ${t}`).join('\n')
      : '（无）'
  const body = [
    `【历法】${input.year} 年 · ${input.season}（刚进入本季）`,
    '【当前局面】',
    formatSnapshotForSettle(input.snap),
    `【近期记忆】${clipText(input.memoryBrief || '无', 500)}`,
    '【仍待决·请勿重复】',
    openLine,
    SEASON_URGENT_CONTRACT,
  ].join('\n')
  return [
    { role: 'system', content: SEASON_URGENT_SYSTEM },
    { role: 'user', content: body },
  ]
}

function stripFence(text: string): string {
  let s = text.trim()
  s = s.replace(/^\uFEFF/, '').replace(/[\u200B-\u200D\uFEFF]/g, '')
  s = s.replace(/<\/?(?:think|thinking|reasoning)[^>]*>/gi, ' ')
  const fence = /```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```/i
  const m = s.match(fence)
  if (m) s = m[1].trim()
  return s.trim()
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inStr: '"' | "'" | null = null
  let esc = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === inStr) inStr = null
      continue
    }
    if (ch === '"' || ch === "'") {
      inStr = ch
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

function mapResourceDelta(raw: unknown): Partial<Resources> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Partial<Resources> = {}
  let any = false
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!RESOURCE_CN.has(k)) continue
    const n = typeof v === 'number' ? v : Number(v)
    if (!Number.isFinite(n)) continue
    const key = RESOURCE_VAR_MAP[k as keyof typeof RESOURCE_VAR_MAP]
    out[key] = n
    any = true
  }
  return any ? out : undefined
}

function normalizeChoice(raw: unknown, index: number): EventChoice | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const label = typeof o.label === 'string' ? o.label.trim() : ''
  if (!label) return null
  const id =
    typeof o.id === 'string' && o.id.trim()
      ? o.id.trim().slice(0, 24)
      : `c${index + 1}`
  const effect =
    typeof o.effect === 'string' && o.effect.trim() ? o.effect.trim() : '待观察'
  const choice: EventChoice = {
    id,
    label: label.slice(0, 40),
    effect: effect.slice(0, 80),
  }
  if (typeof o.risk === 'string' && o.risk.trim()) choice.risk = o.risk.trim().slice(0, 60)
  const rd = mapResourceDelta(o.resourceDelta)
  if (rd) choice.resourceDelta = rd
  if (o.openTianji === true) choice.openTianji = true
  return choice
}

/** 规范化单条模型事件 → UrgentEvent；不合格返回 null */
export function normalizeSeasonEvent(
  raw: unknown,
  opts: { idPrefix: string; index: number; timeLabel: string },
): UrgentEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const title = typeof o.title === 'string' ? o.title.trim() : ''
  const summary = typeof o.summary === 'string' ? o.summary.trim() : ''
  if (!title || !summary) return null

  const choicesRaw = Array.isArray(o.choices) ? o.choices : []
  const choices = choicesRaw
    .map((c, i) => normalizeChoice(c, i))
    .filter((c): c is EventChoice => !!c)
    .slice(0, 4)
  if (choices.length < 2) return null

  let severity: UrgentEvent['severity'] = 'info'
  if (typeof o.severity === 'string' && SEVERITIES.has(o.severity)) {
    severity = o.severity as UrgentEvent['severity']
  }

  const source =
    typeof o.source === 'string' && o.source.trim()
      ? o.source.trim().slice(0, 24)
      : '宗门议事'

  return {
    id: `${opts.idPrefix}-${opts.index}-${Date.now().toString(36)}`,
    title: title.slice(0, 48),
    summary: summary.slice(0, 280),
    severity,
    source,
    timeLabel: opts.timeLabel,
    status: 'open',
    choices,
  }
}

export type ParseSeasonUrgentResult =
  | { ok: true; events: UrgentEvent[]; summary: string }
  | { ok: false; error: string }

/** 解析主 API 返回的季报待决 JSON */
export function parseSeasonUrgentPayload(
  text: string,
  opts?: { timeLabel?: string; idPrefix?: string },
): ParseSeasonUrgentResult {
  const raw = stripFence(text || '')
  if (!raw) return { ok: false, error: '空待决内容' }
  const candidate = extractFirstJsonObject(raw) || raw
  let parsed: unknown
  try {
    parsed = JSON.parse(candidate)
  } catch (e) {
    return { ok: false, error: `JSON 解析失败：${(e as Error).message || String(e)}` }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: '待决 JSON 须为对象' }
  }
  const root = parsed as Record<string, unknown>
  const list = Array.isArray(root.events) ? root.events : []
  const timeLabel = opts?.timeLabel || '本季'
  const idPrefix = opts?.idPrefix || 'evt-season'
  const events: UrgentEvent[] = []
  for (let i = 0; i < list.length && events.length < MAX_SEASON_NEW_EVENTS; i++) {
    const ev = normalizeSeasonEvent(list[i], {
      idPrefix,
      index: i,
      timeLabel,
    })
    if (ev) events.push(ev)
  }
  const summary =
    typeof root.summary === 'string' && root.summary.trim()
      ? root.summary.trim().slice(0, 80)
      : events.length
        ? `新待决 ${events.length} 件`
        : '本季暂无新待决'
  return { ok: true, events, summary }
}

export type SeasonUrgentOutcome =
  | { status: 'skipped'; reason: 'no_primary_api' }
  | { status: 'empty'; summary: string }
  | { status: 'applied'; count: number; summary: string; events: UrgentEvent[] }
  | { status: 'failed'; error: string }

/**
 * 岁月流转后调用：固定主 API 生成待决列表（纯函数 + 注入 postChat 便于测）。
 */
export async function runSeasonUrgents(input: {
  settings: AppSettings
  snap: WorldSnapshot
  year: number
  season: string
  memoryBrief: string
  openTitles: string[]
  postChat?: (body: Record<string, unknown>) => Promise<
    { ok: true; text: string } | { ok: false; error: string }
  >
}): Promise<SeasonUrgentOutcome> {
  const api = input.settings.api
  const baseUrl = normalizeBaseUrl(api?.baseUrl || '')
  const apiKey = String(api?.apiKey || '').trim()
  const model = String(api?.model || '').trim()
  if (!baseUrl || !apiKey || !model) {
    return { status: 'skipped', reason: 'no_primary_api' }
  }

  const messages = buildSeasonUrgentMessages({
    snap: input.snap,
    year: input.year,
    season: input.season,
    memoryBrief: input.memoryBrief,
    openTitles: input.openTitles,
  })

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: false,
    temperature: 0.4,
    max_tokens: 1200,
  }

  let res: { ok: true; text: string } | { ok: false; error: string }
  if (input.postChat) {
    res = await input.postChat(body)
  } else {
    const completion = await postChatCompletion({
      baseUrl,
      apiKey,
      body,
    })
    if (!completion.ok) {
      res = { ok: false, error: completion.error || '主 API 请求失败' }
    } else {
      const extracted = extractChatCompletionText(completion.data)
      const t = (extracted.text || '').trim()
      if (!t) {
        const bits = ['主 API 返回为空']
        if (extracted.finishReason) bits.push(`finish_reason=${extracted.finishReason}`)
        res = { ok: false, error: bits.join('；') }
      } else {
        res = { ok: true, text: extracted.text }
      }
    }
  }

  if (!res.ok) {
    return { status: 'failed', error: res.error }
  }

  const parsed = parseSeasonUrgentPayload(res.text, {
    timeLabel: `${input.season}`,
    idPrefix: `evt-y${input.year}`,
  })
  if (!parsed.ok) {
    return { status: 'failed', error: parsed.error }
  }
  if (!parsed.events.length) {
    return { status: 'empty', summary: parsed.summary }
  }
  return {
    status: 'applied',
    count: parsed.events.length,
    summary: parsed.summary,
    events: parsed.events,
  }
}
