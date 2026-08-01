import { afterEach, describe, expect, it, vi } from 'vitest'
import { embedAndStoreBeats, resolveEmbeddingEndpoint } from './memory-embed'
import type { ApiSettings, EmbeddingApiConfig } from '@/sillytavern/types'

const MAIN_API: ApiSettings = {
  baseUrl: 'https://main/v1',
  apiKey: 'k',
  model: 'deepseek-chat',
  timeout: 60000,
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('resolveEmbeddingEndpoint', () => {
  it('独立端点优先（三件套任一非空即启用）', () => {
    const emb: EmbeddingApiConfig = { baseUrl: 'https://emb/v1', apiKey: 'ek', model: 'em' }
    expect(resolveEmbeddingEndpoint(MAIN_API, emb)).toEqual({
      baseUrl: 'https://emb/v1',
      apiKey: 'ek',
      model: 'em',
    })
  })

  it('全空独立端点时回退主 API', () => {
    expect(resolveEmbeddingEndpoint(MAIN_API, undefined)).toEqual({
      baseUrl: 'https://main/v1',
      apiKey: 'k',
      model: 'deepseek-chat',
    })
  })

  it('主 API 无模型时给默认 embedding 模型', () => {
    const api: ApiSettings = { ...MAIN_API, model: '' }
    expect(resolveEmbeddingEndpoint(api, undefined)?.model).toBe('text-embedding-3-small')
  })

  it('modelOverride 优先', () => {
    expect(resolveEmbeddingEndpoint(MAIN_API, undefined, 'bge-m3')?.model).toBe('bge-m3')
  })

  it('缺 baseUrl 或 apiKey 返回 null', () => {
    expect(resolveEmbeddingEndpoint({ ...MAIN_API, apiKey: '' }, undefined)).toBeNull()
    expect(resolveEmbeddingEndpoint({ ...MAIN_API, baseUrl: '' }, undefined)).toBeNull()
  })
})

describe('embedAndStoreBeats', () => {
  it('无文本直接失败', async () => {
    const r = await embedAndStoreBeats(MAIN_API, [])
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('无文本')
  })

  it('请求构造正确（URL/模型/输入），IDB 写入失败时如实报告', async () => {
    const emb: EmbeddingApiConfig = { baseUrl: 'https://emb/v1', apiKey: 'ek', model: 'em' }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const r = await embedAndStoreBeats(
      MAIN_API,
      [
        { id: 'b1', text: '沈白突破筑基', nodeName: '沈白', year: 1, season: '春' },
        { id: 'b2', text: '苏沐雪抵达后山', nodeName: '苏沐雪' },
      ],
      undefined,
      emb,
    )

    // node 环境无 IndexedDB → 如实报告写入失败（不静默吞错）
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('IDB 写入失败')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://emb/v1/embeddings')
    expect((init.method || '').toUpperCase()).toBe('POST')
    const body = JSON.parse(String(init.body))
    expect(body.model).toBe('em')
    expect(body.input).toEqual(['沈白突破筑基', '苏沐雪抵达后山'])
  })

  it('HTTP 错误返回原因', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429 })
    vi.stubGlobal('fetch', fetchMock)
    const r = await embedAndStoreBeats(MAIN_API, [{ id: 'b1', text: 'x', nodeName: '沈白' }])
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('HTTP 429')
  })

  it('响应缺 data 数组返回原因', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ nope: 1 }) })
    vi.stubGlobal('fetch', fetchMock)
    const r = await embedAndStoreBeats(MAIN_API, [{ id: 'b1', text: 'x', nodeName: '沈白' }])
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('响应无 data 数组')
  })
})
