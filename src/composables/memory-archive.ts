/**
 * 叙事近事冷档案（无限记忆底座）
 *
 * - 热图谱节点只保留最近 N 条 beats（近况窗口）
 * - 每一条 beat 同时落入本档案，不因热窗口被挤掉
 * - 检索：点名 / 关键词 / 年季 — 本地同步（内存镜像）；IndexedDB 异步持久
 */
import Dexie, { type Table } from 'dexie'

export interface ArchiveBeat {
  id: string
  nodeId: string
  nodeName: string
  text: string
  at: number
  year?: number
  season?: string
  /** 可选重要性 0–1，默认 0 */
  importance?: number
}

export interface ArchiveSearchInput {
  query: string
  /** 限制节点名（点名命中） */
  nodeNames?: string[]
  /** 历法年闭区间 */
  yearRange?: [number, number]
  /** 当前游戏年，用于「N年前」 */
  currentYear?: number
  topK?: number
  maxChars?: number
}

export interface ArchiveSearchHit extends ArchiveBeat {
  score: number
}

export interface ParsedTimeHint {
  /** 绝对年（若解析到） */
  year?: number
  yearRange?: [number, number]
  /** 季节词 */
  season?: string
  /** 是否从 query 解析出时间线索 */
  hasTime: boolean
}

class MemoryArchiveDatabase extends Dexie {
  beats!: Table<ArchiveBeat, string>

  constructor() {
    super('zongmen-memory-archive')
    this.version(1).stores({
      beats: 'id, nodeId, nodeName, year, at',
    })
  }
}

let db: MemoryArchiveDatabase | null = null
function getDb(): MemoryArchiveDatabase {
  if (!db) db = new MemoryArchiveDatabase()
  return db
}

/** 同步镜像：测试环境 / IDB 失败时仍可检索 */
let archiveMirror: ArchiveBeat[] = []
let hydratePromise: Promise<void> | null = null

function upsertMirror(beat: ArchiveBeat) {
  const i = archiveMirror.findIndex((b) => b.id === beat.id)
  if (i >= 0) archiveMirror[i] = beat
  else archiveMirror.push(beat)
}

export function getArchiveMirror(): ArchiveBeat[] {
  return archiveMirror
}

export function getArchiveCount(): number {
  return archiveMirror.length
}

/** 从 IndexedDB 灌入镜像（幂等） */
export async function hydrateMemoryArchive(): Promise<void> {
  if (!idbAvailable()) return
  if (hydratePromise) return hydratePromise
  hydratePromise = (async () => {
    try {
      const rows = await getDb().beats.toArray()
      if (rows.length) {
        const byId = new Map(archiveMirror.map((b) => [b.id, b]))
        for (const r of rows) byId.set(r.id, r)
        archiveMirror = [...byId.values()]
      }
    } catch {
      /* keep mirror */
    }
  })()
  try {
    await hydratePromise
  } finally {
    hydratePromise = null
  }
}

function idbAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}

function persistBeats(snapshot: ArchiveBeat[]): void {
  if (!snapshot.length || !idbAvailable()) return
  try {
    void getDb()
      .beats.bulkPut(snapshot)
      .catch(() => {})
  } catch {
    /* node/test: no IDB */
  }
}

/** 追加冷档案（同步写镜像 + 异步 IDB） */
export function appendArchiveBeats(beats: ArchiveBeat[]): void {
  if (!beats.length) return
  const snapshot: ArchiveBeat[] = []
  for (const b of beats) {
    if (!b.id || !b.text?.trim()) continue
    const row: ArchiveBeat = {
      id: b.id,
      nodeId: b.nodeId || '',
      nodeName: String(b.nodeName || '').trim() || '未名',
      text: String(b.text).trim(),
      at: typeof b.at === 'number' ? b.at : Date.now(),
      year: typeof b.year === 'number' ? b.year : undefined,
      season: b.season != null ? String(b.season) : undefined,
      importance:
        typeof b.importance === 'number' && Number.isFinite(b.importance)
          ? b.importance
          : 0,
    }
    upsertMirror(row)
    snapshot.push(row)
  }
  persistBeats(snapshot)
}

export function clearMemoryArchive(): void {
  archiveMirror = []
  if (!idbAvailable()) return
  try {
    void getDb()
      .beats.clear()
      .catch(() => {})
  } catch {
    /* ignore */
  }
}

export function removeArchiveBeatsByNodeId(nodeId: string): void {
  if (!nodeId) return
  archiveMirror = archiveMirror.filter((b) => b.nodeId !== nodeId)
  if (!idbAvailable()) return
  try {
    void getDb()
      .beats.where('nodeId')
      .equals(nodeId)
      .delete()
      .catch(() => {})
  } catch {
    /* ignore */
  }
}

export function removeArchiveBeatsByNodeName(nodeName: string): void {
  const key = String(nodeName || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
  if (!key) return
  archiveMirror = archiveMirror.filter(
    (b) =>
      String(b.nodeName || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '') !== key,
  )
  if (!idbAvailable()) return
  try {
    void getDb()
      .beats.where('nodeName')
      .equals(nodeName)
      .delete()
      .catch(() => {})
  } catch {
    /* ignore */
  }
}

const CN_NUM: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
}

/** 解析「三」「十二」「10」等为数字 */
export function parseCountToken(raw: string): number | null {
  const s = String(raw || '').trim()
  if (!s) return null
  if (/^\d+$/.test(s)) return Number(s)
  if (s === '十') return 10
  if (s.length === 1 && CN_NUM[s] != null) return CN_NUM[s]
  // 十二、二十、二十三
  if (s.startsWith('十') && s.length === 2 && CN_NUM[s[1]] != null) {
    return 10 + CN_NUM[s[1]]
  }
  if (s.endsWith('十') && s.length === 2 && CN_NUM[s[0]] != null) {
    return CN_NUM[s[0]] * 10
  }
  if (s.length === 3 && s[1] === '十' && CN_NUM[s[0]] != null && CN_NUM[s[2]] != null) {
    return CN_NUM[s[0]] * 10 + CN_NUM[s[2]]
  }
  return null
}

/** 解析 query 中的时间线索 */
export function parseTimeHints(
  query: string,
  currentYear?: number,
): ParsedTimeHint {
  const q = String(query || '')
  let year: number | undefined
  let yearRange: [number, number] | undefined
  let season: string | undefined
  let hasTime = false

  const abs = q.match(/(?:天元\s*)?(\d{3,5})\s*年/)
  if (abs) {
    year = Number(abs[1])
    yearRange = [year - 1, year + 1]
    hasTime = true
  }

  const ago = q.match(/([一二两三四五六七八九十\d]{1,3})\s*年\s*前/)
  if (ago && typeof currentYear === 'number' && Number.isFinite(currentYear)) {
    const n = parseCountToken(ago[1])
    if (n != null && n > 0) {
      const y = currentYear - n
      year = y
      yearRange = [y - 1, y + 1]
      hasTime = true
    }
  }

  if (/当年|那时|昔年|那年|昔日|从前|往年/.test(q)) {
    hasTime = true
    // 无绝对年：不硬过滤，仅在打分时给「非最近」旧事轻微加分（由调用方用 hasTime）
  }

  const seasonM = q.match(/(春|夏|秋|冬)(?:季|日|天)?/)
  if (seasonM) {
    season = seasonM[1]
    hasTime = true
  }

  return { year, yearRange, season, hasTime }
}

function tokenize(q: string): string[] {
  return String(q || '')
    .split(/[\s,，。；;、|！？!?\n\r「」『』《》【】（）()]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .slice(0, 16)
}

/**
 * 本地检索冷档案。无任何线索（无点名、无 token、无时间）时返回空，避免无端闪回。
 */
export function searchArchiveBeats(input: ArchiveSearchInput): ArchiveSearchHit[] {
  const topK = Math.max(1, input.topK ?? 8)
  const q = String(input.query || '').trim()
  const tokens = tokenize(q)
  const nameKeys = new Set(
    (input.nodeNames || [])
      .map((n) =>
        String(n || '')
          .trim()
          .toLowerCase()
          .replace(/\s+/g, ''),
      )
      .filter(Boolean),
  )

  const hints = parseTimeHints(q, input.currentYear)
  const yearRange = input.yearRange || hints.yearRange

  // 无线索：不扫库
  if (!nameKeys.size && !tokens.length && !hints.hasTime && !yearRange) {
    return []
  }

  let pool = archiveMirror
  if (nameKeys.size) {
    const named = pool.filter((b) =>
      nameKeys.has(
        String(b.nodeName || '')
          .trim()
          .toLowerCase()
          .replace(/\s+/g, ''),
      ),
    )
    // 有点名时优先该子集；若该节点尚无档案则回退全库关键词
    if (named.length) pool = named
  }

  if (yearRange) {
    const [minY, maxY] = yearRange
    const filtered = pool.filter(
      (b) => b.year == null || (b.year >= minY && b.year <= maxY),
    )
    if (filtered.length) pool = filtered
  }

  const scored: ArchiveSearchHit[] = []
  for (const b of pool) {
    let score = 0
    const nameKey = String(b.nodeName || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '')
    if (nameKeys.has(nameKey)) score += 12

    const hay = `${b.nodeName} ${b.text}`.toLowerCase()
    for (const t of tokens) {
      if (hay.includes(t.toLowerCase())) score += Math.min(8, t.length)
    }

    if (yearRange && b.year != null) {
      const [minY, maxY] = yearRange
      if (b.year >= minY && b.year <= maxY) score += 10
    } else if (hints.hasTime && b.year != null && input.currentYear != null) {
      // 「当年」类：越旧略加分（有时间话头时）
      const age = input.currentYear - b.year
      if (age >= 2) score += Math.min(6, age)
    }

    if (hints.season && b.season && String(b.season).includes(hints.season)) {
      score += 4
    }

    if (b.importance) score += b.importance * 3

    // 仅有点名、token 全未命中：仍给点名基础分，保留该节点旧事
    if (score > 0) {
      scored.push({ ...b, score })
    }
  }

  scored.sort((a, b) => b.score - a.score || (b.at || 0) - (a.at || 0))
  return scored.slice(0, topK)
}

/** 格式化旧事闪回块 */
export function formatArchiveFlashback(
  hits: ArchiveSearchHit[],
  maxChars = 1000,
): string {
  if (!hits.length) return ''
  const lines = ['## 旧事闪回', '（全库检索 · 仅作背景，勿整段复述）']
  for (const h of hits) {
    const cal =
      h.year != null ? `${h.year}年${h.season || ''}` : h.season || ''
    const head = cal ? `${h.nodeName}（${cal}）` : h.nodeName
    lines.push(`· ${head}：${h.text}`)
  }
  let text = lines.join('\n')
  if (text.length > maxChars) {
    text = text.slice(0, maxChars - 1) + '…'
  }
  return text
}

/** 导出备份用 */
export async function exportArchiveBeats(): Promise<ArchiveBeat[]> {
  await hydrateMemoryArchive()
  return [...archiveMirror]
}

/** 导入备份 */
export async function importArchiveBeats(rows: ArchiveBeat[]): Promise<number> {
  if (!Array.isArray(rows) || !rows.length) return 0
  const clean = rows
    .filter((b) => b && b.id && b.text)
    .map((b) => ({
      id: String(b.id),
      nodeId: String(b.nodeId || ''),
      nodeName: String(b.nodeName || '未名'),
      text: String(b.text),
      at: Number(b.at) || Date.now(),
      year: typeof b.year === 'number' ? b.year : undefined,
      season: b.season != null ? String(b.season) : undefined,
      importance: typeof b.importance === 'number' ? b.importance : 0,
    }))
  archiveMirror = clean
  if (!idbAvailable()) return clean.length
  try {
    await getDb().beats.clear()
    await getDb().beats.bulkPut(clean)
  } catch {
    /* mirror ok */
  }
  return clean.length
}
