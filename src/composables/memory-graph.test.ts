import { describe, it, expect, beforeEach } from 'vitest'
import {
  applyMemoryGraphPatch,
  createEmptyMemoryGraph,
  getMemoryGraphSlice,
  selectMemoryGraphForTurn,
  loadMemoryGraph,
  saveMemoryGraph,
  clearMemoryGraph,
  matchNamesInText,
  removeMemoryGraphNodeByName,
  renameMemoryGraphNode,
  formatMemoryGraphSliceBrief,
  ingestMemoryTag,
} from './memory-graph'

function findName(g: ReturnType<typeof createEmptyMemoryGraph>, name: string) {
  return g.nodes.find((n) => n.name === name)
}

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

describe('ingestMemoryTag (shipped growth path)', () => {
  beforeEach(() => {
    clearMemoryGraph()
  })

  it('grows character node + beat + relation edge from <memory> tag', () => {
    const newBeats = ingestMemoryTag(
      '陆承渊|拜入青岚宗|与沈青岚：师徒\n沈青岚|收陆承渊为徒',
      { year: 3, season: '春' },
    )
    expect(newBeats.length).toBeGreaterThan(0)
    const g = loadMemoryGraph()
    const slice = getMemoryGraphSlice(g, '陆承渊')
    expect(slice.empty).toBe(false)
    expect(slice.node?.beats[0]?.text).toBe('拜入青岚宗')
    expect(g.edges.some((e) => e.type === '师徒')).toBe(true)
    expect(formatMemoryGraphSliceBrief(slice)).toMatch(/陆承渊|青岚/)
  })

  it('does not duplicate identical beats', () => {
    ingestMemoryTag('陆承渊|闭关破境')
    ingestMemoryTag('陆承渊|闭关破境')
    const g = loadMemoryGraph()
    const node = findName(g, '陆承渊')!
    expect(node.beats.filter((b) => b.text === '闭关破境').length).toBe(1)
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

  it('matches event/place by keyword in attrs and includes non-character', () => {
    let g = createEmptyMemoryGraph()
    g = applyMemoryGraphPatch(g, {
      nodes: [
        {
          name: '事件·J01·剑庐夜谈',
          kind: 'event',
          attrs: { 概要: '剑庐夜谈议外敌', 地点: '剑庐' },
          beat: '密议赤焰',
        },
        { name: '剑庐', kind: 'place', attrs: { 类型: '地点' } },
        { name: '赤焰令', kind: 'item', attrs: { 持有者: '陆承渊' } },
      ],
      edges: [
        { from: '事件·J01·剑庐夜谈', to: '剑庐', type: '其他', note: '发生地' },
        { from: '陆承渊', to: '赤焰令', type: '其他', note: '持有' },
      ],
    })
    const r = selectMemoryGraphForTurn({
      graph: g,
      query: '剑庐夜谈 赤焰',
      maxNodes: 4,
      maxChars: 1600,
    })
    expect(r.nodeCount).toBeGreaterThan(0)
    expect(r.text).toMatch(/剑庐|赤焰|事件/)
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

describe('renameMemoryGraphNode', () => {
  beforeEach(() => {
    clearMemoryGraph()
  })

  it('renames node in place: beats / attrs / edges survive, old name gone', () => {
    let g = createEmptyMemoryGraph()
    g = applyMemoryGraphPatch(g, {
      nodes: [
        { name: '沈青岚', attrs: { 身份: '掌门' }, beat: '继任掌门' },
        { name: '陆承渊', attrs: { 性格: '沉稳' } },
      ],
      edges: [{ from: '陆承渊', to: '沈青岚', type: '师徒', note: '亲传' }],
    })
    saveMemoryGraph(g)

    const ok = renameMemoryGraphNode('沈青岚', '沈照临')
    expect(ok).toBe(true)

    const again = loadMemoryGraph()
    expect(again.nodes.some((n) => n.name === '沈青岚')).toBe(false)
    const renamed = findName(again, '沈照临')!
    expect(renamed).toBeTruthy()
    expect(renamed.attrs['身份']).toBe('掌门')
    expect(renamed.beats[0]?.text).toBe('继任掌门')
    // 边按 node.id 关联，改名不断边；切片显示对端为新名
    const slice = getMemoryGraphSlice(again, '陆承渊')
    expect(slice.edges.length).toBe(1)
    expect(slice.edges[0].otherName).toBe('沈照临')
  })

  it('returns false when old node missing or names equal', () => {
    saveMemoryGraph(createEmptyMemoryGraph())
    expect(renameMemoryGraphNode('不存在', '新名')).toBe(false)
    let g = createEmptyMemoryGraph()
    g = applyMemoryGraphPatch(g, { nodes: [{ name: '陆承渊' }] })
    saveMemoryGraph(g)
    expect(renameMemoryGraphNode('陆承渊', '陆承渊')).toBe(false)
    expect(renameMemoryGraphNode('陆承渊', '')).toBe(false)
    // 节点未被误改
    expect(findName(loadMemoryGraph(), '陆承渊')).toBeTruthy()
  })
})
