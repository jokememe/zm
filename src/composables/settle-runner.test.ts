import { describe, it, expect } from 'vitest'
import {
  resolveSettleTarget,
  formatSnapshotForSettle,
  clipText,
  textFromSettleCompletion,
} from './settle-runner'
import { parseSettlePayload, emptyTestSnapshot } from './world-delta'

/** Mirrors the naive path regressed in 4974d3a (content-only). */
function naiveMessageContent(data: unknown): string {
  const d = data as { choices?: Array<{ message?: { content?: string } }> }
  return d.choices?.[0]?.message?.content || ''
}

const settleJson = '{"resources":{"灵石":-10},"ops":[],"summary":"耗灵石"}'

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

describe('textFromSettleCompletion → parseSettlePayload', () => {
  it('documents that content-only path fails on reasoning-only secondary body', () => {
    const body = {
      choices: [
        {
          message: {
            content: '',
            reasoning_content: settleJson,
          },
          finish_reason: 'stop',
        },
      ],
    }
    expect(naiveMessageContent(body).trim()).toBe('')
  })

  it('extracts bare message.content JSON and parses settle payload', () => {
    const body = {
      choices: [{ message: { content: settleJson }, finish_reason: 'stop' }],
    }
    const extracted = textFromSettleCompletion(body)
    expect(extracted.ok).toBe(true)
    if (!extracted.ok) return
    const parsed = parseSettlePayload(extracted.text)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.delta.resources?.['灵石']).toBe(-10)
      expect(parsed.delta.summary).toBe('耗灵石')
    }
  })

  it('extracts reasoning_content when content empty and parses settle payload', () => {
    const body = {
      choices: [
        {
          message: {
            content: '',
            reasoning_content: `分析中…\n${settleJson}`,
          },
          finish_reason: 'stop',
        },
      ],
    }
    const extracted = textFromSettleCompletion(body)
    expect(extracted.ok).toBe(true)
    if (!extracted.ok) return
    const parsed = parseSettlePayload(extracted.text)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.delta.resources?.['灵石']).toBe(-10)
  })

  it('assembles multipart content array then parses settle payload', () => {
    const body = {
      choices: [
        {
          message: {
            content: [
              { type: 'text', text: '{"resources":{"灵石":-10},' },
              { type: 'text', text: '"ops":[],"summary":"耗灵石"}' },
            ],
          },
          finish_reason: 'stop',
        },
      ],
    }
    const extracted = textFromSettleCompletion(body)
    expect(extracted.ok).toBe(true)
    if (!extracted.ok) return
    const parsed = parseSettlePayload(extracted.text)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.delta.resources?.['灵石']).toBe(-10)
  })

  it('parses loose single-quoted settle JSON from content', () => {
    const loose = "{'resources':{'灵石':-10},'ops':[],'summary':'耗灵石'}"
    const body = {
      choices: [{ message: { content: loose }, finish_reason: 'stop' }],
    }
    const extracted = textFromSettleCompletion(body)
    expect(extracted.ok).toBe(true)
    if (!extracted.ok) return
    const parsed = parseSettlePayload(extracted.text)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.delta.resources?.['灵石']).toBe(-10)
      expect(parsed.delta.summary).toBe('耗灵石')
    }
  })

  it('fails empty body with diagnostic mentioning emptiness and finish_reason', () => {
    const body = {
      choices: [{ message: { content: '' }, finish_reason: 'length' }],
    }
    const extracted = textFromSettleCompletion(body)
    expect(extracted.ok).toBe(false)
    if (extracted.ok) return
    expect(extracted.error).toMatch(/空/)
    expect(extracted.error).toMatch(/finish_reason=length/)
  })
})
