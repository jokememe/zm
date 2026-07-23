import { describe, it, expect, beforeEach } from 'vitest'
import {
  tickFields,
  collectTributes,
  tickDisciples,
  tickFactions,
  settleSeasonTick,
} from './season-settle'
import { cloneFieldPlotsSeed, cities, disciples, factions, resources } from '@/data/mock'
import { useGameState } from './useGameState'

describe('tickFields', () => {
  it('harvests ready plots into resources and sets idle', () => {
    const fields = cloneFieldPlotsSeed()
    const harvest = fields.find((f) => f.status === 'harvest')
    expect(harvest).toBeTruthy()
    const { next, delta, lines } = tickFields(fields)
    expect(lines.some((l) => l.includes('收获'))).toBe(true)
    expect((delta.spiritGrain ?? 0) + (delta.herb ?? 0)).toBeGreaterThan(0)
    const after = next.find((f) => f.id === harvest!.id)
    expect(after?.status).toBe('idle')
  })

  it('decrements growing seasonLeft toward harvest', () => {
    const fields = cloneFieldPlotsSeed().map((f) =>
      f.id === 'f1' ? { ...f, status: 'growing' as const, seasonLeft: 1 } : f,
    )
    const { next } = tickFields(fields)
    expect(next.find((f) => f.id === 'f1')?.status).toBe('harvest')
  })
})

describe('collectTributes', () => {
  it('collects from 恭顺 cities each season', () => {
    const { delta, lines } = collectTributes(cities, '仲春')
    expect(lines.some((l) => l.includes('纳贡'))).toBe(true)
    expect(
      (delta.spiritGrain ?? 0) +
        (delta.herb ?? 0) +
        (delta.ore ?? 0) +
        (delta.spiritStone ?? 0),
    ).toBeGreaterThan(0)
  })

  it('skips half-year tribute outside 孟春/孟秋', () => {
    const halfOnly = cities.map((c) =>
      c.id === 'c3'
        ? c
        : {
            ...c,
            tribute: { ...c.tribute, period: '每半年' as string },
            attitude: '恭顺' as const,
          },
    )
    // c3 is 每半年 already; force all half-year
    const allHalf = halfOnly.map((c) => ({
      ...c,
      tribute: { type: c.tribute.type, amount: 100, period: '每半年' },
      attitude: '恭顺' as const,
    }))
    const mid = collectTributes(allHalf, '仲春')
    expect(mid.lines.filter((l) => l.includes('纳贡')).length).toBe(0)
    const spring = collectTributes(allHalf, '孟春')
    expect(spring.lines.filter((l) => l.includes('纳贡')).length).toBeGreaterThan(0)
  })
})

describe('tickDisciples / tickFactions', () => {
  it('gives prestige for fielded disciples', () => {
    const { delta, lines } = tickDisciples(disciples)
    const fielded = disciples.filter((d) => d.status === '外勤').length
    if (fielded > 0) {
      expect(delta.prestige).toBe(fielded)
      expect(lines.some((l) => l.includes('外勤'))).toBe(true)
    }
  })

  it('worsens 敌对 faction relation', () => {
    const blood = factions.find((f) => f.stance === '敌对')
    expect(blood).toBeTruthy()
    const before = blood!.relation
    const { next } = tickFactions(factions)
    const after = next.find((f) => f.id === blood!.id)!
    expect(after.relation).toBeLessThan(before)
  })
})

describe('settleSeasonTick + advanceSeason', () => {
  it('combines field harvest, tributes and maintenance into lines + delta', () => {
    const r = settleSeasonTick({
      fields: cloneFieldPlotsSeed(),
      cities,
      disciples,
      factions,
      resources,
      season: '仲春',
    })
    expect(r.lines.length).toBeGreaterThan(3)
    expect(r.lines.some((l) => l.includes('维护'))).toBe(true)
    expect(r.lines.some((l) => l.includes('灵田') || l.includes('纳贡'))).toBe(true)
    // 至少有一类资源变动
    const keys = Object.keys(r.resourcesDelta)
    expect(keys.length).toBeGreaterThan(0)
  })

  it('advanceSeason applies real settle not flat +180/-30 only', () => {
    const gs = useGameState()
    gs.resetGameToOpening()
    gs.markOpeningDone()
    const grainBefore = gs.resources.spiritGrain
    const { lines, summary } = gs.advanceSeason()
    expect(lines.length).toBeGreaterThan(0)
    expect(summary.length).toBeGreaterThan(0)
    const grainDelta = gs.resources.spiritGrain - grainBefore
    expect(
      lines.some((l) => l.includes('灵田') || l.includes('纳贡') || l.includes('维护')),
    ).toBe(true)
    // 旧硬编码仅 +180 灵谷；真实结算含收获+纳贡，通常不等于 180
    expect(grainDelta).not.toBe(180)
    // 雾畦收获后状态应变化
    const mist = gs.fieldPlots.value.find((f) => f.id === 'f5')
    expect(mist?.status).toBe('idle')
  })
})
