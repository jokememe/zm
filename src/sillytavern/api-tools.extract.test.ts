import { describe, it, expect } from 'vitest'
import {
  extractChatCompletionText,
  extractStreamDeltaPieces,
} from './api-tools'

describe('extractChatCompletionText', () => {
  it('reads string message.content', () => {
    const r = extractChatCompletionText({
      choices: [{ message: { content: '{"ops":[]}' }, finish_reason: 'stop' }],
    })
    expect(r.text).toBe('{"ops":[]}')
    expect(r.finishReason).toBe('stop')
    expect(r.hadReasoning).toBe(false)
  })

  it('falls back to reasoning_content when content empty', () => {
    const r = extractChatCompletionText({
      choices: [
        {
          message: {
            content: '',
            reasoning_content: '思考…\n{"resources":{},"ops":[],"summary":"无"}',
          },
          finish_reason: 'stop',
        },
      ],
    })
    expect(r.text).toContain('"ops"')
    expect(r.hadReasoning).toBe(true)
  })

  it('flattens multipart content array', () => {
    const r = extractChatCompletionText({
      choices: [
        {
          message: {
            content: [
              { type: 'text', text: '{"a":1' },
              { type: 'text', text: '}' },
            ],
          },
        },
      ],
    })
    expect(r.text).toBe('{"a":1}')
  })

  it('returns empty with finish_reason length', () => {
    const r = extractChatCompletionText({
      choices: [{ message: { content: '' }, finish_reason: 'length' }],
    })
    expect(r.text).toBe('')
    expect(r.finishReason).toBe('length')
  })
})

describe('extractStreamDeltaPieces', () => {
  it('reads delta.content', () => {
    const r = extractStreamDeltaPieces({
      choices: [{ delta: { content: '{"a"' } }],
    })
    expect(r.content).toBe('{"a"')
    expect(r.reasoning).toBe('')
  })

  it('reads delta.reasoning_content', () => {
    const r = extractStreamDeltaPieces({
      choices: [{ delta: { content: '', reasoning_content: 'think' }, finish_reason: null }],
    })
    expect(r.content).toBe('')
    expect(r.reasoning).toBe('think')
  })

  it('reads finish_reason', () => {
    const r = extractStreamDeltaPieces({
      choices: [{ delta: {}, finish_reason: 'stop' }],
    })
    expect(r.finishReason).toBe('stop')
  })
})
