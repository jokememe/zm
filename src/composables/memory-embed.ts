/**
 * 记忆图谱语义召回 — embedding 向量存储 + cosine top-K。
 * 调用主 API 的 /v1/embeddings（极轻量，一句话 ~50 token）。
 * 向量存 IndexedDB（beat id → Float32Array），失败降级到关键词。
 */
import Dexie, { type Table } from 'dexie'
import { normalizeBaseUrl } from '@/composables/api-cache'
import type { ApiSettings } from '@/sillytavern/types'

// ========== IndexedDB 向量存储 ==========

interface EmbedRecord {
  id: string // beat id
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

// ========== Embedding API 调用 ==========

async function callEmbeddings(
  api: ApiSettings,
  texts: string[],
): Promise<number[][] | null> {
  const base = normalizeBaseUrl(api.baseUrl || '')
  const key = (api.apiKey || '').trim()
  if (!base || !key) return null

  const url = `${base}/embeddings`
  // 走代理（HTTPS 环境）
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
        model: api.model || 'text-embedding-3-small',
        input: texts,
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    const arr = data?.data
    if (!Array.isArray(arr)) return null
    return arr.map((d: any) => d.embedding as number[])
  } catch {
    return null
  }
}

// ========== 公共 API ==========

/**
 * 为一条 beat 生成 embedding 并存入 IDB。
 * 失败静默（降级到关键词召回）。
 */
export async function embedAndStoreBeat(
  api: ApiSettings,
  beat: { id: string; text: string; nodeName: string; year?: number; season?: string },
): Promise<void> {
  const vecs = await callEmbeddings(api, [beat.text])
  if (!vecs?.[0]?.length) return
  try {
    await getDb().embeds.put({
      id: beat.id,
      vec: vecs[0],
      text: beat.text,
      nodeName: beat.nodeName,
      year: beat.year,
      season: beat.season,
    })
  } catch {
    /* IDB 失败不影响主流程 */
  }
}

/**
 * 批量写入（ingestMemoryTag 后调用）。
 */
export async function embedAndStoreBeats(
  api: ApiSettings,
  beats: Array<{ id: string; text: string; nodeName: string; year?: number; season?: string }>,
): Promise<void> {
  if (!beats.length) return
  const texts = beats.map((b) => b.text)
  const vecs = await callEmbeddings(api, texts)
  if (!vecs || vecs.length !== beats.length) return
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
  } catch {
    /* ignore */
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
 * 语义召回 top-K。
 * @param query 用户输入 / 事务描述
 * @param topK 返回条数
 * @param yearRange 可选时间过滤 [minYear, maxYear]
 */
export async function semanticRecall(
  api: ApiSettings,
  query: string,
  topK = 6,
  yearRange?: [number, number],
): Promise<SemanticHit[]> {
  const vecs = await callEmbeddings(api, [query])
  if (!vecs?.[0]?.length) return []
  const qv = vecs[0]

  try {
    let records = await getDb().embeds.toArray()
    // 时间过滤
    if (yearRange) {
      const [minY, maxY] = yearRange
      records = records.filter((r) => r.year == null || (r.year >= minY && r.year <= maxY))
    }
    // cosine similarity
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

/** 清空向量库（开局/重置时） */
export async function clearEmbedStore(): Promise<void> {
  try {
    await getDb().embeds.clear()
  } catch {
    /* ignore */
  }
}

// ========== 工具 ==========

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
