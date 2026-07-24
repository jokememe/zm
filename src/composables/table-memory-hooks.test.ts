/**
 * 静态 + 结构集成：确认 Tianji / system-lorebook 真实调用点接入表格记忆，
 * 且 sum 路径未拆除。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  MEM_SHORT_ID,
  MEM_MID_ID,
  MEM_LONG_ID,
  recordTurnSum,
  clearMemoryBank,
  formatShortMemory,
  formatMidMemory,
  formatLongMemory,
} from './memory-lore'
import {
  TABLE_WORLD_STATE_ENTRY_ID,
  formatWorldStateInjection,
  createDefaultTableMemoryState,
  applyMemoryTextToState,
} from './table-memory'
import { DEFAULT_FORMAT_PROMPT } from '@/sillytavern/types'

const here = dirname(fileURLToPath(import.meta.url))

function readSrc(rel: string): string {
  return readFileSync(join(here, rel), 'utf8')
}

describe('Tianji + system lore hooks (shipped sources)', () => {
  it('useTianji post-reply applies Memory tags and still records sum', () => {
    const src = readSrc('useTianji.ts')
    expect(src).toMatch(/applyAssistantMemoryTags/)
    expect(src).toMatch(/hasMemoryTag/)
    expect(src).toMatch(/recordTurnSum/)
    expect(src).toMatch(/ensureAndRefreshSystemLorebook/)
    // 调用点顺序（非 import）：先表格 apply，再 sum
    const callApply = src.indexOf('applyAssistantMemoryTags(raw)')
    const callSum = src.indexOf('recordTurnSum(parsed.sum')
    expect(callApply).toBeGreaterThan(0)
    expect(callSum).toBeGreaterThan(callApply)
  })

  it('system-lorebook injects table world state alongside mem-short/mid/long', () => {
    const src = readSrc('system-lorebook.ts')
    expect(src).toMatch(/TABLE_WORLD_STATE_ENTRY_ID/)
    expect(src).toMatch(/formatWorldStateInjection/)
    expect(src).toMatch(/loadTableMemory/)
    expect(src).toMatch(/MEM_SHORT_ID/)
    expect(src).toMatch(/MEM_MID_ID/)
    expect(src).toMatch(/MEM_LONG_ID/)
    expect(src).toMatch(/formatShortMemory/)
    expect(src).toMatch(/formatMidMemory/)
    expect(src).toMatch(/formatLongMemory/)
  })

  it('opening/reset clears table memory with sum bank', () => {
    const src = readSrc('useGameState.ts')
    expect(src).toMatch(/seedOpeningTableMemory/)
    expect(src).toMatch(/clearTableMemory/)
    expect(src).toMatch(/clearMemoryBank/)
    expect(src).toMatch(/seedOpeningMemory/)
  })

  it('format prompt hints model may emit Memory without dropping sum/maintext', () => {
    expect(DEFAULT_FORMAT_PROMPT).toContain('<Memory>')
    expect(DEFAULT_FORMAT_PROMPT).toContain('<sum>')
    expect(DEFAULT_FORMAT_PROMPT).toContain('<maintext>')
    expect(DEFAULT_FORMAT_PROMPT).toMatch(/角色档案|物品追踪|世界设定/)
  })

  it('entry ids used for constant injection are stable exports', () => {
    expect(MEM_SHORT_ID).toBe('mem-short')
    expect(MEM_MID_ID).toBe('mem-mid')
    expect(MEM_LONG_ID).toBe('mem-long')
    expect(TABLE_WORLD_STATE_ENTRY_ID).toBe('table-world-state')
  })
})

describe('ensure path functions still produce sum + table text', () => {
  it('formatters for empty banks are defined (assemble-safe)', () => {
    clearMemoryBank()
    expect(formatShortMemory()).toContain('短期记忆')
    expect(formatMidMemory()).toContain('中期记忆')
    expect(formatLongMemory()).toContain('长期记忆')
    expect(formatWorldStateInjection(createDefaultTableMemoryState())).toContain(
      '当前世界状态参考',
    )
  })

  it('recordTurnSum still mutates short layer (shipped function)', () => {
    // localStorage shim
    const store = new Map<string, string>()
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => store.set(k, String(v)),
        removeItem: (k: string) => store.delete(k),
      },
      configurable: true,
    })
    clearMemoryBank()
    recordTurnSum('结盟成功，纳贡三千灵石。')
    expect(formatShortMemory()).toMatch(/结盟|纳贡/)
  })

  it('table apply + injection is pure and callable without Vue', () => {
    const s = createDefaultTableMemoryState()
    applyMemoryTextToState(
      s,
      `<Memory>#世界设定\n[青岚宗]|类型：宗门|详细说明：残峰再起</Memory>`,
    )
    const inj = formatWorldStateInjection(s)
    expect(inj).toContain('青岚宗')
    expect(inj).toContain('残峰再起')
  })
})
