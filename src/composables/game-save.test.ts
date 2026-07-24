import { describe, it, expect, beforeEach } from 'vitest'
import {
  buildGameSave,
  parseGameSave,
  stocksFromRecipes,
  applyStocksToRecipes,
  writeGameSaveToStorage,
  loadGameSaveFromStorage,
  clearGameSaveFromStorage,
  setGameSaveStorageForTests,
  GAME_SAVE_KEY,
} from './game-save'
import { useGameState } from './useGameState'
import type { AlchemyRecipe } from '@/types/game'

const memStore = () => {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v)
    },
    removeItem: (k: string) => {
      map.delete(k)
    },
  }
}

describe('game-save pure', () => {
  it('round-trips stocks and core fields', () => {
    const recipes: AlchemyRecipe[] = [
      {
        id: 'a1',
        name: '聚气丹',
        grade: '黄',
        cost: { herb: 1, spiritStone: 1 },
        effect: '',
        successRate: 80,
        time: '1',
        stock: 3,
      },
    ]
    const save = buildGameSave({
      sectName: '测宗',
      masterName: '甲',
      difficulty: 'hard',
      resources: {
        spiritStone: 100,
        spiritGrain: 200,
        herb: 30,
        ore: 10,
        prestige: 5,
        destiny: 2,
      },
      calendar: {
        era: '天元历',
        year: 3900,
        season: '孟秋',
        day: 3,
        hour: '午时',
        weather: '晴',
      },
      disciples: [],
      factions: [],
      cities: [],
      notifications: [],
      fieldPlots: [
        {
          id: 'f1',
          name: '田',
          grade: '黄',
          crop: '谷',
          yieldPerSeason: 1,
          moisture: 50,
          assigned: '乙',
          status: 'idle',
          seasonLeft: 0,
        },
      ],
      urgentEvents: [
        {
          id: 'u1',
          title: '事',
          summary: 's',
          severity: 'info',
          source: 't',
          timeLabel: 'x',
          status: 'open',
          choices: [],
        },
      ],
      designatedHeirId: 'h1',
      alchemyStocks: stocksFromRecipes(recipes),
    })
    const again = parseGameSave(JSON.parse(JSON.stringify(save)))
    expect(again?.calendar.year).toBe(3900)
    expect(again?.calendar.season).toBe('孟秋')
    expect(again?.fieldPlots[0].assigned).toBe('乙')
    expect(again?.alchemyStocks.a1).toBe(3)
    const applied = applyStocksToRecipes(recipes, again!.alchemyStocks)
    expect(applied[0].stock).toBe(3)
  })

  it('accepts legacy incomplete save (missing arrays / string spiritStone)', () => {
    const legacy = {
      // 无 v
      sectName: '旧宗',
      masterName: '旧掌',
      resources: { spiritStone: '500', spiritGrain: 100 },
      calendar: { year: 3840, season: '孟冬' },
      disciples: [
        { name: '仅有名的弟子', realm: '炼气三层' },
        { id: 'x', /* 无名 → 丢弃 */ realm: '筑基' },
      ],
      // 无 fieldPlots / urgentEvents / factions
    }
    const parsed = parseGameSave(legacy)
    expect(parsed).not.toBeNull()
    expect(parsed!.v).toBe(1)
    expect(parsed!.sectName).toBe('旧宗')
    expect(parsed!.resources.spiritStone).toBe(500)
    expect(parsed!.calendar.year).toBe(3840)
    expect(parsed!.disciples).toHaveLength(1)
    expect(parsed!.disciples[0].name).toBe('仅有名的弟子')
    expect(parsed!.disciples[0].id).toMatch(/^d-legacy-/)
    expect(parsed!.disciples[0].status).toBe('在宗')
    expect(parsed!.fieldPlots).toEqual([])
    expect(parsed!.urgentEvents).toEqual([])
    expect(parsed!.factions).toEqual([])
  })

  it('rejects garbage without resources/calendar', () => {
    expect(parseGameSave(null)).toBeNull()
    expect(parseGameSave({ v: 1, foo: 1 })).toBeNull()
    expect(parseGameSave({ resources: {}, calendar: { year: 'x', season: 1 } })).toBeNull()
  })

  it('storage write/load/clear', () => {
    const s = memStore()
    const save = buildGameSave({
      sectName: 'A',
      masterName: 'B',
      difficulty: 'standard',
      resources: {
        spiritStone: 1,
        spiritGrain: 2,
        herb: 3,
        ore: 4,
        prestige: 5,
        destiny: 6,
      },
      calendar: {
        era: '天元历',
        year: 1,
        season: '孟春',
        day: 1,
        hour: '卯',
        weather: '',
      },
      disciples: [],
      factions: [],
      cities: [],
      notifications: [],
      fieldPlots: [],
      urgentEvents: [],
      designatedHeirId: '',
      alchemyStocks: { a1: 9 },
    })
    expect(writeGameSaveToStorage(save, s)).toBe(true)
    expect(s.getItem(GAME_SAVE_KEY)).toBeTruthy()
    const loaded = loadGameSaveFromStorage(s)
    expect(loaded?.alchemyStocks.a1).toBe(9)
    clearGameSaveFromStorage(s)
    expect(loadGameSaveFromStorage(s)).toBeNull()
  })
})

describe('craftAlchemy + persist path', () => {
  beforeEach(() => {
    setGameSaveStorageForTests(memStore())
    const gs = useGameState()
    gs.resetGameToOpening()
    gs.markOpeningDone()
  })

  it('craftAlchemy deducts resources and increments stock', () => {
    const gs = useGameState()
    const r = gs.alchemyRecipes.value.find((x) => x.id === 'a1')
    expect(r).toBeTruthy()
    const stockBefore = r!.stock
    const herbBefore = gs.resources.herb
    const stoneBefore = gs.resources.spiritStone

    const ok = gs.craftAlchemy('a1')
    expect(ok.ok).toBe(true)
    if (!ok.ok) return
    expect(gs.resources.herb).toBe(herbBefore - r!.cost.herb)
    expect(gs.resources.spiritStone).toBe(stoneBefore - r!.cost.spiritStone)
    expect(gs.alchemyRecipes.value.find((x) => x.id === 'a1')?.stock).toBe(stockBefore + 1)
  })

  it('craftAlchemy fails when resources insufficient', () => {
    const gs = useGameState()
    gs.adjustResource({
      herb: -gs.resources.herb,
      spiritStone: -gs.resources.spiritStone,
    })
    const r = gs.craftAlchemy('a1')
    expect(r.ok).toBe(false)
  })

  it('persistGameSave then hydrate restores fields and alchemy stock', () => {
    const gs = useGameState()
    gs.assignFieldPlot('f6', '林晚舟')
    expect(gs.craftAlchemy('a2').ok).toBe(true)
    const stock = gs.alchemyRecipes.value.find((x) => x.id === 'a2')!.stock
    const grain = gs.resources.spiritGrain
    gs.persistGameSave()

    // 污染 live
    gs.fieldPlots.value = gs.fieldPlots.value.map((f) =>
      f.id === 'f6' ? { ...f, assigned: null } : f,
    )
    gs.alchemyRecipes.value = gs.alchemyRecipes.value.map((r) =>
      r.id === 'a2' ? { ...r, stock: 0 } : r,
    )
    gs.resources.spiritGrain = 0

    const loaded = gs.hydrateFromSave()
    expect(loaded).toBe(true)
    expect(gs.fieldPlots.value.find((f) => f.id === 'f6')?.assigned).toBe('林晚舟')
    expect(gs.alchemyRecipes.value.find((x) => x.id === 'a2')?.stock).toBe(stock)
    expect(gs.resources.spiritGrain).toBe(grain)
  })

  it('recruited disciples survive persist + hydrate (refresh path)', () => {
    const gs = useGameState()
    const before = gs.disciples.value.length
    const recruit = {
      id: 'd-recruit-test',
      name: '陆承渊·测',
      gender: '男' as const,
      age: 18,
      realm: '炼气一层',
      aptitude: '中等',
      role: '外门弟子',
      loyalty: 70,
      mood: '平静',
      talent: ['剑骨'],
      status: '在宗' as const,
      avatarHue: 120,
      master: gs.masterName.value,
    }
    gs.disciples.value = [...gs.disciples.value, recruit]
    expect(gs.disciples.value.length).toBe(before + 1)
    expect(gs.persistGameSave()).toBe(true)

    // 模拟刷新：回落到种子名册
    gs.disciples.value = gs.disciples.value.slice(0, Math.max(1, before - 2))
    expect(gs.disciples.value.some((d) => d.id === 'd-recruit-test')).toBe(false)

    expect(gs.hydrateFromSave()).toBe(true)
    expect(gs.disciples.value.length).toBe(before + 1)
    expect(gs.disciples.value.find((d) => d.id === 'd-recruit-test')?.name).toBe('陆承渊·测')
  })
})

describe('restoreWorldState persists disciple.add', () => {
  beforeEach(() => {
    setGameSaveStorageForTests(memStore())
    const gs = useGameState()
    gs.resetGameToOpening()
    gs.markOpeningDone()
  })

  it('applyValidatedDelta disciple.add then hydrate keeps roster', async () => {
    const { applyValidatedDelta } = await import('./world-state')
    const gs = useGameState()
    const before = gs.disciples.value.length
    const r = applyValidatedDelta({
      resources: {},
      ops: [
        {
          op: 'disciple.add',
          name: '新人甲',
          realm: '炼气一层',
          role: '外门弟子',
          gender: '男',
        },
        {
          op: 'disciple.add',
          name: '新人乙',
          realm: '炼气二层',
          role: '外门弟子',
          gender: '女',
        },
      ],
    })
    expect(r.changed).toBe(true)
    expect(gs.disciples.value.length).toBe(before + 2)
    expect(gs.disciples.value.some((d) => d.name === '新人甲')).toBe(true)

    // 污染后再 hydrate（等同刷新后从 localStorage 恢复）
    gs.disciples.value = []
    expect(gs.hydrateFromSave()).toBe(true)
    expect(gs.disciples.value.length).toBe(before + 2)
    expect(gs.disciples.value.map((d) => d.name)).toEqual(
      expect.arrayContaining(['新人甲', '新人乙']),
    )
  })
})
