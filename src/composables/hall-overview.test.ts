import { describe, it, expect, beforeEach } from 'vitest'
import { buildHallStats, buildHallShortcuts, buildHallChronicle } from './hall-overview'
import { useGameState } from './useGameState'

describe('hall-overview', () => {
  beforeEach(() => {
    const gs = useGameState()
    gs.resetGameToOpening()
    gs.markOpeningDone()
  })

  it('stats reflect live disciple counts and open urgents', () => {
    const gs = useGameState()
    const stats = buildHallStats({
      era: gs.calendar.era,
      year: gs.calendar.year,
      season: gs.calendar.season,
      sectName: gs.sectName.value,
      masterName: gs.masterName.value,
      disciples: gs.disciples.value,
      factions: gs.factions.value,
      cities: gs.cities.value,
      fieldPlots: gs.fieldPlots.value,
      openUrgents: gs.openUrgentEvents.value,
      alchemyRecipes: gs.alchemyRecipes.value,
      designatedHeirId: gs.designatedHeirId.value,
      resources: {
        prestige: gs.resources.prestige,
        destiny: gs.resources.destiny,
        herb: gs.resources.herb,
      },
    })
    const disc = stats.find((s) => s.id === 'disciples')
    expect(disc?.value).toBe(String(gs.disciples.value.length))
    expect(disc?.sub).toContain('在宗')
    // 非 mock 写死的 17
    expect(disc?.value).not.toBe('17')
  })

  it('shortcuts update after assign field and craft', () => {
    const gs = useGameState()
    gs.assignFieldPlot('f6', '赵阿禾')
    const before = buildHallShortcuts({
      era: gs.calendar.era,
      year: gs.calendar.year,
      season: gs.calendar.season,
      sectName: gs.sectName.value,
      masterName: gs.masterName.value,
      disciples: gs.disciples.value,
      factions: gs.factions.value,
      cities: gs.cities.value,
      fieldPlots: gs.fieldPlots.value,
      openUrgents: gs.openUrgentEvents.value,
      alchemyRecipes: gs.alchemyRecipes.value,
      designatedHeirId: gs.designatedHeirId.value,
      heirName: '储君',
      resources: {
        prestige: gs.resources.prestige,
        destiny: gs.resources.destiny,
        herb: gs.resources.herb,
      },
    })
    expect(before.find((s) => s.id === 'legacy')?.desc).toBe('储君')
    expect(before.find((s) => s.id === 'alchemy')?.desc).toMatch(/成丹/)

    const stockBefore = gs.alchemyRecipes.value.reduce((s, r) => s + r.stock, 0)
    gs.craftAlchemy('a1')
    const after = buildHallShortcuts({
      era: gs.calendar.era,
      year: gs.calendar.year,
      season: gs.calendar.season,
      sectName: gs.sectName.value,
      masterName: gs.masterName.value,
      disciples: gs.disciples.value,
      factions: gs.factions.value,
      cities: gs.cities.value,
      fieldPlots: gs.fieldPlots.value,
      openUrgents: gs.openUrgentEvents.value,
      alchemyRecipes: gs.alchemyRecipes.value,
      designatedHeirId: gs.designatedHeirId.value,
      resources: {
        prestige: gs.resources.prestige,
        destiny: gs.resources.destiny,
        herb: gs.resources.herb,
      },
    })
    const stockAfter = gs.alchemyRecipes.value.reduce((s, r) => s + r.stock, 0)
    expect(stockAfter).toBe(stockBefore + 1)
    expect(after.find((s) => s.id === 'alchemy')?.desc).toContain(`成丹 ${stockAfter}`)
  })

  it('chronicle ends with live season line', () => {
    const gs = useGameState()
    const ch = buildHallChronicle({
      era: gs.calendar.era,
      year: gs.calendar.year,
      season: gs.calendar.season,
      sectName: '青岚宗',
      masterName: '沈青岚',
      disciples: gs.disciples.value,
      factions: gs.factions.value,
      cities: gs.cities.value,
      fieldPlots: gs.fieldPlots.value,
      openUrgents: gs.openUrgentEvents.value,
      alchemyRecipes: gs.alchemyRecipes.value,
      designatedHeirId: gs.designatedHeirId.value,
      resources: {
        prestige: gs.resources.prestige,
        destiny: gs.resources.destiny,
        herb: gs.resources.herb,
      },
    })
    const last = ch[ch.length - 1]
    expect(last.id).toBe('ch-live')
    expect(last.year).toContain(String(gs.calendar.year))
    expect(last.text).toContain(gs.calendar.season)
  })
})
