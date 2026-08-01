/**
 * 批量统一记忆 — 待记回合队列
 * ---------------------------------------------------------------------------
 * LLM 摘要引擎开启「批量窗口」（settings.memoryBatchSize ≥ 2）时：
 * 每回合正文先入队（localStorage 持久化，跨刷新不丢），攒满窗口后
 * 一次性调用 summarizeTurnToBeats 统一记账，省调用且上下文更连贯。
 * 队列只在窗口边界消费，与「历史只保留 N 楼」互不干扰（正文独立持久化）。
 */
import { MEMORY_PENDING_STORAGE_KEY } from '@/data/opening'

export interface PendingTurn {
  id: string
  body: string
  rosterNames: string[]
  calendar?: { year?: number; season?: string }
  ts: number
}

/** 队列硬上限：防止异常时无限膨胀（正常攒批不会超过 batchSize + 1） */
export const MAX_PENDING_TURNS = 16

let mirror: PendingTurn[] | null = null

export function loadPendingTurns(): PendingTurn[] {
  if (mirror) return mirror
  let list: PendingTurn[] = []
  try {
    const raw = localStorage.getItem(MEMORY_PENDING_STORAGE_KEY)
    if (raw) {
      const o = JSON.parse(raw)
      if (Array.isArray(o)) {
        list = o
          .filter((t) => t && typeof t.body === 'string' && t.body.trim())
          .map((t): PendingTurn => ({
            id: String(t.id || ''),
            body: String(t.body || ''),
            rosterNames: Array.isArray(t.rosterNames) ? t.rosterNames.map(String) : [],
            calendar:
              t.calendar && typeof t.calendar === 'object'
                ? {
                    year: Number(t.calendar.year) || undefined,
                    season: String(t.calendar.season || ''),
                  }
                : undefined,
            ts: Number(t.ts) || 0,
          }))
      }
    }
  } catch {
    /* 损坏数据按空队列处理 */
  }
  mirror = list
  return list
}

export function savePendingTurns(list: PendingTurn[]): void {
  const cleaned = list.filter((t) => t && typeof t.body === 'string' && t.body.trim())
  const next = cleaned.slice(-MAX_PENDING_TURNS)
  mirror = next
  try {
    localStorage.setItem(MEMORY_PENDING_STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* keep memory mirror */
  }
}

/** 入队一回合正文；返回入队后的队列长度（已截断到上限） */
export function pushPendingTurn(t: PendingTurn): number {
  const list = loadPendingTurns()
  list.push(t)
  savePendingTurns(list)
  return mirror!.length
}

export function clearPendingTurns(): void {
  mirror = null
  try {
    localStorage.removeItem(MEMORY_PENDING_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export function pendingTurnCount(): number {
  return loadPendingTurns().length
}
