import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { clearMemoryBank, getMemoryBank, recordTurnSum } from './memory-lore'
import { clearMemoryArchive, getArchiveMirror } from './memory-archive'

function stubLocalStorage() {
  const map = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, String(v)) },
    removeItem: (k: string) => { map.delete(k) },
    clear: () => { map.clear() },
    key: (_i: number) => null,
    get length() { return map.size },
  })
}

describe('memory-lore L2 溢出归档（不静默丢弃）', () => {
  beforeEach(() => {
    stubLocalStorage()
    clearMemoryBank()
    clearMemoryArchive()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('长期大事超 24 条后，最早条目归档到冷档案', () => {
    for (let i = 1; i <= 25; i++) {
      recordTurnSum(`第${i}次大战结盟`)
    }
    expect(getMemoryBank().long.length).toBeLessThanOrEqual(24)
    const archived = getArchiveMirror().filter((b) => b.nodeName === '宗门纪要')
    expect(archived.length).toBeGreaterThan(0)
    expect(archived[0]?.text).toContain('大战结盟')
  })

  it('中期摘要超长截断时，截掉的开头归档', () => {
    const filler = '弟子日常巡山采药记于卷宗'.repeat(20)
    for (let i = 1; i <= 90; i++) {
      recordTurnSum(`${filler} 第${i}回`)
    }
    const archived = getArchiveMirror().filter((b) => b.text.includes('中期归档'))
    expect(archived.length).toBeGreaterThan(0)
  })
})
