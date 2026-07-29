/**
 * L3 可选：记忆图谱语义召回（embedding + cosine top-K）。
 * 默认关闭；失败静默，绝不阻断主路径。
 */
import Dexie, { type Table } from 'dexie'
import { normalizeBaseUrl } from '@/composables/api-cache'
import type { ApiSettings, EmbeddingApiConfig } from '@/sillytavern/types'

interface EmbedRecord {
  id: string
  vec: number[]
  text: string
  nodeName: string
  year?: number
  season?: string
}

class EmbedDatabase extends Dexie {
  embeds!: Table<EmbedRecord>

  constructor() {
    super('zongmen-memory-embed')
    this.version(1).stores({
      embeds: 'id, nodeName, year',
    })
  }
}

let db: EmbedDatabase | null = null
function getDb(): EmbedDatabase {
  if (!db) db = new EmbedDatabase()
  return db
}

async function callEmbeddings(
  api: ApiSettings,
  texts: string[],
  modelOverride?: string,
  emb?: EmbeddingApiConfig,
): Promise<EmbedCallResult> {
  if (!texts.length) return { ok: false, reason: '无文本' }
  const resolved = resolveEmbeddingEndpoint(api, emb, modelOverride)
  if (!resolved) return { ok: false, reason: '未配置 baseUrl/apiKey' }
  const { baseUrl: base, apiKey: key, model } = resolved
  const url = `${base}/embeddings`
  const fetchUrl =
    typeof location !== 'undefined' && location.protocol === 'https:'
      ? `/api/proxy?target=${encodeURIComponent(url)}`
      : url

  try {
    const res = await fetch(fetchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        input: texts,
      }),
    })
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` }
    const data = await res.json()
    const arr = data?.data
    if (!Array.isArray(arr)) return { ok: false, reason: '响应无 data 数组' }
    const vec = arr.map((d: { embedding?: number[] }) => d.embedding as number[])
    return { ok: true, vec }
  } catch {
    return { ok: false, reason: '网络错误' }
  }
}

export async function embedAndStoreBeats(
  api: ApiSettings,
  beats: Array<{ id: string; text: string; nodeName: string; year?: number; season?: string }>,
  modelOverride?: string,
  emb?: EmbeddingApiConfig,
): Promise<EmbedCallResult> {
  if (!beats.length) return { ok: false, reason: '无文本' }
  const texts = beats.map((b) => b.text)
  const result = await callEmbeddings(api, texts, modelOverride, emb)
  if (!result.ok || !result.vec || result.vec.length !== beats.length) return result
  const vecs = result.vec
  try {
    const records: EmbedRecord[] = beats.map((b, i) => ({
      id: b.id,
      vec: vecs[i],
      text: b.text,
      nodeName: b.nodeName,
      year: b.year,
      season: b.season,
    }))
    await getDb().embeds.bulkPut(records)
    return { ok: true }
  } catch {
    return { ok: false, reason: 'IDB 写入失败' }
  }
}

export interface SemanticHit {
  beatId: string
  text: string
  nodeName: string
  score: number
  year?: number
  season?: string
}
/**
 * 调用结果：成功返回 vec，失败返回原因字符串（不再静默吞错）。
 * 调用方据此写回 AppSettings.embeddingStatus，让玩家看见失败。
 */
export interface EmbedCallResult {
  ok: boolean
  vec?: number[][]
  /** 失败原因：'未配置' | 'HTTP 400' | '网络错误' 等 */
  reason?: string
}

/** 解析出实际使用的端点与模型：独立配置优先，回退主 API */
export function resolveEmbeddingEndpoint(
  api: ApiSettings,
  emb?: EmbeddingApiConfig,
  modelOverride?: string,
): { baseUrl: string; apiKey: string; model: string } | null {
  const embBase = (emb?.baseUrl || '').trim()
  const embKey = (emb?.apiKey || '').trim()
  const embModel = (emb?.model || '').trim()
  const hasEmb = Boolean(embBase || embKey || embModel)
  const base = normalizeBaseUrl((hasEmb ? embBase : api.baseUrl) || '')
  const key = (hasEmb ? embKey : api.apiKey).trim()
  const model = (
    modelOverride ||
    (hasEmb ? embModel : api.model) ||
    'text-embedding-3-small'
  ).trim()
  if (!base || !key) return null
  return { baseUrl: base, apiKey: key, model }
}

export async function semanticRecall(
  api: ApiSettings,
  query: string,
  topK = 6,
  modelOverride?: string,
  emb?: EmbeddingApiConfig,
): Promise<SemanticHit[]> {
  const q = String(query || '').trim()
  if (!q) return []
  const result = await callEmbeddings(api, [q], modelOverride, emb)
  if (!result.ok || !result.vec?.[0]?.length) {
    // 失败原因经调用方写回 embeddingStatus（见 useTianji / system-lorebook）
    void result
    return []
  }
  const qv = result.vec[0]
  try {
    const records = await getDb().embeds.toArray()
    const scored = records.map((r) => ({
      beatId: r.id,
      text: r.text,
      nodeName: r.nodeName,
      score: cosine(qv, r.vec),
      year: r.year,
      season: r.season,
    }))
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, topK).filter((s) => s.score > 0.25)
  } catch {
    return []
  }
}

export async function clearEmbedStore(): Promise<void> {
  try {
    await getDb().embeds.clear()
  } catch {
    /* ignore */
  }
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}
