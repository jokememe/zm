import { describe, it, expect, beforeEach } from 'vitest'
import {
  appendArchiveBeats,
  clearMemoryArchive,
  formatArchiveFlashback,
  getArchiveCount,
  parseTimeHints,
  searchArchiveBeats,
} from './memory-archive'
import {
  applyMemoryGraphPatch,
  clearMemoryGraph,
  createEmptyMemoryGraph,
  selectMemoryGraphForTurn,
} from './memory-graph'

describe('memory-archive', () => {
  beforeEach(() => {
    clearMemoryArchive()
    clearMemoryGraph()
  })

  it('parseTimeHints: absolute year and N years ago', () => {
    expect(parseTimeHints('天元3845年剑庐', 3855).year).toBe(3845)
    const ago = parseTimeHints('三年前的约定', 3855)
    expect(ago.year).toBe(3852)
    expect(ago.hasTime).toBe(true)
  })

  it('keeps beats beyond hot window and flashbacks by clue', () => {
    let g = createEmptyMemoryGraph()
    // 写入超过热窗口条数
    for (let i = 0; i < 20; i++) {
      g = applyMemoryGraphPatch(g, {
        nodes: [
          {
            name: '陆承渊',
            beat: i === 0 ? '剑庐夜谈密议赤焰' : `近事流水${i}`,
            beatYear: 3845 + Math.floor(i / 5),
            beatSeason: '春',
          },
        ],
      })
    }
    expect(getArchiveCount()).toBeGreaterThanOrEqual(20)
    const node = g.nodes.find((n) => n.name === '陆承渊')
    expect(node?.beats.length).toBeLessThanOrEqual(16)
    // 最早「剑庐夜谈」应已不在热窗口（unshift 后被挤掉）
    const hotHas = node?.beats.some((b) => b.text.includes('剑庐夜谈'))
    expect(hotHas).toBe(false)

    const hits = searchArchiveBeats({
      query: '剑庐夜谈 陆承渊',
      nodeNames: ['陆承渊'],
      currentYear: 3855,
      topK: 5,
    })
    expect(hits.some((h) => h.text.includes('剑庐夜谈'))).toBe(true)

    const picked = selectMemoryGraphForTurn({
      graph: g,
      query: '想起剑庐夜谈与陆承渊',
      rosterNames: ['陆承渊'],
      maxNodes: 4,
      maxChars: 2000,
      currentYear: 3855,
      flashbackTopK: 6,
    })
    expect(picked.flashbackCount).toBeGreaterThan(0)
    expect(picked.text).toMatch(/旧事闪回|剑庐夜谈/)
  })

  it('no clue does not dump archive', () => {
    appendArchiveBeats([
      {
        id: 'b1',
        nodeId: 'n1',
        nodeName: '陆承渊',
        text: '秘密往事',
        at: 1,
        year: 3840,
      },
    ])
    const hits = searchArchiveBeats({
      query: '',
      topK: 10,
    })
    expect(hits.length).toBe(0)
    expect(formatArchiveFlashback(hits)).toBe('')
  })
})
