import { describe, it, expect } from 'vitest'
import { parseSettlePayload } from './world-delta'

describe('parseSettlePayload', () => {
  it('parses bare JSON', () => {
    const r = parseSettlePayload('{"resources":{},"ops":[],"summary":"无局面变更"}')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.delta.ops).toEqual([])
  })
})
