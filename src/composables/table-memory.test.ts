import { describe, it, expect, beforeEach } from 'vitest'
import {
  createDefaultTableMemoryState,
  parseMemoryText,
  extractMemoryRows,
  applyMemoryTextToState,
  applyRowsToState,
  formatWorldStateInjection,
  getPrimaryColumnName,
  findTable,
  hasMemoryTag,
  applyAssistantMemoryTags,
  loadTableMemory,
  clearTableMemory,
  getTableMemory,
  saveTableMemory,
} from './table-memory'
import { recordTurnSum, clearMemoryBank, loadMemoryBank, formatShortMemory } from './memory-lore'

/** 无 localStorage 的 node 环境：用内存垫片 */
const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  const ls = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v))
    },
    removeItem: (k: string) => {
      store.delete(k)
    },
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: ls,
    configurable: true,
  })
  clearTableMemory()
  clearMemoryBank()
})

const FIXTURE_MEMORY = `<Memory><!--
#角色档案
[陆承渊]|身份：内门弟子|当前位置：青石城
#物品追踪
[掌门印]|持有者：掌门|状态：完好
--></Memory>`

describe('parseMemoryText / extractMemoryRows (yuzuki-compatible)', () => {
  it('parses #表名 + [主键]|字段：值 from Memory body', () => {
    const rows = parseMemoryText(`#角色档案
[陆承渊]|身份：内门弟子|当前位置：青石城
#物品追踪
[掌门印]|持有者：掌门|状态：完好`)
    expect(rows).toHaveLength(2)
    expect(rows[0].table).toBe('角色档案')
    expect(rows[0].primaryValue).toBe('陆承渊')
    expect(rows[0].values['身份']).toBe('内门弟子')
    expect(rows[0].values['当前位置']).toBe('青石城')
    expect(rows[1].table).toBe('物品追踪')
    expect(rows[1].primaryValue).toBe('掌门印')
    expect(rows[1].values['持有者']).toBe('掌门')
  })

  it('extracts from <Memory>, <GaigaiMemory>, <tableEdit> case-insensitively', () => {
    const a = extractMemoryRows(FIXTURE_MEMORY)
    expect(a.length).toBe(2)
    expect(hasMemoryTag(FIXTURE_MEMORY)).toBe(true)

    const b = extractMemoryRows(
      `<GaigaiMemory>#世界设定\n[赤焰谷]|类型：外敌|详细说明：求矿脉</GaigaiMemory>`,
    )
    expect(b).toHaveLength(1)
    expect(b[0].primaryValue).toBe('赤焰谷')

    const c = extractMemoryRows(
      `<tableEdit>#角色档案\n[沈微]|身份：外门弟子</tableEdit>`,
    )
    expect(c[0].values['身份']).toBe('外门弟子')
  })
})

describe('applyMemoryTextToState PK merge', () => {
  it('creates rows then merges only provided fields on second update', () => {
    const s = createDefaultTableMemoryState()
    const first = applyMemoryTextToState(s, FIXTURE_MEMORY)
    expect(first.success).toBe(true)
    expect(first.count).toBe(2)

    const charTable = findTable(s, '角色档案')!
    const primary = getPrimaryColumnName(charTable)
    const records = s.records[charTable.id]
    expect(records).toHaveLength(1)
    expect(records[0].values[primary]).toBe('陆承渊')
    expect(records[0].values['身份']).toBe('内门弟子')
    expect(records[0].values['当前位置']).toBe('青石城')

    // 部分更新：只改位置，身份应保留
    const second = applyMemoryTextToState(
      s,
      `<Memory>#角色档案\n[陆承渊]|当前位置：山门广场</Memory>`,
    )
    expect(second.success).toBe(true)
    expect(s.records[charTable.id]).toHaveLength(1)
    expect(s.records[charTable.id][0].values['当前位置']).toBe('山门广场')
    expect(s.records[charTable.id][0].values['身份']).toBe('内门弟子')

    const itemTable = findTable(s, '物品追踪')!
    expect(s.records[itemTable.id][0].values['状态']).toBe('完好')
  })

  it('skips empty field values (no-change omit)', () => {
    const s = createDefaultTableMemoryState()
    applyMemoryTextToState(
      s,
      `<Memory>#角色档案\n[陆承渊]|身份：内门弟子|当前位置：青石城</Memory>`,
    )
    applyRowsToState(s, [
      {
        table: '角色档案',
        primaryValue: '陆承渊',
        values: { 身份: '', 当前位置: '后山' },
      },
    ])
    const rec = s.records.character_profile[0]
    expect(rec.values['身份']).toBe('内门弟子')
    expect(rec.values['当前位置']).toBe('后山')
  })
})

describe('formatWorldStateInjection', () => {
  it('empty bank returns placeholder, does not throw', () => {
    const s = createDefaultTableMemoryState()
    const text = formatWorldStateInjection(s)
    expect(text).toContain('【当前世界状态参考】')
    expect(text).toMatch(/暂无/)
  })

  it('includes primary keys and updated fields after merge', () => {
    const s = createDefaultTableMemoryState()
    applyMemoryTextToState(s, FIXTURE_MEMORY)
    applyMemoryTextToState(
      s,
      `<Memory>#角色档案\n[陆承渊]|当前位置：山门广场</Memory>`,
    )
    const text = formatWorldStateInjection(s)
    expect(text).toContain('【当前世界状态参考】')
    expect(text).toContain('陆承渊')
    expect(text).toContain('山门广场')
    expect(text).toContain('掌门印')
    expect(text).toContain('内门弟子')
  })
})

describe('persist + applyAssistantMemoryTags (shipped entry)', () => {
  it('load/save/clear with lifecycle; applyAssistantMemoryTags drives real path', () => {
    const r = applyAssistantMemoryTags(FIXTURE_MEMORY)
    expect(r.success).toBe(true)
    expect(r.count).toBe(2)

    // 重新 load 应恢复
    const loaded = loadTableMemory()
    expect(loaded.records.character_profile?.length).toBe(1)
    expect(loaded.records.character_profile[0].values['角色名']).toBe('陆承渊')

    clearTableMemory()
    expect(getTableMemory().records.character_profile).toBeUndefined()
    const empty = loadTableMemory()
    expect(empty.records.character_profile || []).toHaveLength(0)
  })
})

describe('non-regression: recordTurnSum path still works', () => {
  it('sum layers update independently of table memory', () => {
    applyAssistantMemoryTags(FIXTURE_MEMORY)
    const bank = recordTurnSum('赤焰谷使者求见，谈及矿脉。', { context: '赤焰谷' })
    expect(bank.short.length).toBeGreaterThan(0)
    expect(bank.short[0]).toContain('赤焰谷')
    loadMemoryBank()
    const shortText = formatShortMemory()
    expect(shortText).toContain('赤焰谷')
    // 表格仍在
    expect(getTableMemory().records.character_profile?.[0]?.values['角色名']).toBe(
      '陆承渊',
    )
  })
})

describe('integration structure: format injection after apply', () => {
  it('round-trip fixture matches plan verification sample', () => {
    clearTableMemory()
    applyAssistantMemoryTags(FIXTURE_MEMORY)
    applyAssistantMemoryTags(
      `<memory><!--
#角色档案
[陆承渊]|身份：内门弟子|当前位置：山门
--></memory>`,
    )
    saveTableMemory()
    const inj = formatWorldStateInjection(loadTableMemory())
    expect(inj).toContain('陆承渊')
    expect(inj).toContain('山门')
    expect(inj).toContain('掌门印')
    expect(inj).toContain('【角色档案】')
    expect(inj).toContain('【物品追踪】')
  })
})
