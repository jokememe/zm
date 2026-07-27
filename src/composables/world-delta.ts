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
import type {
  CityState,
  Disciple,
  Faction,
  ForgeItem,
  HeirCandidate,
  Manual,
  NotificationItem,
  RelationEdge,
  Resources,
  Treasure,
} from '@/types/game'
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
const RELATION_TYPES = new Set<RelationEdge['type']>([
  '师徒',
  '道侣',
  '结义',
  '仇恨',
  '竞争',
  '血缘',
])
const FORGE_TYPES = new Set<ForgeItem['type']>(['法宝', '飞剑', '护甲', '法器'])

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

/**
 * 纠偏 resources：模型常把「当前库存」当成相对变化写出（例如库存 260 却写 {"灵石":260}）。
 * 规则（应用前）：
 * - 仅拦截「与当前库存非常接近的正数」（像在抄库存，而不是发奖励）
 * - 明确保留：负数消耗、明显小于库存的正奖励、远离库存的大正数
 * - 另对单次相对量做 ±50000 夹取，防乱写
 */
export function normalizeResourceDeltasAgainstSnap(
  resources: WorldDelta['resources'] | undefined,
  snap: WorldSnapshot,
): { resources: WorldDelta['resources']; warnings: string[] } {
  const out: WorldDelta['resources'] = {}
  const warnings: string[] = []
  if (!resources || !isPlainObject(resources)) return { resources: out, warnings }

  for (const [cn, raw] of Object.entries(resources)) {
    if (!RESOURCE_CN.has(cn)) continue
    const key = RESOURCE_VAR_MAP[cn as ResourceVarName]
    const cur = snap.resources[key]
    let n: number | null = null
    if (typeof raw === 'number' && Number.isFinite(raw)) n = raw
    else {
      const s = String(raw ?? '')
        .trim()
        .replace(/^[−–—]/, '-')
      if (/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(s)) n = Number(s)
    }
    if (n === null || !Number.isFinite(n)) continue

    // 与库存几乎相等 → 几乎肯定是「写成了绝对值」而非「相对 +库存」
    // 阈值：|n-cur| ≤ max(8, cur×12%)，且 n 为正、cur≥15（小库存不误杀 +10 类）
    const nearStock =
      n > 0 &&
      cur >= 15 &&
      Math.abs(n - cur) <= Math.max(8, cur * 0.12)

    if (nearStock) {
      warnings.push(
        `${cn} 疑似写成库存绝对值 ${n}（当前 ${cur}），已忽略以免翻倍`,
      )
      continue
    }
    // 单次回合相对变化护栏：防模型乱写 ±99999
    const capped = Math.max(-50_000, Math.min(50_000, Math.round(n)))
    if (capped !== Math.round(n)) {
      warnings.push(`${cn} 相对量 ${n} 已夹到 ±50000`)
    }
    if (capped === 0) continue
    ;(out as Record<string, number>)[cn] = capped
  }
  return { resources: out, warnings }
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

/** 改名场景：模型常用的「旧名」字段 */
function pickFormerName(raw: Record<string, unknown>): string {
  for (const key of [
    'formerName',
    'oldName',
    'fromName',
    'renameFrom',
    '原名',
    '旧名',
    '曾用名',
    '原姓名',
  ] as const) {
    const v = raw[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

function discipleFieldsFromRaw(
  raw: Record<string, unknown>,
): Partial<Disciple> {
  const p: Partial<Disciple> = {}
  if (raw.gender === '男' || raw.gender === '女') p.gender = raw.gender
  if (typeof raw.age === 'number') p.age = raw.age
  if (typeof raw.realm === 'string') p.realm = raw.realm
  if (typeof raw.aptitude === 'string') p.aptitude = raw.aptitude
  if (typeof raw.role === 'string') p.role = raw.role
  if (typeof raw.loyalty === 'number') p.loyalty = raw.loyalty
  if (typeof raw.mood === 'string') p.mood = raw.mood
  if (Array.isArray(raw.talent)) p.talent = raw.talent.map(String)
  if (typeof raw.status === 'string' && DISCIPLE_STATUS.has(raw.status as Disciple['status'])) {
    p.status = raw.status as Disciple['status']
  }
  if (typeof raw.master === 'string') p.master = raw.master
  if (typeof raw.spouse === 'string') p.spouse = raw.spouse
  return p
}

/** 模型常用的 name 别名字段（弟子 / 势力 / 城池） */
function pickNameAlias(raw: Record<string, unknown>): string {
  for (const key of [
    'name',
    '姓名',
    '弟子名',
    '势力名',
    '城名',
    '城池名',
    'character',
    'disciple',
    'disciple_name',
    'faction',
    'faction_name',
    'city',
    'city_name',
  ] as const) {
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
      const former = pickFormerName(raw)
      const fields = discipleFieldsFromRaw(raw)
      // 改名误写成 add：收成 update，避免名册新旧并存
      if (former && former !== name) {
        ops.push({
          op: 'disciple.update',
          name: former,
          patch: { ...fields, name },
        })
        continue
      }
      const next: Extract<WorldOp, { op: 'disciple.add' }> = { op: 'disciple.add', name }
      Object.assign(next, fields)
      if (former) next.formerName = former
      ops.push(next)
      continue
    }

    if (kind === 'disciple.update') {
      const locator =
        (typeof raw.id === 'string' && raw.id.trim()) ||
        pickFormerName(raw) ||
        pickNameAlias(raw) ||
        (typeof raw.name === 'string' ? raw.name.trim() : '')
      let patch =
        raw.patch && typeof raw.patch === 'object' && !Array.isArray(raw.patch)
          ? { ...(raw.patch as Record<string, unknown>) }
          : ({} as Record<string, unknown>)
      // 模型常把改名写成顶层 name=新名、无 patch
      const newNameFromPatch =
        typeof patch.name === 'string' ? String(patch.name).trim() : ''
      const topName = pickNameAlias(raw)
      const former = pickFormerName(raw)
      if (!Object.keys(patch).length && topName && former && topName !== former) {
        patch = { name: topName, ...discipleFieldsFromRaw(raw) }
      } else if (
        topName &&
        former &&
        topName !== former &&
        !newNameFromPatch
      ) {
        patch = { ...patch, name: topName }
      }
      // 把顶层字段并进 patch（除定位）
      const extra = discipleFieldsFromRaw(raw)
      for (const [k, v] of Object.entries(extra)) {
        if (patch[k] === undefined) patch[k] = v
      }
      if (!Object.keys(patch).length) continue
      const next: Extract<WorldOp, { op: 'disciple.update' }> = {
        op: 'disciple.update',
        patch: patch as Extract<WorldOp, { op: 'disciple.update' }>['patch'],
      }
      if (typeof raw.id === 'string' && raw.id.trim()) next.id = raw.id.trim()
      else if (former) next.name = former
      else if (locator) next.name = locator
      if (former) next.formerName = former
      ops.push(next)
      continue
    }

    if (kind === 'faction.add') {
      const name = pickNameAlias(raw)
      if (!name) continue
      const next: Extract<WorldOp, { op: 'faction.add' }> = { op: 'faction.add', name }
      if (typeof raw.power === 'string') next.power = raw.power
      if (typeof raw.relation === 'number') next.relation = raw.relation
      if (typeof raw.stance === 'string' && FACTION_STANCE.has(raw.stance as Faction['stance'])) {
        next.stance = raw.stance as Faction['stance']
      }
      if (typeof raw.recent === 'string') next.recent = raw.recent
      if (typeof raw.demand === 'string') next.demand = raw.demand
      ops.push(next)
      continue
    }

    if (kind === 'city.add') {
      const name = pickNameAlias(raw)
      if (!name) continue
      const next: Extract<WorldOp, { op: 'city.add' }> = { op: 'city.add', name }
      if (typeof raw.distance === 'string') next.distance = raw.distance
      if (typeof raw.influence === 'number') next.influence = raw.influence
      if (
        typeof raw.attitude === 'string' &&
        CITY_ATTITUDE.has(raw.attitude as CityState['attitude'])
      ) {
        next.attitude = raw.attitude as CityState['attitude']
      }
      if (typeof raw.governor === 'string') next.governor = raw.governor
      if (typeof raw.notes === 'string') next.notes = raw.notes
      if (raw.tribute && typeof raw.tribute === 'object' && !Array.isArray(raw.tribute)) {
        const t = raw.tribute as Record<string, unknown>
        next.tribute = {
          type: typeof t.type === 'string' ? t.type : undefined,
          amount: typeof t.amount === 'number' ? t.amount : undefined,
          period: typeof t.period === 'string' ? t.period : undefined,
        }
      }
      ops.push(next)
      continue
    }

    if (kind === 'manual.add') {
      const name = pickNameAlias(raw)
      if (!name) continue
      const next: Extract<WorldOp, { op: 'manual.add' }> = { op: 'manual.add', name }
      if (typeof raw.school === 'string') next.school = raw.school
      if (typeof raw.grade === 'string') next.grade = raw.grade
      if (typeof raw.restriction === 'string') next.restriction = raw.restriction
      if (typeof raw.readers === 'number') next.readers = raw.readers
      if (typeof raw.insight === 'string') next.insight = raw.insight
      if (typeof raw.sealed === 'boolean') next.sealed = raw.sealed
      ops.push(next)
      continue
    }

    if (kind === 'treasure.add') {
      const name = pickNameAlias(raw)
      if (!name) continue
      const next: Extract<WorldOp, { op: 'treasure.add' }> = { op: 'treasure.add', name }
      if (typeof raw.type === 'string') next.type = raw.type
      if (typeof raw.grade === 'string') next.grade = raw.grade
      if (raw.owner === null) next.owner = null
      else if (typeof raw.owner === 'string') next.owner = raw.owner
      if (typeof raw.desc === 'string') next.desc = raw.desc
      if (typeof raw.bound === 'boolean') next.bound = raw.bound
      ops.push(next)
      continue
    }

    if (kind === 'forge.add') {
      const name = pickNameAlias(raw)
      if (!name) continue
      const next: Extract<WorldOp, { op: 'forge.add' }> = { op: 'forge.add', name }
      if (typeof raw.type === 'string' && FORGE_TYPES.has(raw.type as ForgeItem['type'])) {
        next.type = raw.type as ForgeItem['type']
      }
      if (typeof raw.grade === 'string') next.grade = raw.grade
      if (typeof raw.progress === 'number') next.progress = raw.progress
      if (raw.craftsman === null) next.craftsman = null
      else if (typeof raw.craftsman === 'string') next.craftsman = raw.craftsman
      if (typeof raw.materials === 'string') next.materials = raw.materials
      if (typeof raw.power === 'string') next.power = raw.power
      ops.push(next)
      continue
    }

    if (kind === 'relation.add') {
      const from = typeof raw.from === 'string' ? raw.from.trim() : ''
      const to = typeof raw.to === 'string' ? raw.to.trim() : ''
      const relType = typeof raw.type === 'string' ? raw.type : ''
      if (!from || !to || !RELATION_TYPES.has(relType as RelationEdge['type'])) continue
      const next: Extract<WorldOp, { op: 'relation.add' }> = {
        op: 'relation.add',
        from,
        to,
        type: relType as RelationEdge['type'],
      }
      if (typeof raw.intensity === 'number') next.intensity = raw.intensity
      if (typeof raw.note === 'string') next.note = raw.note
      ops.push(next)
      continue
    }

    if (kind === 'heir.add') {
      const name =
        pickNameAlias(raw) ||
        (typeof raw.discipleId === 'string' ? raw.discipleId.trim() : '')
      if (!name && typeof raw.discipleId !== 'string') continue
      const next: Extract<WorldOp, { op: 'heir.add' }> = { op: 'heir.add' }
      if (typeof raw.discipleId === 'string') next.discipleId = raw.discipleId.trim()
      if (name) next.name = name
      if (typeof raw.score === 'number') next.score = raw.score
      if (Array.isArray(raw.strengths)) next.strengths = raw.strengths.map(String)
      if (Array.isArray(raw.risks)) next.risks = raw.risks.map(String)
      if (typeof raw.support === 'number') next.support = raw.support
      if (typeof raw.designated === 'boolean') next.designated = raw.designated
      ops.push(next)
      continue
    }

    // 其它 op：浅拷贝保留，后续 validate 再严查
    ops.push(rawOp as WorldOp)
  }

  return {
    resources,
    ops: collapseDiscipleRemoveAddRenames(ops),
    summary: delta.summary !== undefined ? String(delta.summary) : undefined,
  }
}

/**
 * 同批「remove 旧名 + add 新名」收成一条改名 update（模型常拆成两步导致双开）。
 */
function collapseDiscipleRemoveAddRenames(ops: WorldOp[]): WorldOp[] {
  const used = new Set<number>()
  const extra: WorldOp[] = []
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].op !== 'disciple.remove') continue
    const oldName = String(
      (ops[i] as { name?: string; id?: string }).name ||
        (ops[i] as { id?: string }).id ||
        '',
    ).trim()
    if (!oldName) continue
    for (let j = 0; j < ops.length; j++) {
      if (i === j || used.has(j) || ops[j].op !== 'disciple.add') continue
      const add = ops[j] as Extract<WorldOp, { op: 'disciple.add' }>
      const newName = String(add.name || '').trim()
      if (!newName || newName === oldName) continue
      used.add(i)
      used.add(j)
      extra.push({
        op: 'disciple.update',
        name: oldName,
        formerName: oldName,
        patch: {
          name: newName,
          gender: add.gender,
          age: add.age,
          realm: add.realm,
          aptitude: add.aptitude,
          role: add.role,
          loyalty: add.loyalty,
          mood: add.mood,
          talent: add.talent,
          status: add.status,
          master: add.master,
        },
      })
      break
    }
  }
  if (!used.size) return ops
  const rest = ops.filter((_, idx) => !used.has(idx))
  return [...rest, ...extra]
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
      // 同名已在册：不在此报错，由 demoteDuplicateDiscipleAdd 收成 update
      return null
    }
    case 'disciple.update': {
      const locateName = op.formerName || op.name
      const r = resolveByIdOrName(snap.disciples, op.id, locateName, '弟子')
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
    case 'faction.add': {
      if (!op.name || !String(op.name).trim()) return `${prefix}: name 必填`
      if (op.stance !== undefined && !FACTION_STANCE.has(op.stance)) return `${prefix}: stance 非法`
      if (op.relation !== undefined && !isFiniteNumber(op.relation)) return `${prefix}: relation 须为数字`
      // 同名已在册 → 跳过 add（避免重复），由 update 负责改关系
      if (snap.factions.some((f) => f.name === String(op.name).trim())) {
        return `${prefix}: 势力已在册，请用 faction.update`
      }
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
    case 'city.add': {
      if (!op.name || !String(op.name).trim()) return `${prefix}: name 必填`
      if (op.attitude !== undefined && !CITY_ATTITUDE.has(op.attitude)) {
        return `${prefix}: attitude 非法`
      }
      if (op.influence !== undefined && !isFiniteNumber(op.influence)) {
        return `${prefix}: influence 须为数字`
      }
      if (snap.cities.some((c) => c.name === String(op.name).trim())) {
        return `${prefix}: 城池已在册，请用 city.update`
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
    case 'manual.add': {
      if (!op.name || !String(op.name).trim()) return `${prefix}: name 必填`
      if (op.readers !== undefined && !isFiniteNumber(op.readers)) return `${prefix}: readers 须为数字`
      const list = snap.manuals || []
      if (list.some((m) => m.name === String(op.name).trim())) {
        return `${prefix}: 秘籍已在册，请用 manual.update`
      }
      return null
    }
    case 'manual.update': {
      const list = snap.manuals || []
      const r = resolveByIdOrName(list, op.id, op.name, '秘籍')
      if (r.error) return `${prefix}: ${r.error}`
      if (!op.patch || !isPlainObject(op.patch)) return `${prefix}: patch 必填`
      if (op.patch.readers !== undefined && !isFiniteNumber(op.patch.readers)) {
        return `${prefix}: readers 须为数字`
      }
      return null
    }
    case 'treasure.add': {
      if (!op.name || !String(op.name).trim()) return `${prefix}: name 必填`
      const list = snap.treasures || []
      if (list.some((t) => t.name === String(op.name).trim())) {
        return `${prefix}: 宝物已在册，请用 treasure.update`
      }
      return null
    }
    case 'treasure.update': {
      const list = snap.treasures || []
      const r = resolveByIdOrName(list, op.id, op.name, '宝物')
      if (r.error) return `${prefix}: ${r.error}`
      if (!op.patch || !isPlainObject(op.patch)) return `${prefix}: patch 必填`
      return null
    }
    case 'forge.add': {
      if (!op.name || !String(op.name).trim()) return `${prefix}: name 必填`
      if (op.type !== undefined && !FORGE_TYPES.has(op.type)) return `${prefix}: type 非法`
      if (op.progress !== undefined && !isFiniteNumber(op.progress)) {
        return `${prefix}: progress 须为数字`
      }
      const list = snap.forgeQueue || []
      if (list.some((g) => g.name === String(op.name).trim())) {
        return `${prefix}: 锻器已在队列，请用 forge.update`
      }
      return null
    }
    case 'forge.update': {
      const list = snap.forgeQueue || []
      const r = resolveByIdOrName(list, op.id, op.name, '锻器')
      if (r.error) return `${prefix}: ${r.error}`
      if (!op.patch || !isPlainObject(op.patch)) return `${prefix}: patch 必填`
      if (op.patch.type !== undefined && !FORGE_TYPES.has(op.patch.type)) {
        return `${prefix}: type 非法`
      }
      if (op.patch.progress !== undefined && !isFiniteNumber(op.patch.progress)) {
        return `${prefix}: progress 须为数字`
      }
      return null
    }
    case 'relation.add': {
      if (!op.from?.trim() || !op.to?.trim()) return `${prefix}: from/to 必填`
      if (!RELATION_TYPES.has(op.type)) return `${prefix}: type 非法`
      if (op.intensity !== undefined && !isFiniteNumber(op.intensity)) {
        return `${prefix}: intensity 须为数字`
      }
      return null
    }
    case 'relation.update': {
      const list = snap.relationEdges || []
      if (op.id) {
        if (!list.some((e) => e.id === op.id)) return `${prefix}: 关系 id 不存在：${op.id}`
      } else if (op.from && op.to) {
        const hits = list.filter(
          (e) =>
            e.from === op.from &&
            e.to === op.to &&
            (op.type ? e.type === op.type : true),
        )
        if (!hits.length) return `${prefix}: 关系边不存在`
        if (hits.length > 1 && !op.type) return `${prefix}: 关系边不唯一，请带 type 或 id`
      } else {
        return `${prefix}: 须提供 id 或 from+to`
      }
      if (!op.patch || !isPlainObject(op.patch)) return `${prefix}: patch 必填`
      if (op.patch.type !== undefined && !RELATION_TYPES.has(op.patch.type)) {
        return `${prefix}: type 非法`
      }
      if (op.patch.intensity !== undefined && !isFiniteNumber(op.patch.intensity)) {
        return `${prefix}: intensity 须为数字`
      }
      return null
    }
    case 'heir.add': {
      const key = (op.discipleId || op.name || '').trim()
      if (!key) return `${prefix}: discipleId 或 name 必填`
      // 允许仅姓名：apply 时再解析弟子
      if (op.score !== undefined && !isFiniteNumber(op.score)) return `${prefix}: score 须为数字`
      if (op.support !== undefined && !isFiniteNumber(op.support)) return `${prefix}: support 须为数字`
      const list = snap.heirs || []
      if (
        list.some(
          (h) =>
            h.discipleId === key ||
            h.name === key ||
            (op.name && h.name === String(op.name).trim()),
        )
      ) {
        return `${prefix}: 继承人已在观察名单，请用 heir.update`
      }
      return null
    }
    case 'heir.update': {
      const list = snap.heirs || []
      if (op.id) {
        if (!list.some((h) => h.id === op.id)) return `${prefix}: 继承人 id 不存在`
      } else if (op.name || op.discipleId) {
        const hits = list.filter(
          (h) =>
            (op.name && h.name === op.name) ||
            (op.discipleId && (h.discipleId === op.discipleId || h.name === op.discipleId)),
        )
        if (!hits.length) return `${prefix}: 继承人不存在`
        if (hits.length > 1) return `${prefix}: 继承人不唯一`
      } else {
        return `${prefix}: 须提供 id / name / discipleId`
      }
      if (!op.patch || !isPlainObject(op.patch)) return `${prefix}: patch 必填`
      if (op.patch.score !== undefined && !isFiniteNumber(op.patch.score)) {
        return `${prefix}: score 须为数字`
      }
      if (op.patch.support !== undefined && !isFiniteNumber(op.patch.support)) {
        return `${prefix}: support 须为数字`
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

/** 把同包已排队入册的名字并入快照，供 resolve / 去重 */
function snapWithPendingNames(
  snap: WorldSnapshot,
  factionNames: Set<string>,
  cityNames: Set<string>,
): WorldSnapshot {
  const extraF = [...factionNames]
    .filter((n) => !snap.factions.some((f) => f.name === n))
    .map(
      (n): Faction => ({
        id: `pending-${n}`,
        name: n,
        power: '',
        relation: 0,
        stance: '中立',
        recent: '',
      }),
    )
  const extraC = [...cityNames]
    .filter((n) => !snap.cities.some((c) => c.name === n))
    .map(
      (n): CityState => ({
        id: `pending-${n}`,
        name: n,
        distance: '',
        influence: 0,
        tribute: { type: '', amount: 0, period: '' },
        attitude: '中立',
        governor: '',
        notes: '',
      }),
    )
  if (!extraF.length && !extraC.length) return snap
  return {
    ...snap,
    factions: extraF.length ? [...snap.factions, ...extraF] : snap.factions,
    cities: extraC.length ? [...snap.cities, ...extraC] : snap.cities,
  }
}

/**
 * 弟子已在册却又 disciple.add → 收成 update，避免改名/重复收徒双开行。
 */
function demoteDuplicateDiscipleAdd(
  op: WorldOp,
  snap: WorldSnapshot,
): { op: WorldOp; demoted: boolean } {
  if (op.op !== 'disciple.add') return { op, demoted: false }
  const name = String(op.name || '').trim()
  if (!name) return { op, demoted: false }
  const former = String(op.formerName || '').trim()
  if (former && former !== name) {
    const hit = snap.disciples.find((d) => d.name === former || d.id === former)
    if (hit) {
      return {
        op: {
          op: 'disciple.update',
          id: hit.id,
          name: hit.name,
          patch: {
            name,
            gender: op.gender,
            age: op.age,
            realm: op.realm,
            aptitude: op.aptitude,
            role: op.role,
            loyalty: op.loyalty,
            mood: op.mood,
            talent: op.talent,
            status: op.status,
            master: op.master,
          },
        },
        demoted: true,
      }
    }
  }
  const existing = snap.disciples.find((d) => d.name === name)
  if (!existing) return { op, demoted: false }
  return {
    op: {
      op: 'disciple.update',
      id: existing.id,
      name: existing.name,
      patch: {
        gender: op.gender,
        age: op.age,
        realm: op.realm,
        aptitude: op.aptitude,
        role: op.role,
        loyalty: op.loyalty,
        mood: op.mood,
        talent: op.talent,
        status: op.status,
        master: op.master,
      },
    },
    demoted: true,
  }
}

/**
 * 活世界：模型常对「正文新实体」误用 update。
 * 若按 id/name 找不到实体，且带了 name，则提升为 add（patch 字段并入）。
 */
function promoteUnknownUpdateToAdd(
  op: WorldOp,
  snap: WorldSnapshot,
): { op: WorldOp; promoted: boolean } {
  if (op.op === 'faction.update') {
    const r = resolveByIdOrName(snap.factions, op.id, op.name, '势力')
    if (r.error && op.name && String(op.name).trim()) {
      const p = op.patch || {}
      const next: Extract<WorldOp, { op: 'faction.add' }> = {
        op: 'faction.add',
        name: String(op.name).trim(),
      }
      if (p.power !== undefined) next.power = String(p.power)
      if (typeof p.relation === 'number') next.relation = p.relation
      if (p.stance && FACTION_STANCE.has(p.stance)) next.stance = p.stance
      if (p.recent !== undefined) next.recent = String(p.recent)
      if (p.demand !== undefined) next.demand = String(p.demand)
      return { op: next, promoted: true }
    }
  }
  if (op.op === 'city.update') {
    const r = resolveByIdOrName(snap.cities, op.id, op.name, '城池')
    if (r.error && op.name && String(op.name).trim()) {
      const p = op.patch || {}
      const next: Extract<WorldOp, { op: 'city.add' }> = {
        op: 'city.add',
        name: String(op.name).trim(),
      }
      if (typeof p.influence === 'number') next.influence = p.influence
      if (p.attitude && CITY_ATTITUDE.has(p.attitude)) next.attitude = p.attitude
      if (p.governor !== undefined) next.governor = String(p.governor)
      if (p.notes !== undefined) next.notes = String(p.notes)
      return { op: next, promoted: true }
    }
  }
  if (op.op === 'manual.update') {
    const r = resolveByIdOrName(snap.manuals || [], op.id, op.name, '秘籍')
    if (r.error && op.name && String(op.name).trim()) {
      const p = op.patch || {}
      const next: Extract<WorldOp, { op: 'manual.add' }> = {
        op: 'manual.add',
        name: String(op.name).trim(),
      }
      if (p.school !== undefined) next.school = String(p.school)
      if (p.grade !== undefined) next.grade = String(p.grade)
      if (p.restriction !== undefined) next.restriction = String(p.restriction)
      if (typeof p.readers === 'number') next.readers = p.readers
      if (p.insight !== undefined) next.insight = String(p.insight)
      if (typeof p.sealed === 'boolean') next.sealed = p.sealed
      return { op: next, promoted: true }
    }
  }
  if (op.op === 'treasure.update') {
    const r = resolveByIdOrName(snap.treasures || [], op.id, op.name, '宝物')
    if (r.error && op.name && String(op.name).trim()) {
      const p = op.patch || {}
      const next: Extract<WorldOp, { op: 'treasure.add' }> = {
        op: 'treasure.add',
        name: String(op.name).trim(),
      }
      if (p.type !== undefined) next.type = String(p.type)
      if (p.grade !== undefined) next.grade = String(p.grade)
      if (p.owner !== undefined) next.owner = p.owner
      if (p.desc !== undefined) next.desc = String(p.desc)
      if (typeof p.bound === 'boolean') next.bound = p.bound
      return { op: next, promoted: true }
    }
  }
  if (op.op === 'forge.update') {
    const r = resolveByIdOrName(snap.forgeQueue || [], op.id, op.name, '锻器')
    if (r.error && op.name && String(op.name).trim()) {
      const p = op.patch || {}
      const next: Extract<WorldOp, { op: 'forge.add' }> = {
        op: 'forge.add',
        name: String(op.name).trim(),
      }
      if (p.type && FORGE_TYPES.has(p.type)) next.type = p.type
      if (p.grade !== undefined) next.grade = String(p.grade)
      if (typeof p.progress === 'number') next.progress = p.progress
      if (p.craftsman !== undefined) next.craftsman = p.craftsman
      if (p.materials !== undefined) next.materials = String(p.materials)
      if (p.power !== undefined) next.power = String(p.power)
      return { op: next, promoted: true }
    }
  }
  if (op.op === 'heir.update') {
    const list = snap.heirs || []
    const key = (op.name || op.discipleId || '').trim()
    const found = op.id
      ? list.some((h) => h.id === op.id)
      : key
        ? list.some((h) => h.name === key || h.discipleId === key)
        : false
    if (!found && key) {
      const p = op.patch || {}
      const next: Extract<WorldOp, { op: 'heir.add' }> = {
        op: 'heir.add',
        name: op.name ? String(op.name).trim() : key,
        discipleId: op.discipleId,
      }
      if (typeof p.score === 'number') next.score = p.score
      if (Array.isArray(p.strengths)) next.strengths = p.strengths.map(String)
      if (Array.isArray(p.risks)) next.risks = p.risks.map(String)
      if (typeof p.support === 'number') next.support = p.support
      if (typeof p.designated === 'boolean') next.designated = p.designated
      return { op: next, promoted: true }
    }
  }
  return { op, promoted: false }
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
  // 同包内连续 add 后，后续 op 应看到已入册名（防同名双 add）
  const pendingFactionNames = new Set(snap.factions.map((f) => f.name))
  const pendingCityNames = new Set(snap.cities.map((c) => c.name))
  /** 本批弟子「当前有效名」（改名后更新），防同批重复 add */
  const pendingDiscipleNames = new Set(snap.disciples.map((d) => d.name))
  /** id → 当前名，便于 demote */
  const discipleByName = new Map(snap.disciples.map((d) => [d.name, d]))

  for (let i = 0; i < opsIn.length; i++) {
    if (kept.length >= MAX_OPS) {
      const msg = `ops 超过上限 ${MAX_OPS}，已截断（原 ${opsIn.length} 条）`
      if (!warnings.includes(msg)) {
        errors.push(msg)
        warnings.push(msg)
      }
      break
    }
    let op = opsIn[i] as WorldOp & { op?: string }
    const validateSnap = snapWithPendingNames(snap, pendingFactionNames, pendingCityNames)

    const promo = promoteUnknownUpdateToAdd(op as WorldOp, validateSnap)
    if (promo.promoted) {
      warnings.push(`ops[${i}] 未在册实体，已将 update 提升为 add`)
      op = promo.op as WorldOp & { op?: string }
    }

    // 弟子 add 撞名 / 带 formerName → update
    if (op.op === 'disciple.add') {
      const demo = demoteDuplicateDiscipleAdd(op, {
        ...validateSnap,
        disciples: [
          ...validateSnap.disciples,
          // 本批已占用的新名也视为在册
          ...[...pendingDiscipleNames]
            .filter((n) => !validateSnap.disciples.some((d) => d.name === n))
            .map((n) => {
              const known = discipleByName.get(n)
              return (
                known || {
                  id: `pending-${n}`,
                  name: n,
                  gender: '男' as const,
                  age: 16,
                  realm: '',
                  aptitude: '',
                  role: '',
                  loyalty: 0,
                  mood: '',
                  talent: [] as string[],
                  status: '在宗' as const,
                  avatarHue: 0,
                }
              )
            }),
        ],
      })
      if (demo.demoted) {
        warnings.push(`ops[${i}] 弟子已在册或属改名，add 已收成 update`)
        op = demo.op as WorldOp & { op?: string }
      }
    }

    // update 定位：formerName 优先
    if (op.op === 'disciple.update' && op.formerName && !op.id) {
      op = { ...op, name: op.formerName }
    }

    const err = validateOneOp(op, validateSnap, i)
    if (err) {
      // 改名：name 写成了新名、找不到人 → 若 patch 无 name 且 former 可定位则已处理；
      // 若 locator 是新名但旧名仍在册，尝试用「唯一可能的旧人」不猜。跳过并警告。
      errors.push(err)
      warnings.push(`已跳过：${err}`)
      continue
    }
    kept.push(op as WorldOp)
    if (op.op === 'faction.add' && op.name) pendingFactionNames.add(String(op.name).trim())
    if (op.op === 'city.add' && op.name) pendingCityNames.add(String(op.name).trim())
    if (op.op === 'disciple.add' && op.name) {
      pendingDiscipleNames.add(String(op.name).trim())
      discipleByName.set(String(op.name).trim(), {
        id: `pending-${op.name}`,
        name: String(op.name).trim(),
        gender: '男',
        age: 16,
        realm: '',
        aptitude: '',
        role: '',
        loyalty: 0,
        mood: '',
        talent: [],
        status: '在宗',
        avatarHue: 0,
      })
    }
    if (op.op === 'disciple.update') {
      const oldN = String(op.formerName || op.name || '').trim()
      const newN = op.patch?.name != null ? String(op.patch.name).trim() : ''
      if (newN && oldN && newN !== oldN) {
        pendingDiscipleNames.delete(oldN)
        pendingDiscipleNames.add(newN)
        const prev = discipleByName.get(oldN) || snap.disciples.find((d) => d.name === oldN)
        if (prev) {
          discipleByName.delete(oldN)
          discipleByName.set(newN, { ...prev, name: newN })
        }
      }
    }
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

/** 弟子改名后：关系 / 宝物持有 / 继位名单 / 锻器工匠 等引用一并改 */
function rewritePersonNameRefs(
  snap: WorldSnapshot,
  oldName: string,
  newName: string,
): void {
  if (!oldName || !newName || oldName === newName) return
  for (const e of snap.relationEdges || []) {
    if (e.from === oldName) e.from = newName
    if (e.to === oldName) e.to = newName
  }
  for (const t of snap.treasures || []) {
    if (t.owner === oldName) t.owner = newName
  }
  for (const g of snap.forgeQueue || []) {
    if (g.craftsman === oldName) g.craftsman = newName
  }
  for (const h of snap.heirs || []) {
    if (h.name === oldName) h.name = newName
  }
  for (const m of snap.manuals || []) {
    if (Array.isArray(m.readers)) {
      /* readers 若是数字则跳过；部分实现是人名列表 */
    }
  }
}

export function applyWorldDeltaToSnapshot(
  delta: WorldDelta,
  snap: WorldSnapshot,
): { snap: WorldSnapshot; result: ApplyResult } {
  const next = cloneSnap(snap)
  const lines: string[] = []
  const renames: Array<{ from: string; to: string }> = []
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
        const newName = String(op.name).trim()
        // 安全网：同名已在册则改 update，不双开
        const existed = next.disciples.find((d) => d.name === newName)
        if (existed) {
          if (op.gender === '男' || op.gender === '女') existed.gender = op.gender
          if (typeof op.age === 'number') existed.age = clamp(op.age, 1, 200)
          if (op.realm) existed.realm = op.realm
          if (op.aptitude) existed.aptitude = op.aptitude
          if (op.role) existed.role = op.role
          if (typeof op.loyalty === 'number') existed.loyalty = clamp(op.loyalty, 0, 100)
          if (op.mood) existed.mood = op.mood
          if (Array.isArray(op.talent)) existed.talent = op.talent.map(String)
          if (op.status && DISCIPLE_STATUS.has(op.status)) existed.status = op.status
          if (op.master) existed.master = op.master
          lines.push(`弟子 ${existed.name} 已在册，已合并更新`)
          changed = true
          break
        }
        const d: Disciple = {
          id: nextId('d'),
          name: newName,
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
        const locate = op.formerName || op.name
        const r = resolveByIdOrName(next.disciples, op.id, locate, '弟子')
        if (!r.item || !op.patch) break
        const before = r.item.name
        const p = op.patch
        if (p.name !== undefined) {
          const nn = String(p.name).trim()
          if (nn && nn !== before) {
            // 若新名已有另一人，合并到旧档并去掉冲突行
            const clash = next.disciples.find((d) => d.id !== r.item!.id && d.name === nn)
            if (clash) {
              next.disciples = next.disciples.filter((d) => d.id !== clash.id)
            }
            r.item.name = nn
            rewritePersonNameRefs(next, before, nn)
            renames.push({ from: before, to: nn })
            lines.push(`弟子改名 ${before} → ${nn}`)
          }
        }
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
        if (!(p.name !== undefined && String(p.name).trim() && String(p.name).trim() !== before)) {
          lines.push(`弟子 ${before} 状态更新`)
        }
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
      case 'faction.add': {
        const name = String(op.name).trim()
        if (!name) break
        if (next.factions.some((f) => f.name === name)) break
        const f: Faction = {
          id: nextId('fa'),
          name,
          power: op.power ? String(op.power) : '新势力',
          relation: typeof op.relation === 'number' ? clamp(op.relation, -100, 100) : 0,
          stance: op.stance && FACTION_STANCE.has(op.stance) ? op.stance : '中立',
          recent: op.recent ? String(op.recent) : '初现山门视野',
          demand: op.demand ? String(op.demand) : undefined,
        }
        next.factions.push(f)
        lines.push(`新势力入册 ${f.name}（${f.stance}·关系${f.relation}）`)
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
      case 'city.add': {
        const name = String(op.name).trim()
        if (!name) break
        if (next.cities.some((c) => c.name === name)) break
        const tributeType =
          op.tribute?.type && String(op.tribute.type).trim()
            ? String(op.tribute.type).trim()
            : '灵石折色'
        const tributeAmount =
          typeof op.tribute?.amount === 'number' ? clamp(op.tribute.amount, 0, 99999) : 0
        const tributePeriod =
          op.tribute?.period && String(op.tribute.period).trim()
            ? String(op.tribute.period).trim()
            : '每季'
        const c: CityState = {
          id: nextId('c'),
          name,
          distance: op.distance ? String(op.distance) : '未详',
          influence: typeof op.influence === 'number' ? clamp(op.influence, 0, 100) : 20,
          tribute: { type: tributeType, amount: tributeAmount, period: tributePeriod },
          attitude: op.attitude && CITY_ATTITUDE.has(op.attitude) ? op.attitude : '中立',
          governor: op.governor ? String(op.governor) : '未详',
          notes: op.notes ? String(op.notes) : '新纳入视野的城坞',
        }
        next.cities.push(c)
        lines.push(`新城池入册 ${c.name}（${c.attitude}·影响${c.influence}）`)
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
      case 'manual.add': {
        if (!next.manuals) next.manuals = []
        const name = String(op.name).trim()
        if (!name || next.manuals.some((m) => m.name === name)) break
        const m: Manual = {
          id: nextId('m'),
          name,
          school: op.school ? String(op.school) : '外来',
          grade: op.grade ? String(op.grade) : '黄品',
          restriction: op.restriction ? String(op.restriction) : '掌门裁定',
          readers: typeof op.readers === 'number' ? clamp(op.readers, 0, 999) : 0,
          insight: op.insight ? String(op.insight) : '待悟',
          sealed: typeof op.sealed === 'boolean' ? op.sealed : false,
        }
        next.manuals.push(m)
        lines.push(`藏经新入 ${m.name}${m.sealed ? '（封印）' : ''}`)
        changed = true
        break
      }
      case 'manual.update': {
        if (!next.manuals) next.manuals = []
        const r = resolveByIdOrName(next.manuals, op.id, op.name, '秘籍')
        if (!r.item || !op.patch) break
        const p = op.patch
        if (p.name !== undefined) r.item.name = String(p.name)
        if (p.school !== undefined) r.item.school = String(p.school)
        if (p.grade !== undefined) r.item.grade = String(p.grade)
        if (p.restriction !== undefined) r.item.restriction = String(p.restriction)
        if (typeof p.readers === 'number') r.item.readers = clamp(p.readers, 0, 999)
        if (p.insight !== undefined) r.item.insight = String(p.insight)
        if (typeof p.sealed === 'boolean') r.item.sealed = p.sealed
        lines.push(`秘籍 ${r.item.name} 状态更新`)
        changed = true
        break
      }
      case 'treasure.add': {
        if (!next.treasures) next.treasures = []
        const name = String(op.name).trim()
        if (!name || next.treasures.some((t) => t.name === name)) break
        const t: Treasure = {
          id: nextId('t'),
          name,
          type: op.type ? String(op.type) : '杂物',
          grade: op.grade ? String(op.grade) : '黄品',
          owner: op.owner === null ? null : op.owner != null ? String(op.owner) : null,
          desc: op.desc ? String(op.desc) : '正文新获',
          bound: typeof op.bound === 'boolean' ? op.bound : false,
        }
        next.treasures.push(t)
        lines.push(`宝库新入 ${t.name}`)
        changed = true
        break
      }
      case 'treasure.update': {
        if (!next.treasures) next.treasures = []
        const r = resolveByIdOrName(next.treasures, op.id, op.name, '宝物')
        if (!r.item || !op.patch) break
        const p = op.patch
        if (p.name !== undefined) r.item.name = String(p.name)
        if (p.type !== undefined) r.item.type = String(p.type)
        if (p.grade !== undefined) r.item.grade = String(p.grade)
        if (p.owner !== undefined) r.item.owner = p.owner
        if (p.desc !== undefined) r.item.desc = String(p.desc)
        if (typeof p.bound === 'boolean') r.item.bound = p.bound
        lines.push(`宝物 ${r.item.name} 状态更新`)
        changed = true
        break
      }
      case 'forge.add': {
        if (!next.forgeQueue) next.forgeQueue = []
        const name = String(op.name).trim()
        if (!name || next.forgeQueue.some((g) => g.name === name)) break
        const g: ForgeItem = {
          id: nextId('g'),
          name,
          type: op.type && FORGE_TYPES.has(op.type) ? op.type : '法器',
          grade: op.grade ? String(op.grade) : '黄品',
          progress: typeof op.progress === 'number' ? clamp(op.progress, 0, 100) : 0,
          craftsman: op.craftsman === null ? null : op.craftsman != null ? String(op.craftsman) : null,
          materials: op.materials ? String(op.materials) : '待备料',
          power: op.power ? String(op.power) : '未成器',
        }
        next.forgeQueue.push(g)
        lines.push(`锻器入列 ${g.name}`)
        changed = true
        break
      }
      case 'forge.update': {
        if (!next.forgeQueue) next.forgeQueue = []
        const r = resolveByIdOrName(next.forgeQueue, op.id, op.name, '锻器')
        if (!r.item || !op.patch) break
        const p = op.patch
        if (p.name !== undefined) r.item.name = String(p.name)
        if (p.type && FORGE_TYPES.has(p.type)) r.item.type = p.type
        if (p.grade !== undefined) r.item.grade = String(p.grade)
        if (typeof p.progress === 'number') r.item.progress = clamp(p.progress, 0, 100)
        if (p.craftsman !== undefined) r.item.craftsman = p.craftsman
        if (p.materials !== undefined) r.item.materials = String(p.materials)
        if (p.power !== undefined) r.item.power = String(p.power)
        lines.push(`锻器 ${r.item.name} 进度更新`)
        changed = true
        break
      }
      case 'relation.add': {
        if (!next.relationEdges) next.relationEdges = []
        const from = String(op.from).trim()
        const to = String(op.to).trim()
        if (!from || !to || !RELATION_TYPES.has(op.type)) break
        const edge: RelationEdge = {
          id: nextId('r'),
          from,
          to,
          type: op.type,
          intensity: typeof op.intensity === 'number' ? clamp(op.intensity, 0, 100) : 40,
          note: op.note ? String(op.note) : '正文新结',
        }
        next.relationEdges.push(edge)
        lines.push(`关系 ${from}↔${to}（${edge.type}）`)
        changed = true
        break
      }
      case 'relation.update': {
        if (!next.relationEdges) next.relationEdges = []
        let item: RelationEdge | undefined
        if (op.id) {
          item = next.relationEdges.find((e) => e.id === op.id)
        } else if (op.from && op.to) {
          const hits = next.relationEdges.filter(
            (e) =>
              e.from === op.from &&
              e.to === op.to &&
              (op.type ? e.type === op.type : true),
          )
          item = hits.length === 1 ? hits[0] : undefined
        }
        if (!item || !op.patch) break
        const p = op.patch
        if (p.from !== undefined) item.from = String(p.from)
        if (p.to !== undefined) item.to = String(p.to)
        if (p.type && RELATION_TYPES.has(p.type)) item.type = p.type
        if (typeof p.intensity === 'number') item.intensity = clamp(p.intensity, 0, 100)
        if (p.note !== undefined) item.note = String(p.note)
        lines.push(`关系 ${item.from}↔${item.to} 更新`)
        changed = true
        break
      }
      case 'heir.add': {
        if (!next.heirs) next.heirs = []
        const key = (op.discipleId || op.name || '').trim()
        if (!key) break
        // 解析弟子：id 或姓名
        const disc =
          next.disciples.find((d) => d.id === key || d.name === key) ||
          (op.name
            ? next.disciples.find((d) => d.name === String(op.name).trim())
            : undefined)
        const discipleId = disc?.id || (op.discipleId?.startsWith('d') ? op.discipleId : key)
        const heirName = disc?.name || (op.name ? String(op.name).trim() : key)
        if (
          next.heirs.some(
            (h) => h.discipleId === discipleId || h.name === heirName,
          )
        ) {
          break
        }
        const h: HeirCandidate = {
          id: nextId('h'),
          discipleId,
          name: heirName,
          score: typeof op.score === 'number' ? clamp(op.score, 0, 100) : 50,
          strengths: Array.isArray(op.strengths) ? op.strengths.map(String) : ['新晋'],
          risks: Array.isArray(op.risks) ? op.risks.map(String) : ['根基未稳'],
          support: typeof op.support === 'number' ? clamp(op.support, 0, 100) : 20,
          designated: !!op.designated,
        }
        if (h.designated) {
          next.heirs = next.heirs.map((x) => ({ ...x, designated: false }))
        }
        next.heirs.push(h)
        lines.push(`继位观察 +${h.name}`)
        changed = true
        break
      }
      case 'heir.update': {
        if (!next.heirs) next.heirs = []
        let item: HeirCandidate | undefined
        if (op.id) item = next.heirs.find((h) => h.id === op.id)
        else {
          const key = (op.name || op.discipleId || '').trim()
          const hits = next.heirs.filter(
            (h) => h.name === key || h.discipleId === key || h.discipleId === op.discipleId,
          )
          item = hits.length === 1 ? hits[0] : undefined
        }
        if (!item || !op.patch) break
        const p = op.patch
        if (p.name !== undefined) item.name = String(p.name)
        if (typeof p.score === 'number') item.score = clamp(p.score, 0, 100)
        if (Array.isArray(p.strengths)) item.strengths = p.strengths.map(String)
        if (Array.isArray(p.risks)) item.risks = p.risks.map(String)
        if (typeof p.support === 'number') item.support = clamp(p.support, 0, 100)
        if (typeof p.designated === 'boolean') {
          if (p.designated) {
            for (const h of next.heirs) h.designated = h.id === item.id
          } else {
            item.designated = false
          }
        }
        lines.push(`继承人 ${item.name} 观察更新`)
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

  return { snap: next, result: { lines, changed, renames } }
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
    manuals: [],
    treasures: [],
    forgeQueue: [],
    relationEdges: [],
    heirs: [],
    ...partial,
  }
}
