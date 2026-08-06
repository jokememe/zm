import { describe, it, expect, vi } from 'vitest'
import {
  buildRecallCatalog,
  formatLlmRecallBlock,
  parseLlmRecallOutput,
  runLlmRecall,
  shouldTriggerLlmRecall,
  validateLlmRecallPicks,
} from './memory-llm-recall'
import { applyMemoryGraphPatch, createEmptyMemoryGraph } from './memory-graph'
import type { ArchiveBeat } from './memory-archive'
import type { ApiSettings } from '@/sillytavern/types'

vi.mock('@/sillytavern/api-tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/sillytavern/api-tools')>()
  return {
    ...actual,
    postChatCompletion: vi.fn(async () => ({
      ok: true,
      data: { choices: [{ message: { content: '[{"node":"陆承渊","reason":"点名"}]' } }] },
      usedUrl: 'https://x/v1/chat/completions',
      hadReasoning: false,
    })),
  }
})

const API: ApiSettings = { baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', timeout: 60000 }

function graphWith(name: string) {
  let g = createEmptyMemoryGraph()
  g = applyMemoryGraphPatch(g, { nodes: [{ name, beat: '近事甲' }] })
  return g
}

describe('shouldTriggerLlmRecall', () => {
  it('0 命中必触发', () => {
    expect(shouldTriggerLlmRecall('随便问问', { nodeCount: 0, flashbackCount: 0 })).toBe(true)
  })
  it('点名命中且无旧事话头不触发', () => {
    expect(shouldTriggerLlmRecall('陆承渊去哪了', { nodeCount: 1, flashbackCount: 0 })).toBe(false)
  })
  it('命中少且带旧事/模糊话头触发', () => {
    expect(shouldTriggerLlmRecall('三年前的约定是谁', { nodeCount: 1, flashbackCount: 0 })).toBe(true)
    expect(shouldTriggerLlmRecall('还记得当年那桩恩怨吗', { nodeCount: 2, flashbackCount: 1 })).toBe(true)
  })
  it('空查询不触发', () => {
    expect(shouldTriggerLlmRecall('', { nodeCount: 0, flashbackCount: 0 })).toBe(false)
  })
})

describe('parseLlmRecallOutput', () => {
  it('解析 JSON 数组', () => {
    const picks = parseLlmRecallOutput('[{"node":"陆承渊","reason":"r"},{"beat":"b_1"}]')
    expect(picks).toEqual([
      { node: '陆承渊', reason: 'r' },
      { beat: 'b_1', reason: undefined },
    ])
  })
  it('容忍代码块包裹', () => {
    const picks = parseLlmRecallOutput('```json\n[{"node":"沈白"}]\n```')
    expect(picks[0]?.node).toBe('沈白')
  })
  it('JSON 失败回退行式', () => {
    const picks = parseLlmRecallOutput('陆承渊|旧事相关\nb_123|档案条目')
    expect(picks[0]).toEqual({ node: '陆承渊', reason: '旧事相关' })
    expect(picks[1]).toEqual({ beat: 'b_123', reason: '档案条目' })
  })
  it('非法/空返回空数组', () => {
    expect(parseLlmRecallOutput('')).toEqual([])
    expect(parseLlmRecallOutput('没有匹配')).toEqual([])
  })
})

describe('validateLlmRecallPicks', () => {
  it('只保留图谱真实人物与档案真实条目', () => {
    const g = graphWith('陆承渊')
    const archive: ArchiveBeat[] = [
      { id: 'b_1', nodeId: 'n1', nodeName: '陆承渊', text: '剑庐夜谈', at: 1 },
    ]
    const { nodes, beats } = validateLlmRecallPicks(
      [
        { node: '陆承渊' },
        { node: '虚构人物' },
        { beat: 'b_1' },
        { beat: 'b_nope' },
      ],
      g,
      archive,
    )
    expect(nodes).toEqual(['陆承渊'])
    expect(beats.map((b) => b.id)).toEqual(['b_1'])
  })
})

describe('buildRecallCatalog', () => {
  it('包含图谱目录与长线摘要', () => {
    const g = graphWith('陆承渊')
    const text = buildRecallCatalog({ graph: g, bank: { short: [], mid: '', long: ['【开局】测试'], turn: 1 }, maxChars: 800 })
    expect(text).toContain('人物图谱目录')
    expect(text).toContain('陆承渊')
    expect(text).toContain('长线大事')
    expect(text.length).toBeLessThanOrEqual(800)
  })
})

describe('formatLlmRecallBlock', () => {
  it('格式化人物与旧事（原文回源）', () => {
    const g = graphWith('陆承渊')
    const archive: ArchiveBeat[] = [
      { id: 'b_1', nodeId: 'n1', nodeName: '陆承渊', text: '剑庐夜谈密议赤焰', at: 1, year: 3845, season: '春' },
    ]
    const text = formatLlmRecallBlock(['陆承渊'], archive, g, 600)
    expect(text).toContain('## LLM 召回')
    expect(text).toContain('陆承渊')
    expect(text).toContain('剑庐夜谈密议赤焰')
    expect(text).toContain('3845年春')
    expect(text.length).toBeLessThanOrEqual(600)
  })
})

describe('runLlmRecall', () => {
  it('走 postChatCompletion 并回源校验', async () => {
    const g = graphWith('陆承渊')
    const res = await runLlmRecall({ api: API, query: '陆承渊', graph: g })
    expect(res.ok).toBe(true)
    expect(res.nodes).toEqual(['陆承渊'])
  })
  it('主 API 未配置时返回原因（不抛）', async () => {
    const res = await runLlmRecall({
      api: { baseUrl: '', apiKey: '', model: '', timeout: 60000 },
      query: 'x',
      graph: createEmptyMemoryGraph(),
    })
    expect(res.ok).toBe(false)
    expect(res.reason).toContain('主 API 未配置')
  })
})
