import { describe, it, expect, beforeEach } from 'vitest'
import { useGameState } from './useGameState'
import { snapshotWorldState, restoreWorldState } from './world-state'
import { tickFields } from './season-settle'
import type { FieldPlot, UrgentEvent } from '@/types/game'
import type { WorldSnapshot } from '@/types/world'

describe('snapshot/restore fieldPlots + urgentEvents', () => {
  beforeEach(() => {
    const gs = useGameState()
    gs.resetGameToOpening()
    gs.markOpeningDone()
  })

  it('round-trips non-seed fields and urgents via shipped snapshot/restore', () => {
    const gs = useGameState()
    const customFields: FieldPlot[] = [
      {
        id: 'fx-1',
        name: '测试田',
        grade: '黄品',
        crop: '待播',
        yieldPerSeason: 0,
        moisture: 60,
        assigned: '测试弟子',
        status: 'idle',
        seasonLeft: 0,
      },
    ]
    const customUrgents: UrgentEvent[] = [
      {
        id: 'u-custom',
        title: '自定义待决',
        summary: '用于快照测试',
        severity: 'warn',
        source: '测',
        timeLabel: '此刻',
        status: 'open',
        choices: [{ id: 'x1', label: '了', effect: '无' }],
      },
    ]
    gs.fieldPlots.value = customFields
    gs.urgentEvents.value = customUrgents

    const snap = snapshotWorldState()
    expect(snap.fieldPlots).toEqual(customFields)
    expect(snap.urgentEvents).toEqual(customUrgents)
    // 深拷贝：改 snap 不影响 live
    snap.fieldPlots![0].assigned = '被污染'
    expect(gs.fieldPlots.value[0].assigned).toBe('测试弟子')

    // 进一步污染 live
    gs.fieldPlots.value = []
    gs.urgentEvents.value = []
    expect(gs.fieldPlots.value).toHaveLength(0)

    restoreWorldState(snap)
    expect(gs.fieldPlots.value).toHaveLength(1)
    expect(gs.fieldPlots.value[0].id).toBe('fx-1')
    expect(gs.fieldPlots.value[0].assigned).toBe('被污染') // snap 被污染后的值
    expect(gs.urgentEvents.value).toEqual(customUrgents)
  })

  it('after season mutate + append urgents, restore of mid snap undoes further mutation', () => {
    const gs = useGameState()
    // 确保有可收田与 open 待决
    expect(gs.fieldPlots.value.some((f) => f.status === 'harvest')).toBe(true)
    const openBefore = gs.openUrgentEvents.value.length
    expect(openBefore).toBeGreaterThan(0)

    gs.advanceSeason()
    const mist = gs.fieldPlots.value.find((f) => f.id === 'f5')
    expect(mist?.status).toBe('idle')

    const n = gs.appendUrgentEvents([
      {
        id: 'u-season-test',
        title: '季报测试待决',
        summary: 'append 后应进快照',
        severity: 'info',
        source: '测',
        timeLabel: '本季',
        status: 'open',
        choices: [{ id: 'a', label: '知', effect: '无' }],
      },
    ])
    expect(n).toBe(1)

    const mid = snapshotWorldState()
    const midFields = JSON.parse(JSON.stringify(mid.fieldPlots))
    const midUrgents = JSON.parse(JSON.stringify(mid.urgentEvents))
    expect(mid.fieldPlots?.find((f) => f.id === 'f5')?.status).toBe('idle')
    expect(mid.urgentEvents?.some((e) => e.title === '季报测试待决')).toBe(true)

    // 进一步污染
    gs.fieldPlots.value = gs.fieldPlots.value.map((f) =>
      f.id === 'f5' ? { ...f, status: 'barren' as const, assigned: null } : f,
    )
    gs.resolveUrgentEvent('u-season-test', 'a')
    expect(gs.fieldPlots.value.find((f) => f.id === 'f5')?.status).toBe('barren')
    expect(gs.openUrgentEvents.value.some((e) => e.title === '季报测试待决')).toBe(false)

    restoreWorldState(mid)
    expect(gs.fieldPlots.value).toEqual(midFields)
    expect(gs.urgentEvents.value).toEqual(midUrgents)
    expect(gs.fieldPlots.value.find((f) => f.id === 'f5')?.status).toBe('idle')
    expect(gs.openUrgentEvents.value.some((e) => e.title === '季报测试待决')).toBe(true)
  })

  it('legacy snapshot without fieldPlots/urgentEvents preserves current live (no wipe)', () => {
    const gs = useGameState()
    const keepFields = JSON.parse(JSON.stringify(gs.fieldPlots.value))
    const keepUrgents = JSON.parse(JSON.stringify(gs.urgentEvents.value))

    const legacy = snapshotWorldState()
    // 模拟旧会话 stateAfter
    const stripped: WorldSnapshot = { ...legacy }
    delete stripped.fieldPlots
    delete stripped.urgentEvents

    gs.fieldPlots.value = keepFields.map((f: FieldPlot) =>
      f.id === 'f6' ? { ...f, assigned: '应保留' } : f,
    )
    const liveAssigned = gs.fieldPlots.value.find((f) => f.id === 'f6')?.assigned

    restoreWorldState(stripped)
    expect(gs.fieldPlots.value.find((f) => f.id === 'f6')?.assigned).toBe(liveAssigned)
    expect(gs.urgentEvents.value).toEqual(
      expect.arrayContaining(keepUrgents.map((e: UrgentEvent) => expect.objectContaining({ id: e.id }))),
    )
  })
})

describe('assignFieldPlot live write', () => {
  beforeEach(() => {
    const gs = useGameState()
    gs.resetGameToOpening()
    gs.markOpeningDone()
  })

  it('updates fieldPlots.assigned on shipped mutator', () => {
    const gs = useGameState()
    const idle = gs.fieldPlots.value.find((f) => f.id === 'f6')
    expect(idle?.status).toBe('idle')
    expect(idle?.assigned).toBeNull()

    const r = gs.assignFieldPlot('f6', '林晚舟')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.assigned).toBe('林晚舟')
    expect(gs.fieldPlots.value.find((f) => f.id === 'f6')?.assigned).toBe('林晚舟')
  })

  it('idle + assigned auto-replants on next season tickFields', () => {
    const gs = useGameState()
    const assign = gs.assignFieldPlot('f6', '赵阿禾')
    expect(assign.ok).toBe(true)

    const fields = gs.fieldPlots.value
    const { next, lines } = tickFields(fields)
    const f6 = next.find((f) => f.id === 'f6')
    expect(f6?.status).toBe('growing')
    expect(f6?.assigned).toBe('赵阿禾')
    expect(f6?.crop).toMatch(/灵谷/)
    expect(lines.some((l) => l.includes('山门侧田') && l.includes('赵阿禾'))).toBe(true)
  })

  it('assign then advanceSeason keeps assigned and can replant idle plot', () => {
    const gs = useGameState()
    // 先把 f6 指派；若种子里 f5 收获后 idle 且已有 assigned，也会复种
    expect(gs.assignFieldPlot('f6', '苏青棠').ok).toBe(true)
    const { lines } = gs.advanceSeason()
    const f6 = gs.fieldPlots.value.find((f) => f.id === 'f6')
    expect(f6?.assigned).toBe('苏青棠')
    // 一季 tick：idle+assigned → growing
    expect(f6?.status).toBe('growing')
    expect(lines.some((l) => l.includes('山门侧田') && l.includes('复种'))).toBe(true)
  })

  it('unknown plot id fails without mutating', () => {
    const gs = useGameState()
    const before = JSON.stringify(gs.fieldPlots.value)
    const r = gs.assignFieldPlot('no-such', '甲')
    expect(r.ok).toBe(false)
    expect(JSON.stringify(gs.fieldPlots.value)).toBe(before)
  })
})
