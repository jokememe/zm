/**
 * WorldDelta pure engine: parse settle JSON → validate → apply on snapshot
 */
import type {
  WorldDelta,
  WorldOp,
  WorldSnapshot,
  ResourceCnName,
  ValidateResult,
  ApplyResult,
} from '@/types/world'
import type { CityState, Disciple, Faction, NotificationItem, Resources } from '@/types/game'
import { RESOURCE_VAR_MAP, resolveNumericValue, type ResourceVarName } from '@/composables/game-bridge'

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

const MAX_OPS = 12
const MAX_DISC_ADD = 3

export type ParseSettleResult =
  | { ok: true; delta: WorldDelta }
  | { ok: false; error: string }

function stripFence(text: string): string {
  let s = text.trim()
  const fence = /^```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```\s*$/i
  const m = s.match(fence)
  if (m) s = m[1].trim()
  return s
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

export function parseSettlePayload(text: string): ParseSettleResult {
  try {
    const raw = stripFence(text)
    if (!raw) return { ok: false, error: '空结算内容' }
    const parsed = JSON.parse(raw) as unknown
    if (!isPlainObject(parsed)) return { ok: false, error: '结算 JSON 须为对象' }

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

export function validateWorldDelta(delta: WorldDelta, snap: WorldSnapshot): ValidateResult {
  const errors: string[] = []
  const warnings: string[] = []
  const ops = delta.ops ?? []

  if (ops.length > MAX_OPS) {
    errors.push(`ops 超过上限 ${MAX_OPS}（当前 ${ops.length}）`)
  }

  const addCount = ops.filter((o) => o && (o as WorldOp).op === 'disciple.add').length
  if (addCount > MAX_DISC_ADD) {
    errors.push(`disciple.add 超过上限 ${MAX_DISC_ADD}（当前 ${addCount}）`)
  }

  if (delta.resources) {
    for (const key of Object.keys(delta.resources)) {
      if (!RESOURCE_CN.has(key)) {
        errors.push(`非法资源键：${key}`)
      }
    }
  }

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i] as WorldOp & { op?: string }
    if (!op || typeof op !== 'object' || !op.op) {
      errors.push(`ops[${i}] 非法`)
      continue
    }
    const prefix = `ops[${i}] ${op.op}`

    switch (op.op) {
      case 'disciple.add': {
        if (!op.name || !String(op.name).trim()) {
          errors.push(`${prefix}: name 必填`)
        }
        if (op.gender !== undefined && !GENDERS.has(op.gender)) {
          errors.push(`${prefix}: gender 非法`)
        }
        if (op.status !== undefined && !DISCIPLE_STATUS.has(op.status)) {
          errors.push(`${prefix}: status 非法`)
        }
        if (op.loyalty !== undefined && !isFiniteNumber(op.loyalty)) {
          errors.push(`${prefix}: loyalty 须为数字`)
        }
        break
      }
      case 'disciple.update': {
        const r = resolveByIdOrName(snap.disciples, op.id, op.name, '弟子')
        if (r.error) errors.push(`${prefix}: ${r.error}`)
        if (!op.patch || !isPlainObject(op.patch)) {
          errors.push(`${prefix}: patch 必填`)
        } else {
          if (op.patch.status !== undefined && !DISCIPLE_STATUS.has(op.patch.status)) {
            errors.push(`${prefix}: status 非法`)
          }
          if (op.patch.gender !== undefined && !GENDERS.has(op.patch.gender)) {
            errors.push(`${prefix}: gender 非法`)
          }
          if (op.patch.loyalty !== undefined && !isFiniteNumber(op.patch.loyalty)) {
            errors.push(`${prefix}: loyalty 须为数字`)
          }
        }
        break
      }
      case 'disciple.remove': {
        const r = resolveByIdOrName(snap.disciples, op.id, op.name, '弟子')
        if (r.error) errors.push(`${prefix}: ${r.error}`)
        break
      }
      case 'faction.update': {
        const r = resolveByIdOrName(snap.factions, op.id, op.name, '势力')
        if (r.error) errors.push(`${prefix}: ${r.error}`)
        if (!op.patch || !isPlainObject(op.patch)) {
          errors.push(`${prefix}: patch 必填`)
        } else {
          if (op.patch.stance !== undefined && !FACTION_STANCE.has(op.patch.stance)) {
            errors.push(`${prefix}: stance 非法`)
          }
          if (op.patch.relation !== undefined && !isFiniteNumber(op.patch.relation)) {
            errors.push(`${prefix}: relation 须为数字`)
          }
        }
        break
      }
      case 'city.update': {
        const r = resolveByIdOrName(snap.cities, op.id, op.name, '城池')
        if (r.error) errors.push(`${prefix}: ${r.error}`)
        if (!op.patch || !isPlainObject(op.patch)) {
          errors.push(`${prefix}: patch 必填`)
        } else {
          if (op.patch.attitude !== undefined && !CITY_ATTITUDE.has(op.patch.attitude)) {
            errors.push(`${prefix}: attitude 非法`)
          }
          if (op.patch.influence !== undefined && !isFiniteNumber(op.patch.influence)) {
            errors.push(`${prefix}: influence 须为数字`)
          }
        }
        break
      }
      case 'notify.push': {
        if (!op.title || !String(op.title).trim()) {
          errors.push(`${prefix}: title 必填`)
        }
        break
      }
      default:
        errors.push(`${prefix}: 未知 op`)
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    delta: errors.length === 0 ? delta : undefined,
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
      const val = resolveNumericValue(cur, raw as string | number)
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
    ...partial,
  }
}
