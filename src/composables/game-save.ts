/**
 * 最小整局存档：资源/历法/实体/灵田/待决/丹库存 → localStorage。
 * 不负责天机会话（仍由 ST/IndexedDB）。
 */
import type {
  AlchemyRecipe,
  CityState,
  Disciple,
  Faction,
  FieldPlot,
  NotificationItem,
  Resources,
  UrgentEvent,
} from '@/types/game'
import type { DifficultyId } from '@/data/opening'

export const GAME_SAVE_KEY = 'zongmen-game-v1'
export const GAME_SAVE_VERSION = 1 as const

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** 测试可注入；`undefined` 表示用浏览器 localStorage */
let storageOverride: StorageLike | null | undefined

export function setGameSaveStorageForTests(storage: StorageLike | null | undefined) {
  storageOverride = storage
}

function resolveStorage(): StorageLike | null {
  if (storageOverride !== undefined) return storageOverride
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch {
    /* ignore */
  }
  return null
}

export interface GameSaveV1 {
  v: typeof GAME_SAVE_VERSION
  savedAt: number
  sectName: string
  masterName: string
  difficulty: DifficultyId
  resources: Resources
  calendar: {
    era: string
    year: number
    season: string
    day: number
    hour: string
    weather: string
  }
  disciples: Disciple[]
  factions: Faction[]
  cities: CityState[]
  notifications: NotificationItem[]
  fieldPlots: FieldPlot[]
  urgentEvents: UrgentEvent[]
  designatedHeirId: string
  /** recipeId → 成丹库存 */
  alchemyStocks: Record<string, number>
}

export interface GameSavePayload {
  sectName: string
  masterName: string
  difficulty: DifficultyId
  resources: Resources
  calendar: GameSaveV1['calendar']
  disciples: Disciple[]
  factions: Faction[]
  cities: CityState[]
  notifications: NotificationItem[]
  fieldPlots: FieldPlot[]
  urgentEvents: UrgentEvent[]
  designatedHeirId: string
  alchemyStocks: Record<string, number>
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

export function stocksFromRecipes(recipes: AlchemyRecipe[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of recipes) {
    out[r.id] = Math.max(0, Math.round(Number(r.stock) || 0))
  }
  return out
}

export function applyStocksToRecipes(
  recipes: AlchemyRecipe[],
  stocks: Record<string, number> | undefined | null,
): AlchemyRecipe[] {
  if (!stocks || typeof stocks !== 'object') {
    return recipes.map((r) => ({ ...r, cost: { ...r.cost } }))
  }
  return recipes.map((r) => ({
    ...r,
    cost: { ...r.cost },
    stock: stocks[r.id] !== undefined ? Math.max(0, Math.round(Number(stocks[r.id]) || 0)) : r.stock,
  }))
}

export function buildGameSave(payload: GameSavePayload, savedAt = Date.now()): GameSaveV1 {
  return {
    v: GAME_SAVE_VERSION,
    savedAt,
    sectName: payload.sectName,
    masterName: payload.masterName,
    difficulty: payload.difficulty,
    resources: { ...payload.resources },
    calendar: { ...payload.calendar },
    disciples: clone(payload.disciples),
    factions: clone(payload.factions),
    cities: clone(payload.cities),
    notifications: clone(payload.notifications),
    fieldPlots: clone(payload.fieldPlots),
    urgentEvents: clone(payload.urgentEvents),
    designatedHeirId: payload.designatedHeirId,
    alchemyStocks: { ...payload.alchemyStocks },
  }
}

/**
 * 解析存档。兼容：
 * - 标准 v1
 * - 缺 v / v 写成数字字符串
 * - 缺 disciples / fieldPlots / urgentEvents / factions 等（补空数组，不整档作废）
 * 仅 resources + calendar 核心不可用时才返回 null。
 */
export function parseGameSave(raw: unknown): GameSaveV1 | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>

  // v 缺省 / "1" / 1 都当 v1；未知大版本拒绝（将来再写迁移）
  if (o.v !== undefined && o.v !== null) {
    const ver = Number(o.v)
    if (Number.isFinite(ver) && ver > 1) return null
  }

  if (!o.resources || typeof o.resources !== 'object') return null
  if (!o.calendar || typeof o.calendar !== 'object') return null

  const cal = o.calendar as Record<string, unknown>
  const res = o.resources as Record<string, unknown>
  const year = Number(cal.year)
  const season = cal.season != null ? String(cal.season) : ''
  if (!Number.isFinite(year) || !season) return null
  // spiritStone 允许字符串数字（旧导出）
  const stone = Number(res.spiritStone)
  if (!Number.isFinite(stone)) return null

  const disciples = Array.isArray(o.disciples)
    ? clone(normalizeDisciples(o.disciples))
    : []
  const fieldPlots = Array.isArray(o.fieldPlots) ? clone(o.fieldPlots as FieldPlot[]) : []
  const urgentEvents = Array.isArray(o.urgentEvents)
    ? clone(o.urgentEvents as UrgentEvent[])
    : []

  return {
    v: 1,
    savedAt: typeof o.savedAt === 'number' ? o.savedAt : Date.now(),
    sectName: String(o.sectName || ''),
    masterName: String(o.masterName || ''),
    difficulty:
      o.difficulty === 'hard' || o.difficulty === 'hardcore' || o.difficulty === 'standard'
        ? o.difficulty
        : 'standard',
    resources: {
      spiritStone: Math.max(0, Math.round(stone) || 0),
      spiritGrain: Math.max(0, Math.round(Number(res.spiritGrain) || 0)),
      herb: Math.max(0, Math.round(Number(res.herb) || 0)),
      ore: Math.max(0, Math.round(Number(res.ore) || 0)),
      prestige: Math.max(0, Math.round(Number(res.prestige) || 0)),
      destiny: Math.max(0, Math.round(Number(res.destiny) || 0)),
    },
    calendar: {
      era: String(cal.era || '天元历'),
      year,
      season,
      day: typeof cal.day === 'number' && Number.isFinite(cal.day) ? cal.day : 1,
      hour: String(cal.hour || '辰时'),
      weather: String(cal.weather || ''),
    },
    disciples,
    factions: Array.isArray(o.factions) ? clone(o.factions as Faction[]) : [],
    cities: Array.isArray(o.cities) ? clone(o.cities as CityState[]) : [],
    notifications: Array.isArray(o.notifications)
      ? clone(o.notifications as NotificationItem[])
      : [],
    fieldPlots,
    urgentEvents,
    designatedHeirId: String(o.designatedHeirId || ''),
    alchemyStocks:
      o.alchemyStocks && typeof o.alchemyStocks === 'object'
        ? { ...(o.alchemyStocks as Record<string, number>) }
        : {},
  }
}

/** 旧档弟子字段可能缺省，补齐到可渲染形态，避免整册丢弃 */
function normalizeDisciples(raw: unknown[]): Disciple[] {
  const out: Disciple[] = []
  for (let i = 0; i < raw.length; i++) {
    const d = raw[i]
    if (!d || typeof d !== 'object') continue
    const o = d as Record<string, unknown>
    const name = String(o.name || '').trim()
    if (!name) continue
    out.push({
      id: String(o.id || `d-legacy-${i + 1}`),
      name,
      gender: o.gender === '女' ? '女' : '男',
      age: typeof o.age === 'number' && Number.isFinite(o.age) ? o.age : 16,
      realm: String(o.realm || '炼气一层'),
      aptitude: String(o.aptitude || '中等'),
      role: String(o.role || '外门弟子'),
      loyalty:
        typeof o.loyalty === 'number' && Number.isFinite(o.loyalty)
          ? Math.max(0, Math.min(100, o.loyalty))
          : 70,
      mood: String(o.mood || '平静'),
      talent: Array.isArray(o.talent) ? o.talent.map(String) : [],
      status: (
        ['在宗', '外勤', '闭关', '受伤', '叛离风险'] as Disciple['status'][]
      ).includes(o.status as Disciple['status'])
        ? (o.status as Disciple['status'])
        : '在宗',
      avatarHue:
        typeof o.avatarHue === 'number' && Number.isFinite(o.avatarHue)
          ? o.avatarHue
          : (i * 37) % 360,
      master: o.master != null ? String(o.master) : undefined,
      spouse: o.spouse != null ? String(o.spouse) : undefined,
    })
  }
  return out
}

export function loadGameSaveFromStorage(
  storage: Pick<Storage, 'getItem'> | null = resolveStorage(),
): GameSaveV1 | null {
  if (!storage) return null
  try {
    const text = storage.getItem(GAME_SAVE_KEY)
    if (!text) return null
    return parseGameSave(JSON.parse(text))
  } catch {
    return null
  }
}

export function writeGameSaveToStorage(
  save: GameSaveV1,
  storage: Pick<Storage, 'setItem'> | null = resolveStorage(),
): boolean {
  if (!storage) return false
  try {
    storage.setItem(GAME_SAVE_KEY, JSON.stringify(save))
    return true
  } catch {
    return false
  }
}

export function clearGameSaveFromStorage(
  storage: Pick<Storage, 'removeItem'> | null = resolveStorage(),
): void {
  if (!storage) return
  try {
    storage.removeItem(GAME_SAVE_KEY)
  } catch {
    /* ignore */
  }
}
