import { describe, it, expect } from 'vitest'
import {
  SEASON_ORDER,
  buildTimelineSeasons,
  seasonAtOffset,
} from './timeline-seasons'
import { useGameState } from './useGameState'

describe('buildTimelineSeasons', () => {
  it('marks first card current with matching season label', () => {
    const cards = buildTimelineSeasons(3848, '仲春', 4)
    expect(cards).toHaveLength(4)
    expect(cards[0].status).toBe('current')
    expect(cards[0].season).toBe('仲春')
    expect(cards[0].label).toContain('本季')
    expect(cards[0].label).toContain('仲春')
    expect(cards[1].status).toBe('next')
    expect(cards[1].season).toBe('季春')
    expect(cards[2].status).toBe('future')
    expect(cards[3].status).toBe('future')
  })

  it('wraps year at 季冬 → 孟春', () => {
    const next = seasonAtOffset(10, '季冬', 1)
    expect(next).toEqual({ year: 11, season: '孟春' })
    const cards = buildTimelineSeasons(10, '季冬', 2)
    expect(cards[0].year).toBe(10)
    expect(cards[0].season).toBe('季冬')
    expect(cards[1].year).toBe(11)
    expect(cards[1].season).toBe('孟春')
  })

  it('tracks live calendar after advanceSeason', () => {
    const gs = useGameState()
    gs.resetGameToOpening()
    gs.markOpeningDone()
    const before = gs.calendar.season
    const cardsBefore = buildTimelineSeasons(gs.calendar.year, before, 4)
    expect(cardsBefore[0].season).toBe(before)

    gs.advanceSeason()
    const after = gs.calendar.season
    expect(after).not.toBe(before)
    const cardsAfter = buildTimelineSeasons(gs.calendar.year, after, 4)
    expect(cardsAfter[0].season).toBe(after)
    expect(cardsAfter[0].status).toBe('current')
    expect(cardsAfter[0].label).toContain(after)
  })

  it('covers all SEASON_ORDER names as current when asked', () => {
    for (const s of SEASON_ORDER) {
      const c = buildTimelineSeasons(1, s, 1)[0]
      expect(c.season).toBe(s)
      expect(c.events.length).toBeGreaterThan(0)
    }
  })
})
