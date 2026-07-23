import { describe, it, expect, beforeEach } from 'vitest'
import { useGameState } from './useGameState'

describe('urgent events live state', () => {
  beforeEach(() => {
    const gs = useGameState()
    // 重置到种子待决，避免测试间污染
    gs.resetGameToOpening()
    gs.markOpeningDone()
  })

  it('starts with open urgent events from seed', () => {
    const { openUrgentEvents } = useGameState()
    expect(openUrgentEvents.value.length).toBeGreaterThan(0)
    expect(openUrgentEvents.value.every((e) => (e.status ?? 'open') === 'open')).toBe(true)
  })

  it('resolveUrgentEvent removes event from open list and applies resource delta', () => {
    const gs = useGameState()
    const beforeStone = gs.resources.spiritStone
    const openBefore = gs.openUrgentEvents.value.length
    const target = gs.openUrgentEvents.value.find((e) => e.id === 'evt-envoy')
    expect(target).toBeTruthy()

    const r = gs.resolveUrgentEvent('evt-envoy', 'c2')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.label).toContain('勘查')
    expect(gs.openUrgentEvents.value.length).toBe(openBefore - 1)
    expect(gs.openUrgentEvents.value.some((e) => e.id === 'evt-envoy')).toBe(false)
    expect(gs.resources.spiritStone).toBe(beforeStone + 200)
    const stored = gs.urgentEvents.value.find((e) => e.id === 'evt-envoy')
    expect(stored?.status).toBe('resolved')
    expect(stored?.resolvedChoiceId).toBe('c2')
  })

  it('second resolve of same event fails', () => {
    const gs = useGameState()
    expect(gs.resolveUrgentEvent('evt-envoy', 'c1').ok).toBe(true)
    const again = gs.resolveUrgentEvent('evt-envoy', 'c1')
    expect(again.ok).toBe(false)
  })

  it('resetGameToOpening restores open urgent seed', () => {
    const gs = useGameState()
    gs.resolveUrgentEvent('evt-envoy', 'c1')
    gs.resolveUrgentEvent('evt-harvest', 'h1')
    expect(gs.openUrgentEvents.value.length).toBeLessThan(3)
    gs.resetGameToOpening()
    expect(gs.openUrgentEvents.value.length).toBe(3)
  })
})
