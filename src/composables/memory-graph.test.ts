import { describe, it, expect, beforeEach } from 'vitest'
import {
  applyMemoryGraphPatch,
  createEmptyMemoryGraph,
  getMemoryGraphSlice,
  selectMemoryGraphForTurn,
  projectCharacterProfilesToGraph,
  parseRelationField,
  loadMemoryGraph,
  saveMemoryGraph,
  clearMemoryGraph,
  matchNamesInText,
  removeMemoryGraphNodeByName,
  formatMemoryGraphSliceBrief,
} from './memory-graph'
import {
  createDefaultTableMemoryState,
  applyAssistantMemoryTags,
  clearTableMemory,
} from './table-memory'
// 绑定表格写入 → 图谱投影
import './memory-graph'

describe('parseRelationField', () => {
  it('parses braced relation segments', () => {
    const r = parseRelationField('{沈青岚}：〔师徒〕 · 〔敬重〕；{赤焰谷主}：〔敌对〕 · 〔戒备〕')
    expect(r.length).toBe(2)
    expect(r[0].target).toBe('沈青岚')
    expect(r[0].type).toBe('师徒')
    expect(r[1].target).toBe('赤焰谷主')
  })
})

describe('applyMemoryGraphPatch', () => {
  it('upserts nodes and edges', () => {
    let g = createEmptyMemoryGraph()
    g = applyMemoryGraphPatch(g, {
      nodes: [
        {
          name: '陆承渊',
          attrs: { 性格: '沉稳', 当前位置: '剑庐' },
          beat: '拜入青岚',
        },
      ],
      edges: [{ from: '陆承渊', to: '沈青岚', type: '师徒', note: '亲传' }],
    })
    expect(g.nodes.some((n) => n.name === '陆承渊')).toBe(true)
    expect(g.nodes.some((n) => n.name === '沈青岚')).toBe(true)
    expect(g.edges.length).toBe(1)
    expect(g.edges[0].type).toBe('师徒')
    const slice = getMemoryGraphSlice(g, '陆承渊')
    expect(slice.empty).toBe(false)
    expect(slice.edges[0].otherName).toBe('沈青岚')
    expect(slice.node?.beats[0]?.text).toBe('拜入青岚')
  })

  it('merges rename via formerName', () => {
    let g = createEmptyMemoryGraph()
    g = applyMemoryGraphPatch(g, {
      nodes: [{ name: '陆承渊', attrs: { 身份: '外门' } }],
    })
    g = applyMemoryGraphPatch(g, {
      nodes: [
        {
          name: '陆九',
          formerName: '陆承渊',
          attrs: { 身份: '内门' },
        },
      ],
    })
    expect(g.nodes.filter((n) => /陆/.test(n.name)).length).toBe(1)
    expect(findName(g, '陆九')?.attrs['身份']).toBe('内门')
  })
})

function findName(g: ReturnType<typeof createEmptyMemoryGraph>, name: string) {
  return g.nodes.find((n) => n.name === name)
}

describe('projectCharacterProfilesToGraph', () => {
  it('builds character/item/event nodes and edges from tables', () => {
    const tables = createDefaultTableMemoryState()
    tables.records['character_profile'] = [
      {
        id: 'r1',
        values: {
          角色名: '陆承渊',
          性格: '沉稳',
          当前位置: '山门',
          人际关系: '{沈青岚}：〔师徒〕 · 〔敬重〕',
          约定: '春试前不得下山',
        },
      },
    ]
    tables.records['item_tracking'] = [
      {
        id: 'i1',
        values: {
          物品名称: '玄铁令',
          持有者: '陆承渊',
          状态: '完好',
        },
      },
    ]
    tables.records['plot_journal'] = [
      {
        id: 'j1',
        values: {
          编码索引: 'J0001',
          概要: '陆承渊请命外出',
          地点: '议事厅',
          纪要: '陆承渊于议事厅请命，掌门沈青岚准其东行三日。',
        },
      },
    ]
    const g = projectCharacterProfilesToGraph(tables)
    expect(getMemoryGraphSlice(g, '陆承渊').empty).toBe(false)
    expect(g.edges.some((e) => e.type === '师徒')).toBe(true)
    expect(g.nodes.some((n) => n.kind === 'item' && n.name === '玄铁令')).toBe(true)
    expect(g.nodes.some((n) => n.kind === 'event')).toBe(true)
    expect(g.nodes.some((n) => n.kind === 'place' && n.name === '议事厅')).toBe(true)
  })
})

describe('Memory tag → graph projection (shipped path)', () => {
  beforeEach(() => {
    clearMemoryGraph()
    clearTableMemory()
  })

  it('applyAssistantMemoryTags projects character into graph', () => {
    const text = `<Memory><!--
#角色档案
[陆承渊]|性格：沉稳|当前位置：剑庐|人际关系：{沈青岚}：〔师徒〕 · 〔敬重〕|约定：春试前闭关
--></Memory>`
    const r = applyAssistantMemoryTags(text)
    expect(r.count).toBeGreaterThan(0)
    const g = loadMemoryGraph()
    const slice = getMemoryGraphSlice(g, '陆承渊')
    expect(slice.empty).toBe(false)
    expect(slice.node?.attrs['性格']).toBe('沉稳')
    expect(g.edges.some((e) => e.type === '师徒')).toBe(true)
    expect(formatMemoryGraphSliceBrief(slice)).toMatch(/沉稳|剑庐/)
  })
})

describe('selectMemoryGraphForTurn', () => {
  it('selects named nodes and stays within budget', () => {
    let g = createEmptyMemoryGraph()
    g = applyMemoryGraphPatch(g, {
      nodes: [
        { name: '陆承渊', attrs: { 性格: '沉稳' }, beat: '请命外出' },
        { name: '沈白', attrs: { 性格: '急躁' } },
      ],
      edges: [{ from: '陆承渊', to: '沈白', type: '结义', note: '共御外敌' }],
    })
    const r = selectMemoryGraphForTurn({
      graph: g,
      query: '召陆承渊议事',
      rosterNames: ['陆承渊', '沈白'],
      maxNodes: 4,
      maxChars: 1600,
    })
    expect(r.nodeCount).toBeGreaterThan(0)
    expect(r.text).toContain('叙事记忆图谱')
    expect(r.text).toContain('陆承渊')
    expect(r.text.length).toBeLessThanOrEqual(1600)
  })

  it('matchNamesInText ranks longer names', () => {
    const hits = matchNamesInText('陆承渊请见', ['陆', '陆承渊', '沈白'])
    expect(hits[0]).toBe('陆承渊')
  })
})

describe('persist memory graph', () => {
  beforeEach(() => {
    clearMemoryGraph()
  })

  it('load/save round-trip', () => {
    let g = createEmptyMemoryGraph()
    g = applyMemoryGraphPatch(g, {
      nodes: [{ name: '陆承渊', attrs: { 性格: '沉稳' } }],
    })
    saveMemoryGraph(g)
    const again = loadMemoryGraph()
    expect(again.nodes.some((n) => n.name === '陆承渊')).toBe(true)
  })

  it('removeMemoryGraphNodeByName drops node and edges', () => {
    let g = createEmptyMemoryGraph()
    g = applyMemoryGraphPatch(g, {
      nodes: [
        { name: '陆承渊', attrs: { 性格: '沉稳' } },
        { name: '沈白', attrs: { 性格: '急' } },
      ],
      edges: [{ from: '陆承渊', to: '沈白', type: '结义' }],
    })
    saveMemoryGraph(g)
    removeMemoryGraphNodeByName('陆承渊')
    const again = loadMemoryGraph()
    expect(again.nodes.some((n) => n.name === '陆承渊')).toBe(false)
    expect(again.edges.length).toBe(0)
    expect(again.nodes.some((n) => n.name === '沈白')).toBe(true)
  })
})
