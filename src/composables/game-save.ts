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

export function parseGameSave(raw: unknown): GameSaveV1 | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o.v !== 1) return null
  if (!o.resources || typeof o.resources !== 'object') return null
  if (!o.calendar || typeof o.calendar !== 'object') return null
  if (!Array.isArray(o.disciples) || !Array.isArray(o.fieldPlots) || !Array.isArray(o.urgentEvents)) {
    return null
  }
  const cal = o.calendar as GameSaveV1['calendar']
  const res = o.resources as Resources
  if (typeof cal.year !== 'number' || typeof cal.season !== 'string') return null
  if (typeof res.spiritStone !== 'number') return null

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
      spiritStone: Number(res.spiritStone) || 0,
      spiritGrain: Number(res.spiritGrain) || 0,
      herb: Number(res.herb) || 0,
      ore: Number(res.ore) || 0,
      prestige: Number(res.prestige) || 0,
      destiny: Number(res.destiny) || 0,
    },
    calendar: {
      era: String(cal.era || '天元历'),
      year: cal.year,
      season: cal.season,
      day: typeof cal.day === 'number' ? cal.day : 1,
      hour: String(cal.hour || '辰时'),
      weather: String(cal.weather || ''),
    },
    disciples: clone(o.disciples as Disciple[]),
    factions: clone((o.factions as Faction[]) || []),
    cities: clone((o.cities as CityState[]) || []),
    notifications: clone((o.notifications as NotificationItem[]) || []),
    fieldPlots: clone(o.fieldPlots as FieldPlot[]),
    urgentEvents: clone(o.urgentEvents as UrgentEvent[]),
    designatedHeirId: String(o.designatedHeirId || ''),
    alchemyStocks:
      o.alchemyStocks && typeof o.alchemyStocks === 'object'
        ? { ...(o.alchemyStocks as Record<string, number>) }
        : {},
  }
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
