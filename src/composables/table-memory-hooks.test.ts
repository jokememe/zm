/**
 * 静态 + 结构集成：Tianji / system-lorebook 主路径是角色记忆图谱 + sum，
 * 不再把整表世界状态当记忆注入。
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
  createDefaultTableMemoryState,
  applyMemoryTextToState,
} from './table-memory'
import {
  ensureMemoryGraphHydrated,
  selectMemoryGraphForTurn,
  clearMemoryGraph,
} from './memory-graph'
import { DEFAULT_FORMAT_PROMPT } from '@/sillytavern/types'
import './memory-graph'

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
    expect(src).toMatch(/selectMemoryGraphForTurn/)
    // 调用点顺序（非 import）：先表格 apply，再 sum
    const callApply = src.indexOf('applyAssistantMemoryTags(raw)')
    const callSum = src.indexOf('recordTurnSum(parsed.sum')
    expect(callApply).toBeGreaterThan(0)
    expect(callSum).toBeGreaterThan(callApply)
  })

  it('system-lorebook injects graph memory, not table world dump', () => {
    const src = readSrc('system-lorebook.ts')
    expect(src).toMatch(/selectMemoryGraphForTurn/)
    expect(src).toMatch(/ensureMemoryGraphHydrated/)
    expect(src).toMatch(/MEM_GRAPH_ID|mem-graph-beats/)
    expect(src).toMatch(/MEM_SHORT_ID/)
    expect(src).toMatch(/MEM_MID_ID/)
    expect(src).toMatch(/MEM_LONG_ID/)
    expect(src).not.toMatch(/formatWorldStateInjection/)
    expect(src).not.toMatch(/TABLE_WORLD_STATE_ENTRY_ID/)
  })

  it('opening/reset clears graph + sum bank', () => {
    const src = readSrc('useGameState.ts')
    expect(src).toMatch(/clearMemoryBank/)
    expect(src).toMatch(/seedOpeningMemory/)
  })

  it('TianjiPanel 记忆入口跳角色记忆图谱，不挂表格 MemoryModal', () => {
    const panel = readFileSync(
      join(here, '../components/layout/TianjiPanel.vue'),
      'utf8',
    )
    expect(panel).not.toMatch(/MemoryModal/)
    expect(panel).toMatch(/memory-graph|角色记忆/)
    expect(panel).toMatch(/setView\('memory-graph'\)/)
  })

  it('SettingsModal 有 memoryRecallMode 入口（keyword/embedding/both）', () => {
    const settings = readFileSync(
      join(here, '../components/SillyTavern/SettingsModal.vue'),
      'utf8',
    )
    expect(settings).toMatch(/memoryRecallMode/)
    expect(settings).toMatch(/value="keyword"/)
    expect(settings).toMatch(/value="embedding"/)
    expect(settings).toMatch(/value="both"/)
  })

  it('format prompt hints model may emit Memory without dropping sum/maintext', () => {
    expect(DEFAULT_FORMAT_PROMPT.toLowerCase()).toContain('<memory>')
    expect(DEFAULT_FORMAT_PROMPT).toContain('<sum>')
    expect(DEFAULT_FORMAT_PROMPT).toContain('<maintext>')
    expect(DEFAULT_FORMAT_PROMPT).toMatch(/关系变化|角色名/)
  })

  it('entry ids used for constant injection are stable exports', () => {
    expect(MEM_SHORT_ID).toBe('mem-short')
    expect(MEM_MID_ID).toBe('mem-mid')
    expect(MEM_LONG_ID).toBe('mem-long')
  })
})

describe('ensure path functions still produce sum + graph', () => {
  it('formatters for empty banks are defined (assemble-safe)', () => {
    clearMemoryBank()
    clearMemoryGraph()
    expect(formatShortMemory()).toContain('短期记忆')
    expect(formatMidMemory()).toContain('中期记忆')
    expect(formatLongMemory()).toContain('长期记忆')
    const g = ensureMemoryGraphHydrated()
    const picked = selectMemoryGraphForTurn({
      graph: g,
      query: '',
      maxNodes: 3,
      maxChars: 400,
    })
    expect(typeof picked.text).toBe('string')
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

  it('table apply still works as backend fill (not lore inject path)', () => {
    const s = createDefaultTableMemoryState()
    applyMemoryTextToState(
      s,
      `<Memory>#世界设定\n[青岚宗]|类型：宗门|详细说明：残峰再起</Memory>`,
    )
    // 表格仍可解析写入；主路径注入已不走 formatWorldStateInjection
    expect(JSON.stringify(s.records)).toMatch(/青岚宗|残峰再起/)
  })
})
