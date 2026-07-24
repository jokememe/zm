import { describe, it, expect, beforeEach } from 'vitest'
import {
  createDefaultTableMemoryState,
  clearTableMemory,
  loadTableMemory,
  saveTableMemory,
  applyMemoryTextToState,
  formatWorldStateInjection,
} from './table-memory'
import {
  planFloorUpdate,
  purgeOldFloorMarks,
  countAiFloors,
  collectAiMessageIndices,
} from './table-memory-scheduler'
import {
  checkAutoMergeTrigger,
  applyMergeResultToState,
  localCollapseMerge,
  listJournalRows,
  parseMergedJournalRows,
  countFineJournalRows,
  AUTO_MERGED_TAG,
} from './table-memory-merge'
import {
  buildJournalIndexText,
  parseRecallTag,
  selectJournalByKeyword,
  formatTableMemoryInjection,
} from './table-memory-recall'
import { DEFAULT_TABLE_MEMORY_SCHEDULER } from './table-memory-settings'
import { maybeAppendJournalFromSum } from './table-memory-pipeline'
// 注册 injector
import './table-memory-recall'

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => store.set(k, String(v)),
      removeItem: (k: string) => store.delete(k),
    },
    configurable: true,
  })
  clearTableMemory()
})

describe('planFloorUpdate (shujuku-aligned)', () => {
  const base = {
    autoUpdateThreshold: 3,
    autoUpdateFrequency: 1,
    updateBatchSize: 3,
    skipUpdateFloors: 0,
  }

  it('triggers when unrecorded >= frequency', () => {
    const r = planFloorUpdate({
      totalAiFloors: 5,
      lastUpdatedAiFloor: 4,
      scheduler: base,
      aiMessageIndices: [1, 3, 5, 7, 9],
    })
    expect(r.shouldUpdate).toBe(true)
    expect(r.effectiveUnrecorded).toBe(1)
    expect(r.indicesToUpdate.length).toBeGreaterThan(0)
  })

  it('does not trigger when not enough floors', () => {
    const r = planFloorUpdate({
      totalAiFloors: 5,
      lastUpdatedAiFloor: 5,
      scheduler: base,
    })
    expect(r.shouldUpdate).toBe(false)
    expect(r.reason).toMatch(/not_ready|all_skipped/)
  })

  it('frequency=0 disables auto update', () => {
    const r = planFloorUpdate({
      totalAiFloors: 10,
      lastUpdatedAiFloor: 0,
      scheduler: { ...base, autoUpdateFrequency: 0 },
    })
    expect(r.shouldUpdate).toBe(false)
    expect(r.reason).toBe('frequency_disabled')
  })

  it('respects skip floors in trigger math', () => {
    // Last=2, Freq=2, Skip=1 → need total such that (total-1)-2 >= 2 → total >= 5
    const notYet = planFloorUpdate({
      totalAiFloors: 4,
      lastUpdatedAiFloor: 2,
      scheduler: { ...base, autoUpdateFrequency: 2, skipUpdateFloors: 1 },
    })
    expect(notYet.shouldUpdate).toBe(false)

    const ready = planFloorUpdate({
      totalAiFloors: 5,
      lastUpdatedAiFloor: 2,
      scheduler: { ...base, autoUpdateFrequency: 2, skipUpdateFloors: 1 },
      aiMessageIndices: [0, 1, 2, 3, 4],
    })
    expect(ready.effectiveUnrecorded).toBe(2)
    expect(ready.shouldUpdate).toBe(true)
  })

  it('batches by updateBatchSize', () => {
    const r = planFloorUpdate({
      totalAiFloors: 6,
      lastUpdatedAiFloor: 0,
      scheduler: { ...base, autoUpdateThreshold: 6, updateBatchSize: 2 },
      aiMessageIndices: [0, 1, 2, 3, 4, 5],
    })
    expect(r.shouldUpdate).toBe(true)
    expect(r.batches.length).toBeGreaterThan(1)
    expect(r.batches[0].indices.length).toBeLessThanOrEqual(2)
  })

  it('countAiFloors / collectAiMessageIndices', () => {
    const msgs = [
      { role: 'user' },
      { role: 'assistant' },
      { role: 'user' },
      { role: 'assistant' },
      { role: 'system' },
    ]
    expect(countAiFloors(msgs)).toBe(2)
    expect(collectAiMessageIndices(msgs)).toEqual([1, 3])
  })
})

describe('purgeOldFloorMarks', () => {
  it('keeps last N', () => {
    expect(purgeOldFloorMarks([1, 2, 3, 4, 5], 3)).toEqual([3, 4, 5])
  })
  it('retain 0 keeps all', () => {
    expect(purgeOldFloorMarks([1, 2, 3], 0)).toEqual([1, 2, 3])
  })
})

describe('journal merge (auto_merged)', () => {
  function seedFineRows(n: number) {
    const s = createDefaultTableMemoryState()
    s.records['plot_journal'] = []
    for (let i = 1; i <= n; i++) {
      s.records['plot_journal'].push({
        id: `j${i}`,
        values: {
          编码索引: `J${String(i).padStart(4, '0')}`,
          概要: `事件${i}`,
          时间跨度: `楼${i}`,
          地点: '山门',
          纪要: `详细内容${i}`,
          标记: '',
        },
      })
    }
    return s
  }

  it('triggers when fine rows >= threshold + reserve', () => {
    const s = seedFineRows(20)
    const t = checkAutoMergeTrigger(s, {
      autoMergeEnabled: true,
      autoMergeThreshold: 20,
      autoMergeReserve: 0,
    })
    expect(t.shouldMerge).toBe(true)
    expect(t.mergeCount).toBe(20)
  })

  it('does not trigger below threshold', () => {
    const s = seedFineRows(5)
    const t = checkAutoMergeTrigger(s, {
      autoMergeEnabled: true,
      autoMergeThreshold: 20,
      autoMergeReserve: 0,
    })
    expect(t.shouldMerge).toBe(false)
  })

  it('localCollapseMerge creates auto_merged and removes fine', () => {
    const s = seedFineRows(5)
    const r = localCollapseMerge(s, { startFineIndex: 0, endFineIndex: 5 })
    expect(r.removed).toBe(5)
    expect(r.added).toBe(1)
    const rows = listJournalRows(s)
    expect(rows.some((x) => x.isAutoMerged)).toBe(true)
    expect(countFineJournalRows(s)).toBe(0)
    expect(rows[0].record.values['标记']).toBe(AUTO_MERGED_TAG)
  })

  it('applyMergeResult preserves remaining fine after merge window', () => {
    const s = seedFineRows(6)
    applyMergeResultToState(s, {
      startFineIndex: 0,
      endFineIndex: 4,
      mergedRows: [
        {
          编码索引: 'AM0001',
          概要: '合并段',
          纪要: '粗',
          标记: AUTO_MERGED_TAG,
        },
      ],
    })
    expect(countFineJournalRows(s)).toBe(2)
    expect(listJournalRows(s).filter((r) => r.isAutoMerged)).toHaveLength(1)
  })

  it('parseMergedJournalRows reads Memory block', () => {
    const rows = parseMergedJournalRows(`<Memory><!--
#纪要表
[AM0003]|概要：大战|纪要：双方议和|标记：auto_merged
--></Memory>`)
    expect(rows.length).toBe(1)
    expect(rows[0]['编码索引']).toBe('AM0003')
    expect(rows[0]['标记']).toBe(AUTO_MERGED_TAG)
  })
})

describe('index recall Top-K', () => {
  function seedJournal() {
    const s = createDefaultTableMemoryState()
    s.records['plot_journal'] = []
    for (let i = 1; i <= 30; i++) {
      s.records['plot_journal'].push({
        id: `j${i}`,
        values: {
          编码索引: `J${String(i).padStart(4, '0')}`,
          概要: i === 15 ? '赤焰谷求矿脉' : `事件${i}`,
          纪要: i === 15 ? '外敌压境索取灵矿' : `内容${i}`,
          地点: i === 15 ? '赤焰谷' : '山门',
          标记: '',
        },
      })
    }
    return s
  }

  it('buildJournalIndexText has 概要 and 编码', () => {
    const s = seedJournal()
    const text = buildJournalIndexText(s, { maxEntries: 50 })
    expect(text).toContain('纪要索引')
    expect(text).toContain('编码索引')
    expect(text).toContain('J0015')
  })

  it('selectJournalByKeyword picks related and caps at Top-K', () => {
    const s = seedJournal()
    const picked = selectJournalByKeyword(s, '赤焰谷 矿脉', 5)
    expect(picked.length).toBeLessThanOrEqual(5)
    expect(picked.some((r) => r.indexCode === 'J0015')).toBe(true)
  })

  it('parseRecallTag', () => {
    expect(parseRecallTag('<recall>J0001,J0002,AM0001</recall>')).toEqual([
      'J0001',
      'J0002',
      'AM0001',
    ])
  })

  it('formatTableMemoryInjection includes entity + index + recall', () => {
    const s = seedJournal()
    s.records['character_profile'] = [
      {
        id: 'c1',
        values: { 角色名: '陆承渊', 身份: '弟子', 当前位置: '山门' },
      },
    ]
    const inj = formatTableMemoryInjection({
      state: s,
      query: '赤焰谷',
      scheduler: { ...DEFAULT_TABLE_MEMORY_SCHEDULER, recallTopK: 5 },
    })
    expect(inj).toContain('实体表')
    expect(inj).toContain('纪要索引')
    expect(inj).toContain('召回纪要')
    // 不应只是无脑全表 3500 截断
    expect(inj.length).toBeGreaterThan(100)
  })
})

describe('maybeAppendJournalFromSum + injection path', () => {
  it('appends fine journal from sum', () => {
    const s = createDefaultTableMemoryState()
    expect(maybeAppendJournalFromSum(s, '本回收徒三人', 3)).toBe(true)
    expect(countFineJournalRows(s)).toBe(1)
    expect(listJournalRows(s)[0].indexCode).toMatch(/^J/)
  })

  it('formatWorldStateInjection uses bound injector when registered', () => {
    const s = createDefaultTableMemoryState()
    maybeAppendJournalFromSum(s, '试炼开启', 1)
    saveTableMemory(s)
    const inj = formatWorldStateInjection(loadTableMemory(), { query: '试炼' })
    expect(inj).toMatch(/实体表|当前世界状态|纪要/)
  })
})

describe('Memory tag → journal table', () => {
  it('applies #纪要表 rows', () => {
    const s = createDefaultTableMemoryState()
    const r = applyMemoryTextToState(
      s,
      `<Memory><!--
#纪要表
[J0099]|概要：结盟|地点：青石城|纪要：与赤焰谷暂盟
--></Memory>`,
    )
    expect(r.count).toBeGreaterThan(0)
    const rows = listJournalRows(s)
    expect(rows.some((x) => x.indexCode === 'J0099')).toBe(true)
  })
})
