/**
 * L3 可选：记忆图谱语义召回（embedding + cosine top-K）。
 * 默认关闭；失败静默，绝不阻断主路径。
 */
import Dexie, { type Table } from 'dexie'
import { normalizeBaseUrl } from '@/composables/api-cache'
import type { ApiSettings } from '@/sillytavern/types'

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
): Promise<number[][] | null> {
  const base = normalizeBaseUrl(api.baseUrl || '')
  const key = (api.apiKey || '').trim()
  if (!base || !key || !texts.length) return null

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
        model: (modelOverride || api.model || 'text-embedding-3-small').trim(),
        input: texts,
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    const arr = data?.data
    if (!Array.isArray(arr)) return null
    return arr.map((d: { embedding?: number[] }) => d.embedding as number[])
  } catch {
    return null
  }
}

export async function embedAndStoreBeats(
  api: ApiSettings,
  beats: Array<{ id: string; text: string; nodeName: string; year?: number; season?: string }>,
  modelOverride?: string,
): Promise<void> {
  if (!beats.length) return
  const texts = beats.map((b) => b.text)
  const vecs = await callEmbeddings(api, texts, modelOverride)
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

export async function semanticRecall(
  api: ApiSettings,
  query: string,
  topK = 6,
  modelOverride?: string,
): Promise<SemanticHit[]> {
  const q = String(query || '').trim()
  if (!q) return []
  const vecs = await callEmbeddings(api, [q], modelOverride)
  if (!vecs?.[0]?.length) return []
  const qv = vecs[0]
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
