import { describe, it, expect } from 'vitest'
import {
  selectRecentHistory,
  estimateTokensRough,
  compressAssistantFloor,
} from './prompt-assembler'
import type { ChatMessage } from './types'

function msg(
  role: 'user' | 'assistant' | 'system',
  content: string,
  i: number,
  extra?: Partial<ChatMessage>,
): ChatMessage {
  return {
    id: `m${i}`,
    role,
    content,
    timestamp: i,
    ...extra,
  }
}

describe('selectRecentHistory', () => {
  const long = '字'.repeat(400) // ~100 tokens each
  const history: ChatMessage[] = [
    msg('user', `u0-${long}`, 0),
    msg('assistant', `a0-${long}`, 1),
    msg('user', `u1-${long}`, 2),
    msg('assistant', `a1-${long}`, 3),
    msg('user', `u2-${long}`, 4),
    msg('assistant', `a2-${long}`, 5),
    msg('system', 'skip-me', 6),
    msg('user', 'u-near', 7),
    msg('assistant', 'a-near', 8),
  ]

  it('keeps at least N nearest user/assistant messages even if over soft budget', () => {
    // tiny budget would only fit ~1 short msg; keep=4 still takes last 4 non-system
    // compress off so content identity matches fixtures
    const selected = selectRecentHistory(history, {
      maxContextTokens: 40,
      budgetRatio: 0.75,
      keepMessages: 4,
      compress: false,
    })
    expect(selected).toHaveLength(4)
    // 最近 4 条非 system：u2, a2, u-near, a-near（时间正序）
    expect(selected.map((m) => m.content)).toEqual([
      `u2-${long}`,
      `a2-${long}`,
      'u-near',
      'a-near',
    ])
    expect(selected.every((m) => m.role === 'user' || m.role === 'assistant')).toBe(true)
  })

  it('keep=0 uses only token budget (old behavior)', () => {
    const selected = selectRecentHistory(history, {
      maxContextTokens: 40,
      budgetRatio: 0.75,
      keepMessages: 0,
      compress: false,
    })
    // short near messages fit; long ones may not
    expect(selected.length).toBeGreaterThanOrEqual(1)
    expect(selected[selected.length - 1].content).toBe('a-near')
    // with tiny budget, long tails should not all fit
    expect(selected.length).toBeLessThan(history.filter((m) => m.role !== 'system').length)
  })

  it('with large budget includes more than keep floor', () => {
    const selected = selectRecentHistory(history, {
      maxContextTokens: 100_000,
      budgetRatio: 0.75,
      keepMessages: 2,
      compress: false,
    })
    // all non-system
    expect(selected).toHaveLength(8)
    expect(selected[0].content.startsWith('u0-')).toBe(true)
    expect(selected[selected.length - 1].content).toBe('a-near')
  })

  it('skips system messages', () => {
    const selected = selectRecentHistory(history, {
      maxContextTokens: 100_000,
      keepMessages: 20,
      compress: false,
    })
    expect(selected.some((m) => m.content === 'skip-me')).toBe(false)
  })

  it('estimateTokensRough matches length/4', () => {
    expect(estimateTokensRough('abcd')).toBe(1)
  })

  it('hardMaxTokens caps history even when maxContext is huge', () => {
    const fat: ChatMessage[] = []
    for (let i = 0; i < 20; i++) {
      fat.push(msg('user', `u${i}-` + '字'.repeat(800), i * 2))
      fat.push(
        msg('assistant', `a${i}-` + '字'.repeat(800), i * 2 + 1, {
          parsed: {
            maintext: '正文'.repeat(200),
            sum: `第${i}回小结`,
            options: [],
            thinking: '',
            vars: {},
          } as ChatMessage['parsed'],
        }),
      )
    }
    const selected = selectRecentHistory(fat, {
      maxContextTokens: 200_000,
      budgetRatio: 0.75,
      keepMessages: 12,
      hardMaxTokens: 3000,
      compress: true,
    })
    const total = selected.reduce((n, m) => n + estimateTokensRough(m.content), 0)
    expect(total).toBeLessThanOrEqual(3200)
    // 远端应是小结形态
    const first = selected[0]
    if (first?.role === 'assistant') {
      expect(first.content).toMatch(/小结|摘要/)
    }
  })

  it('compressAssistantFloor drops thinking and keeps maintext/sum', () => {
    const m = msg(
      'assistant',
      `<thinking>${'想'.repeat(500)}</thinking><maintext>山门来客</maintext><sum>使者至</sum><option>A\nB</option>`,
      1,
      {
        parsed: {
          maintext: '山门来客',
          sum: '使者至',
          options: ['A', 'B'],
          thinking: '想'.repeat(500),
          vars: {},
        } as ChatMessage['parsed'],
      },
    )
    const full = compressAssistantFloor(m, 'full')
    expect(full).toContain('山门来客')
    expect(full).toContain('使者至')
    expect(full).not.toContain('想')
    const sum = compressAssistantFloor(m, 'summary')
    expect(sum).toMatch(/使者至/)
    expect(sum.length).toBeLessThan(80)
  })
})
