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
})
