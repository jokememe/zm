/**
 * WorldDelta pure engine: parse settle JSON → validate → apply on snapshot
 */
import type {
  WorldDelta,
  WorldOp,
  WorldSnapshot,
  ValidateResult,
  ApplyResult,
} from '@/types/world'
import type { CityState, Disciple, Faction, NotificationItem, Resources } from '@/types/game'
import {
  RESOURCE_VAR_MAP,
  resolveRelativeResourceValue,
  type ResourceVarName,
} from '@/composables/game-bridge'

const RESOURCE_CN = new Set<string>(Object.keys(RESOURCE_VAR_MAP))

const DISCIPLE_STATUS = new Set<Disciple['status']>([
  '在宗',
  '闭关',
  '外勤',
  '受伤',
  '叛离风险',
])
const FACTION_STANCE = new Set<Faction['stance']>(['同盟', '友好', '中立', '敌对', '觊觎'])
const CITY_ATTITUDE = new Set<CityState['attitude']>(['恭顺', '中立', '犹豫', '敌视'])
const GENDERS = new Set(['男', '女'])

/** 单回 ops 总上限（防异常刷屏）；不再单独限制 disciple.add 条数 */
const MAX_OPS = 12

export type ParseSettleResult =
  | { ok: true; delta: WorldDelta }
  | { ok: false; error: string }

function stripFence(text: string): string {
  let s = text.trim()
  // BOM / 零宽字符
  s = s.replace(/^\uFEFF/, '').replace(/[\u200B-\u200D\uFEFF]/g, '')
  // 去掉常见思考标签外壳
  s = s.replace(/<\/?(?:think|thinking|reasoning)[^>]*>/gi, ' ')
  const fence = /```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```/i
  const m = s.match(fence)
  if (m) s = m[1].trim()
  return s.trim()
}

/**
 * 从杂文中抠出第一个平衡的 {...} 对象。
 * 同时识别双引号 / 单引号字符串，避免字符串内的 } 误截断。
 */
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

/**
 * 模型常吐出「近似 JSON」：单引号、无引号键、尾逗号、全角括号。
 * 错误示例：Expected property name or '}' in JSON at position 1
 * 对应：{'resources':...} 或 {resources:...}
 */
export function repairLooseJson(input: string): string {
  let s = input.trim()
  // 全角括号 / 包裹
  s = s.replace(/^[（(【\[]+/, '').replace(/[）)】\]]+$/, '')
  // 智能引号 → ASCII
  s = s
    .replace(/[\u201C\u201D\u300C\u300D]/g, '"')
    .replace(/[\u2018\u2019\u300E\u300F]/g, "'")

  // 去掉对象/数组尾逗号：{"a":1,} / [1,]
  s = s.replace(/,(\s*[}\]])/g, '$1')

  // 单引号字符串 → 双引号（键与值）
  s = s.replace(/'((?:\\.|[^'\\])*)'/g, (_m, inner: string) => {
    const escaped = inner
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
    return `"${escaped}"`
  })

  // 无引号键 → 加双引号（含中文键：灵石）
  // 仅在 { 或 , 之后、: 之前
  s = s.replace(
    /([{\[,]\s*)([A-Za-z_\u4e00-\u9fff$][\w\u4e00-\u9fff$]*)(\s*:)/g,
    '$1"$2"$3',
  )

  // 再次清尾逗号（引号修复后可能仍残留）
  s = s.replace(/,(\s*[}\]])/g, '$1')
  return s
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function deltaFromParsed(parsed: Record<string, unknown>): ParseSettleResult {
  const delta: WorldDelta = {}
  if (parsed.resources !== undefined) {
    if (!isPlainObject(parsed.resources)) {
      return { ok: false, error: 'resources 须为对象' }
    }
    delta.resources = parsed.resources as WorldDelta['resources']
  }
  if (parsed.ops !== undefined) {
    if (!Array.isArray(parsed.ops)) return { ok: false, error: 'ops 须为数组' }
    delta.ops = parsed.ops as WorldOp[]
  }
  if (parsed.summary !== undefined) {
    delta.summary = String(parsed.summary)
  }
  if (!delta.resources) delta.resources = {}
  if (!delta.ops) delta.ops = []
  return { ok: true, delta }
}

function tryParseObject(candidate: string): { ok: true; obj: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(candidate) as unknown
    if (!isPlainObject(parsed)) return { ok: false, error: '结算 JSON 须为对象' }
    return { ok: true, obj: parsed }
  } catch (e) {
    return { ok: false, error: (e as Error).message || String(e) }
  }
}

function snippet(s: string, n = 80): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length <= n ? t : t.slice(0, n) + '…'
}

export function parseSettlePayload(text: string): ParseSettleResult {
  try {
    const raw = stripFence(text)
    if (!raw) return { ok: false, error: '空结算内容' }

    const seeds: string[] = [raw]
    const embedded = extractFirstJsonObject(raw)
    if (embedded && embedded !== raw) seeds.push(embedded)

    // 每种种子：原样 → 宽松修复
    const attempts: string[] = []
    for (const seed of seeds) {
      attempts.push(seed)
      const repaired = repairLooseJson(seed)
      if (repaired !== seed) attempts.push(repaired)
      // 对修复后再抠一次对象（处理前缀「分析如下」+ 全角括号）
      const emb2 = extractFirstJsonObject(repaired)
      if (emb2 && !attempts.includes(emb2)) attempts.push(emb2)
    }

    let lastErr = ''
    for (const candidate of attempts) {
      const r = tryParseObject(candidate)
      if (r.ok) return deltaFromParsed(r.obj)
      lastErr = r.error
    }
    return {
      ok: false,
      error: `JSON 解析失败：${lastErr}（片段：${snippet(embedded || raw)}）`,
    }
  } catch (e) {
    return { ok: false, error: `JSON 解析失败：${(e as Error).message || String(e)}` }
  }
}

function resolveByIdOrName<T extends { id: string; name: string }>(
  list: T[],
  id?: string,
  name?: string,
  label?: string,
): { item?: T; error?: string } {
  const tag = label || '实体'
  if (id) {
    const hit = list.find((x) => x.id === id)
    if (!hit) return { error: `${tag} id 不存在：${id}` }
    return { item: hit }
  }
  if (name) {
    const hits = list.filter((x) => x.name === name)
    if (hits.length === 0) return { error: `${tag} 名不存在：${name}` }
    if (hits.length > 1) return { error: `${tag} 名不唯一：${name}` }
    return { item: hits[0] }
  }
  return { error: `${tag} 须提供 id 或 name` }
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** 模型常用的 name 别名字段 */
function pickNameAlias(raw: Record<string, unknown>): string {
  for (const key of ['name', '姓名', '弟子名', 'character', 'disciple', 'disciple_name'] as const) {
    const v = raw[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

/**
 * 规范化模型输出的 delta，避免「用了 姓名 / 缺 name」整包校验失败。
 * - disciple.add：别名 → name；无 name 无法入册才丢弃；**有 name 的全部保留**
 * - ops 超过 MAX_OPS 时截断（总条数护栏，不单独砍收徒）
 * - 非法资源键丢弃
 */
export function sanitizeWorldDelta(delta: WorldDelta): WorldDelta {
  const resources: WorldDelta['resources'] = {}
  if (delta.resources && isPlainObject(delta.resources)) {
    for (const [k, v] of Object.entries(delta.resources)) {
      if (RESOURCE_CN.has(k)) {
        ;(resources as Record<string, string | number>)[k] = v as string | number
      }
    }
  }

  const opsIn = Array.isArray(delta.ops) ? delta.ops : []
  const ops: WorldOp[] = []

  for (const rawOp of opsIn) {
    if (ops.length >= MAX_OPS) break
    if (!rawOp || typeof rawOp !== 'object') continue
    const raw = rawOp as Record<string, unknown>
    const kind = typeof raw.op === 'string' ? raw.op : ''
    if (!kind) continue

    if (kind === 'disciple.add') {
      const name = pickNameAlias(raw)
      // 没有可写姓名的 add 无法入册，丢弃这一条；不截断「第 4、5 个有名新人」
      if (!name) continue
      const next: Extract<WorldOp, { op: 'disciple.add' }> = { op: 'disciple.add', name }
      if (raw.gender === '男' || raw.gender === '女') next.gender = raw.gender
      if (typeof raw.age === 'number') next.age = raw.age
      if (typeof raw.realm === 'string') next.realm = raw.realm
      if (typeof raw.aptitude === 'string') next.aptitude = raw.aptitude
      if (typeof raw.role === 'string') next.role = raw.role
      if (typeof raw.loyalty === 'number') next.loyalty = raw.loyalty
      if (typeof raw.mood === 'string') next.mood = raw.mood
      if (Array.isArray(raw.talent)) next.talent = raw.talent.map(String)
      if (typeof raw.status === 'string' && DISCIPLE_STATUS.has(raw.status as Disciple['status'])) {
        next.status = raw.status as Disciple['status']
      }
      if (typeof raw.master === 'string') next.master = raw.master
      ops.push(next)
      continue
    }

    // 其它 op：浅拷贝保留，后续 validate 再严查
    ops.push(rawOp as WorldOp)
  }

  return {
    resources,
    ops,
    summary: delta.summary !== undefined ? String(delta.summary) : undefined,
  }
}

/**
 * 校验单条 op；返回 null 表示通过，否则为错误文案。
 */
function validateOneOp(op: WorldOp & { op?: string }, snap: WorldSnapshot, index: number): string | null {
  if (!op || typeof op !== 'object' || !op.op) {
    return `ops[${index}] 非法`
  }
  const prefix = `ops[${index}] ${op.op}`

  switch (op.op) {
    case 'disciple.add': {
      if (!op.name || !String(op.name).trim()) return `${prefix}: name 必填`
      if (op.gender !== undefined && !GENDERS.has(op.gender)) return `${prefix}: gender 非法`
      if (op.status !== undefined && !DISCIPLE_STATUS.has(op.status)) return `${prefix}: status 非法`
      if (op.loyalty !== undefined && !isFiniteNumber(op.loyalty)) return `${prefix}: loyalty 须为数字`
      return null
    }
    case 'disciple.update': {
      const r = resolveByIdOrName(snap.disciples, op.id, op.name, '弟子')
      if (r.error) return `${prefix}: ${r.error}`
      if (!op.patch || !isPlainObject(op.patch)) return `${prefix}: patch 必填`
      if (op.patch.status !== undefined && !DISCIPLE_STATUS.has(op.patch.status)) {
        return `${prefix}: status 非法`
      }
      if (op.patch.gender !== undefined && !GENDERS.has(op.patch.gender)) {
        return `${prefix}: gender 非法`
      }
      if (op.patch.loyalty !== undefined && !isFiniteNumber(op.patch.loyalty)) {
        return `${prefix}: loyalty 须为数字`
      }
      return null
    }
    case 'disciple.remove': {
      const r = resolveByIdOrName(snap.disciples, op.id, op.name, '弟子')
      if (r.error) return `${prefix}: ${r.error}`
      return null
    }
    case 'faction.update': {
      const r = resolveByIdOrName(snap.factions, op.id, op.name, '势力')
      if (r.error) return `${prefix}: ${r.error}`
      if (!op.patch || !isPlainObject(op.patch)) return `${prefix}: patch 必填`
      if (op.patch.stance !== undefined && !FACTION_STANCE.has(op.patch.stance)) {
        return `${prefix}: stance 非法`
      }
      if (op.patch.relation !== undefined && !isFiniteNumber(op.patch.relation)) {
        return `${prefix}: relation 须为数字`
      }
      return null
    }
    case 'city.update': {
      const r = resolveByIdOrName(snap.cities, op.id, op.name, '城池')
      if (r.error) return `${prefix}: ${r.error}`
      if (!op.patch || !isPlainObject(op.patch)) return `${prefix}: patch 必填`
      if (op.patch.attitude !== undefined && !CITY_ATTITUDE.has(op.patch.attitude)) {
        return `${prefix}: attitude 非法`
      }
      if (op.patch.influence !== undefined && !isFiniteNumber(op.patch.influence)) {
        return `${prefix}: influence 须为数字`
      }
      return null
    }
    case 'notify.push': {
      if (!op.title || !String(op.title).trim()) return `${prefix}: title 必填`
      return null
    }
    default:
      return `${prefix}: 未知 op`
  }
}

/**
 * 校验并** partial 清洗**：坏 op / 非法资源键跳过写入 warnings，好项保留。
 * ok 恒为 true（清洗后 delta 可安全 apply）；整包失败仅当调用方不使用返回的 delta。
 * 仍把跳过原因放在 errors 数组便于日志（settle 可选用 warnings）。
 */
export function validateWorldDelta(delta: WorldDelta, snap: WorldSnapshot): ValidateResult {
  const errors: string[] = []
  const warnings: string[] = []
  const opsIn = delta.ops ?? []

  const resources: WorldDelta['resources'] = {}
  if (delta.resources) {
    for (const [key, val] of Object.entries(delta.resources)) {
      if (!RESOURCE_CN.has(key)) {
        const msg = `非法资源键：${key}`
        errors.push(msg)
        warnings.push(msg)
        continue
      }
      ;(resources as Record<string, string | number>)[key] = val as string | number
    }
  }

  const kept: WorldOp[] = []
  for (let i = 0; i < opsIn.length; i++) {
    if (kept.length >= MAX_OPS) {
      const msg = `ops 超过上限 ${MAX_OPS}，已截断（原 ${opsIn.length} 条）`
      if (!warnings.includes(msg)) {
        errors.push(msg)
        warnings.push(msg)
      }
      break
    }
    const op = opsIn[i] as WorldOp & { op?: string }
    const err = validateOneOp(op, snap, i)
    if (err) {
      errors.push(err)
      warnings.push(`已跳过：${err}`)
      continue
    }
    kept.push(op as WorldOp)
  }

  const cleaned: WorldDelta = {
    resources: Object.keys(resources).length ? resources : undefined,
    ops: kept,
    summary: delta.summary !== undefined ? String(delta.summary) : undefined,
  }

  // partial apply：有可写内容或本就为空 → ok；仅当「有输入但全被丢掉」仍 ok（走 empty），
  // 调用方用 errors/warnings 提示。不再因单条坏 op 整包失败。
  return {
    ok: true,
    errors,
    warnings,
    delta: cleaned,
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)))
}

function cloneSnap(snap: WorldSnapshot): WorldSnapshot {
  return JSON.parse(JSON.stringify(snap)) as WorldSnapshot
}

let genSeq = 0

function nextId(prefix: string): string {
  genSeq += 1
  return `${prefix}-gen-${genSeq}-${Date.now().toString(36)}`
}

export function applyWorldDeltaToSnapshot(
  delta: WorldDelta,
  snap: WorldSnapshot,
): { snap: WorldSnapshot; result: ApplyResult } {
  const next = cloneSnap(snap)
  const lines: string[] = []
  let changed = false

  if (delta.resources) {
    for (const [cn, raw] of Object.entries(delta.resources)) {
      if (!(cn in RESOURCE_VAR_MAP)) continue
      const key = RESOURCE_VAR_MAP[cn as ResourceVarName]
      const cur = next.resources[key]
      // 结算契约：resources 值一律相对变化（JSON -10 = 减 10，不是设为 0）
      const val = resolveRelativeResourceValue(cur, raw as string | number)
      if (val !== cur) {
        next.resources[key] = val
        lines.push(`${cn} ${cur} → ${val}`)
        changed = true
      }
    }
  }

  for (const op of delta.ops ?? []) {
    switch (op.op) {
      case 'disciple.add': {
        const d: Disciple = {
          id: nextId('d'),
          name: String(op.name).trim(),
          gender: op.gender === '女' ? '女' : '男',
          age: typeof op.age === 'number' ? clamp(op.age, 1, 200) : 16,
          realm: op.realm || '炼气一层',
          aptitude: op.aptitude || '中等',
          role: op.role || '外门弟子',
          loyalty: typeof op.loyalty === 'number' ? clamp(op.loyalty, 0, 100) : 70,
          mood: op.mood || '平静',
          talent: Array.isArray(op.talent) ? op.talent.map(String) : [],
          status: op.status && DISCIPLE_STATUS.has(op.status) ? op.status : '在宗',
          avatarHue: Math.floor(Math.random() * 360),
          master: op.master || next.masterName,
        }
        next.disciples.push(d)
        lines.push(`收徒 ${d.name}（${d.realm}·${d.role}）`)
        changed = true
        break
      }
      case 'disciple.update': {
        const r = resolveByIdOrName(next.disciples, op.id, op.name, '弟子')
        if (!r.item || !op.patch) break
        const before = r.item.name
        const p = op.patch
        if (p.name !== undefined) r.item.name = String(p.name)
        if (p.gender === '男' || p.gender === '女') r.item.gender = p.gender
        if (typeof p.age === 'number') r.item.age = clamp(p.age, 1, 200)
        if (p.realm !== undefined) r.item.realm = String(p.realm)
        if (p.aptitude !== undefined) r.item.aptitude = String(p.aptitude)
        if (p.role !== undefined) r.item.role = String(p.role)
        if (typeof p.loyalty === 'number') r.item.loyalty = clamp(p.loyalty, 0, 100)
        if (p.mood !== undefined) r.item.mood = String(p.mood)
        if (Array.isArray(p.talent)) r.item.talent = p.talent.map(String)
        if (p.status && DISCIPLE_STATUS.has(p.status)) r.item.status = p.status
        if (p.master !== undefined) r.item.master = String(p.master)
        if (p.spouse !== undefined) r.item.spouse = String(p.spouse)
        lines.push(`弟子 ${before} 状态更新`)
        changed = true
        break
      }
      case 'disciple.remove': {
        const r = resolveByIdOrName(next.disciples, op.id, op.name, '弟子')
        if (!r.item) break
        r.item.status = '叛离风险'
        r.item.mood = '离宗'
        lines.push(`弟子 ${r.item.name} 离宗风险`)
        changed = true
        break
      }
      case 'faction.update': {
        const r = resolveByIdOrName(next.factions, op.id, op.name, '势力')
        if (!r.item || !op.patch) break
        const p = op.patch
        if (typeof p.relation === 'number') r.item.relation = clamp(p.relation, -100, 100)
        if (p.stance && FACTION_STANCE.has(p.stance)) r.item.stance = p.stance
        if (p.recent !== undefined) r.item.recent = String(p.recent)
        if (p.demand !== undefined) r.item.demand = String(p.demand)
        if (p.power !== undefined) r.item.power = String(p.power)
        lines.push(`势力 ${r.item.name} 关系更新`)
        changed = true
        break
      }
      case 'city.update': {
        const r = resolveByIdOrName(next.cities, op.id, op.name, '城池')
        if (!r.item || !op.patch) break
        const p = op.patch
        if (p.attitude && CITY_ATTITUDE.has(p.attitude)) r.item.attitude = p.attitude
        if (typeof p.influence === 'number') r.item.influence = clamp(p.influence, 0, 100)
        if (p.notes !== undefined) r.item.notes = String(p.notes)
        if (p.governor !== undefined) r.item.governor = String(p.governor)
        lines.push(`城池 ${r.item.name} 态度更新`)
        changed = true
        break
      }
      case 'notify.push': {
        const n: NotificationItem = {
          id: nextId('n'),
          title: String(op.title).trim(),
          body: op.body ? String(op.body) : '',
          time: '此刻',
          read: false,
          category: op.category ? String(op.category) : '天机',
        }
        next.notifications = [n, ...next.notifications]
        lines.push(`急报：${n.title}`)
        changed = true
        break
      }
    }
  }

  if (delta.summary?.trim()) {
    // summary is metadata only
  }

  return { snap: next, result: { lines, changed } }
}

/** Empty minimal snapshot for unit tests */
export function emptyTestSnapshot(partial?: Partial<WorldSnapshot>): WorldSnapshot {
  const resources: Resources = {
    spiritStone: 1000,
    spiritGrain: 500,
    herb: 50,
    ore: 40,
    prestige: 20,
    destiny: 10,
  }
  return {
    resources,
    calendar: { year: 1, season: '孟春', day: 1 },
    sectName: '测试宗',
    masterName: '测试掌门',
    disciples: [],
    factions: [],
    cities: [],
    notifications: [],
    fieldPlots: [],
    urgentEvents: [],
    ...partial,
  }
}
