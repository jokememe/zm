/**
 * 各侧 API（局面 settle / 记忆填表 / 纪要合并）失败时的轻量重试。
 * 默认最多 2 次（1 次重试），避免超时叠成「连打三次」。
 */

export const DEFAULT_API_MAX_ATTEMPTS = 2
export const DEFAULT_API_RETRY_DELAY_MS = 700

/** 可重试的瞬时/可恢复错误（网络、限流、空包、截断、解析毛刺） */
export function isRetryableFailureMessage(msg: string): boolean {
  const s = String(msg || '')
  if (!s.trim()) return true
  return /timeout|timed?\s*out|network|fetch|Load failed|Failed to fetch|ECONN|ENOTFOUND|abort|429|502|503|504|rate.?limit|空|截断|parse|JSON|malformed|unexpected|暂无|重试|busy|overloaded|stream/i.test(
    s,
  )
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}

export interface RetryLoopResult<T> {
  result: T
  attempts: number
  retried: boolean
}

/**
 * 对异步任务做有限次重试。
 * shouldRetry(result, attempt) 为 true 且未达上限时等待 delay 再跑。
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts?: {
    maxAttempts?: number
    delayMs?: number
    shouldRetry?: (result: T, attempt: number) => boolean
    onRetry?: (attempt: number, result: T) => void
  },
): Promise<RetryLoopResult<T>> {
  const max = Math.max(1, Math.min(4, opts?.maxAttempts ?? DEFAULT_API_MAX_ATTEMPTS))
  const wait = opts?.delayMs ?? DEFAULT_API_RETRY_DELAY_MS
  let last!: T
  for (let attempt = 1; attempt <= max; attempt++) {
    last = await fn(attempt)
    const again =
      attempt < max && (opts?.shouldRetry ? opts.shouldRetry(last, attempt) : false)
    if (!again) {
      return { result: last, attempts: attempt, retried: attempt > 1 }
    }
    opts?.onRetry?.(attempt, last)
    if (wait > 0) await delay(wait)
  }
  return { result: last, attempts: max, retried: max > 1 }
}

/** 给失败文案补上「已重试 n 次」 */
export function withRetryHint(message: string, attempts: number): string {
  const base = String(message || '失败').trim()
  if (attempts <= 1) return base
  if (/已重试/.test(base)) return base
  return `${base}（已重试 ${attempts - 1} 次仍失败）`
}
