import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_PENDING_TURNS,
  clearPendingTurns,
  loadPendingTurns,
  pendingTurnCount,
  pushPendingTurn,
  savePendingTurns,
} from './memory-batch'

function turn(id: string, body = '今日宗门无事，各安其位。') {
  return { id, body, rosterNames: ['沈青'], calendar: { year: 1, season: '春' }, ts: Date.now() }
}

/** node 环境下 localStorage 是残缺占位，stub 一个 map 版 */
function createStorage(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      m.set(k, String(v))
    },
    removeItem: (k) => {
      m.delete(k)
    },
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size
    },
  } as Storage
}

beforeEach(() => {
  vi.stubGlobal('localStorage', createStorage())
  clearPendingTurns()
})

afterEach(() => {
  vi.unstubAllGlobals()
  clearPendingTurns()
})

describe('memory-batch 待记队列', () => {
  it('入队返回队列长度并可读回', () => {
    expect(pushPendingTurn(turn('a'))).toBe(1)
    expect(pushPendingTurn(turn('b'))).toBe(2)
    expect(pendingTurnCount()).toBe(2)
    expect(loadPendingTurns().map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('持久化到 localStorage（模拟跨刷新重建）', () => {
    pushPendingTurn(turn('a'))
    // 重新走 localStorage 读路径：先直接读键验证已写入
    const raw = localStorage.getItem('zongmen-memory-pending-v1')
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw!).length).toBe(1)
  })

  it('savePendingTurns 截断到上限，挤出最早条目', () => {
    const list = Array.from({ length: MAX_PENDING_TURNS + 3 }, (_, i) => turn(`t${i}`))
    savePendingTurns(list)
    expect(pendingTurnCount()).toBe(MAX_PENDING_TURNS)
    const ids = loadPendingTurns().map((t) => t.id)
    expect(ids[0]).toBe(`t${3}`) // 最早 3 条被挤出
    expect(ids[ids.length - 1]).toBe(`t${MAX_PENDING_TURNS + 2}`)
  })

  it('损坏 JSON / 非数组容错', () => {
    localStorage.setItem('zongmen-memory-pending-v1', '{bad json')
    expect(loadPendingTurns()).toEqual([])
    localStorage.setItem('zongmen-memory-pending-v1', JSON.stringify({ not: 'array' }))
    expect(loadPendingTurns()).toEqual([])
  })

  it('过滤掉无正文条目，保留有效字段', () => {
    savePendingTurns([
      { id: 'x', body: '', rosterNames: [], ts: 0 },
      { id: 'y', body: '  有正文  ', rosterNames: ['沈青'], ts: 7 },
    ])
    const list = loadPendingTurns()
    expect(list.length).toBe(1)
    expect(list[0].id).toBe('y')
    expect(list[0].rosterNames).toEqual(['沈青'])
    expect(list[0].calendar?.year).toBeUndefined()
  })
})
