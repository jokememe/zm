import { describe, it, expect } from 'vitest'
import {
  resolveSettleTarget,
  formatSnapshotForSettle,
  clipText,
} from './settle-runner'
import { emptyTestSnapshot } from './world-delta'

describe('resolveSettleTarget', () => {
  it('off → skip', () => {
    const r = resolveSettleTarget('off', true)
    expect(r).toEqual({ kind: 'skip', reason: 'off' })
  })

  it('secondary_only without secondary → skip', () => {
    const r = resolveSettleTarget('secondary_only', false)
    expect(r).toEqual({ kind: 'skip', reason: 'secondary_only_unavailable' })
  })

  it('secondary_only with secondary → secondary only', () => {
    const r = resolveSettleTarget('secondary_only', true)
    expect(r).toEqual({ kind: 'call', targets: ['secondary'] })
  })

  it('secondary_then_primary without secondary → primary only', () => {
    const r = resolveSettleTarget('secondary_then_primary', false)
    expect(r).toEqual({ kind: 'call', targets: ['primary'] })
  })

  it('secondary_then_primary with secondary → secondary only (no chain fallback)', () => {
    const r = resolveSettleTarget('secondary_then_primary', true)
    expect(r).toEqual({ kind: 'call', targets: ['secondary'] })
  })
})

describe('formatSnapshotForSettle', () => {
  it('includes resources line', () => {
    const s = formatSnapshotForSettle(emptyTestSnapshot())
    expect(s).toContain('灵石')
  })
})

describe('clipText', () => {
  it('clips long text', () => {
    expect(clipText('abcdefghij', 5)).toBe('abcde…')
  })
})
