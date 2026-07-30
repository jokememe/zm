import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearMemoryGraph,
  loadMemoryGraph,
  getMemoryGraphSlice,
} from './memory-graph'
import { summarizeTurnToBeats } from './memory-summary'
import type { ApiSettings } from '@/sillytavern/types'

const DUMMY_API: ApiSettings = {
  baseUrl: 'https://example.com/v1',
  apiKey: 'k',
  model: 'm',
  timeout: 1,
}
const SUMMARY_API = { baseUrl: 'https://mini/v1', apiKey: 'k', model: 'gemma' }

function mockFetchWith(content: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content } }],
    }),
  })
}

beforeEach(() => {
  clearMemoryGraph()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('summarizeTurnToBeats', () => {
  it('解析竖线格式并写入图谱（物品/地点/状态/关系）', async () => {
    const fetchMock = mockFetchWith(
      [
        '物品|沈白|获得|赤焰令',
        '地点|沈白|抵达|后山禁地',
        '状态|沈白|突破',
        '关系|沈白|道侣|苏沐雪',
      ].join('\n'),
    )
    vi.stubGlobal('fetch', fetchMock)

    const r = await summarizeTurnToBeats({
      body: '沈白取出赤焰令，踏入后山禁地，修为突破，与苏沐雪结为道侣。',
      rosterNames: ['沈白', '苏沐雪'],
      calendar: { year: 3, season: '春' },
      api: DUMMY_API,
      summaryApi: SUMMARY_API,
    })

    expect(r.beatCount).toBe(5) // 沈白 4 条（物品/地点/状态/关系）+ 苏沐雪 1 条（关系反向）
    expect(r.itemNodes).toBe(1)
    expect(r.placeNodes).toBe(1)
    expect(r.relationEdges).toBe(1)

    const g = loadMemoryGraph()
    const shen = g.nodes.find((n) => n.name === '沈白')
    const beatTexts = (shen?.beats || []).map((b) => b.text)
    expect(beatTexts).toContain('获得赤焰令')
    expect(beatTexts).toContain('抵达后山禁地')
    expect(beatTexts).toContain('突破')
    expect(beatTexts).toContain('道侣苏沐雪')

    const item = g.nodes.find((n) => n.name === '赤焰令')
    expect(item?.kind).toBe('item')
    expect(item?.attrs?.关联角色).toBe('沈白')

    const place = g.nodes.find((n) => n.name === '后山禁地')
    expect(place?.kind).toBe('place')

    const edge = g.edges.find((e) => e.type === '道侣')
    expect(edge).toBeTruthy()
  })

  it('忽略名册外的角色与过短正文', async () => {
    const fetchMock = mockFetchWith('物品|路人|获得|无名剑\n状态|沈白|受伤')
    vi.stubGlobal('fetch', fetchMock)

    const r = await summarizeTurnToBeats({
      body: '路人得到无名剑后悄然离去，而沈白却在刚才的激战中受伤倒地。',
      rosterNames: ['沈白'],
      api: DUMMY_API,
      summaryApi: SUMMARY_API,
    })

    expect(r.beatCount).toBe(1) // 只有 沈白 受伤
    expect(r.itemNodes).toBe(0)
  })

  it('无变化内容返回 0 beats 且不写库', async () => {
    const fetchMock = mockFetchWith('本文没有实体变化。')
    vi.stubGlobal('fetch', fetchMock)

    const r = await summarizeTurnToBeats({
      body: '掌门静静看着远方。',
      rosterNames: ['沈白'],
      api: DUMMY_API,
      summaryApi: SUMMARY_API,
    })
    expect(r.beatCount).toBe(0)
    expect(loadMemoryGraph().nodes.length).toBe(0)
  })

  it('接口 HTTP 失败抛出异常（由调用方回退正则）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      summarizeTurnToBeats({
        body: '在漫长的对峙之后，沈白终于突破了自己的瓶颈，修为大涨。',
        rosterNames: ['沈白'],
        api: DUMMY_API,
        summaryApi: SUMMARY_API,
      }),
    ).rejects.toThrow()
  })
})
