import { describe, it, expect, vi } from 'vitest'
import {
  isRetryableFailureMessage,
  withRetry,
  withRetryHint,
} from './api-retry'

describe('isRetryableFailureMessage', () => {
  it('flags network / timeout / empty', () => {
    expect(isRetryableFailureMessage('Failed to fetch')).toBe(true)
    expect(isRetryableFailureMessage('timeout 30s')).toBe(true)
    expect(isRetryableFailureMessage('429 rate limit')).toBe(true)
    expect(isRetryableFailureMessage('返回为空')).toBe(true)
    expect(isRetryableFailureMessage('JSON parse error')).toBe(true)
  })

  it('does not flag clear business skip', () => {
    expect(isRetryableFailureMessage('API 未配齐')).toBe(false)
    expect(isRetryableFailureMessage('用户取消')).toBe(false)
  })
})

describe('withRetry', () => {
  it('returns first success without extra calls', async () => {
    const fn = vi.fn(async () => ({ ok: true as const }))
    const r = await withRetry(fn, {
      maxAttempts: 3,
      delayMs: 0,
      shouldRetry: (x) => !x.ok,
    })
    expect(r.attempts).toBe(1)
    expect(r.retried).toBe(false)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries failure then succeeds', async () => {
    let n = 0
    const fn = vi.fn(async () => {
      n += 1
      return n === 1 ? { ok: false as const, error: 'timeout' } : { ok: true as const }
    })
    const r = await withRetry(fn, {
      maxAttempts: 2,
      delayMs: 0,
      shouldRetry: (x) => !x.ok && isRetryableFailureMessage((x as { error?: string }).error || ''),
    })
    expect(r.attempts).toBe(2)
    expect(r.retried).toBe(true)
    expect(r.result).toEqual({ ok: true })
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

describe('withRetryHint', () => {
  it('appends retry count', () => {
    expect(withRetryHint('网络错误', 2)).toContain('已重试 1 次')
    expect(withRetryHint('网络错误', 1)).toBe('网络错误')
  })
})
