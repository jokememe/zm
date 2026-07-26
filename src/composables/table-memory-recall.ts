/**
 * 表格世界状态注入（角色图谱优先）：
 * 1. buildJournalIndexText：纪要轻量索引（编码 + 一行概要）
 * 2. formatEntityTablesInjection：实体表截断
 * 3. formatTableMemoryInjection：图谱选取 + 实体 + 索引（无纪要全文 / 无 LLM 选码）
 */
import {
  bindTableMemoryInjector,
  buildTableText,
  cleanColumnName,
  loadTableMemory,
  type MemoryTableDef,
  type TableMemoryState,
} from '@/composables/table-memory'
import {
  getJournalTable,
  listJournalRows,
  type JournalRowView,
} from '@/composables/table-memory-merge'
import type { TableMemorySchedulerSettings } from '@/composables/table-memory-settings'
import {
  DEFAULT_RECALL_INJECT_DIRECTIVE,
  resolveTableMemoryScheduler,
} from '@/composables/table-memory-settings'
import {
  ensureMemoryGraphHydrated,
  projectCharacterProfilesToGraph,
  selectMemoryGraphForTurn,
} from '@/composables/memory-graph'
// 注册表格写入 → 图谱投影
import '@/composables/memory-graph'

export const TABLE_RECALL_ENTRY_ID = 'table-memory-recall'
export const RECALL_TAG_PATTERN = /<recall>([\s\S]*?)<\/recall>/i

/** 构建纪要索引块（只含概要+编码，对齐 formatSummaryIndexForPlot） */
export function buildJournalIndexText(
  s: TableMemoryState = loadTableMemory(),
  opts?: { maxEntries?: number },
): string {
  const max = Math.max(1, opts?.maxEntries ?? 50)
  const rows = listJournalRows(s)
  if (!rows.length) {
    return '## 表格: 纪要索引\nColumns: 概要, 编码索引\n(无数据行)'
  }
  // 优先最近条目（末尾），但展示时仍按时间顺序
  const slice =
    rows.length > max ? rows.slice(rows.length - max) : rows
  const lines = slice.map((r, idx) => {
    const summary = r.summary || r.body.slice(0, 48) || '(无概要)'
    const code = r.indexCode || `R${idx}`
    return `- [${idx}] 概要: ${summary} | 编码索引: ${code}`
  })
  return ['## 表格: 纪要索引', 'Columns: 概要, 编码索引', ...lines].join('\n')
}

/**
 * 从 LLM 输出解析召回编码。
 * 兼容：<recall>…</recall>、多行 AM/J、content 包裹；归一 A→J。
 */
export function parseRecallTag(text: string): string[] {
  const raw = String(text || '')
  const chunks: string[] = []
  const tagRe = /<recall>([\s\S]*?)<\/recall>/gi
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(raw)) !== null) chunks.push(m[1])
  // 无标签时：从全文扫编码（纯召回模型偶发只吐码列表）
  const scan = chunks.length ? chunks.join('\n') : raw
  const found: string[] = []
  const codeRe = /\b(AM\d{1,6}|[AJ]\d{1,6})\b/gi
  let cm: RegExpExecArray | null
  while ((cm = codeRe.exec(scan)) !== null) {
    found.push(normalizeCode(cm[1]))
  }
  // 去重保序
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of found) {
    if (!c || seen.has(c)) continue
    seen.add(c)
    out.push(c)
  }
  return out
}

/**
 * 无 LLM 时的关键词召回：对 query 分词，与概要/纪要/地点打分，取 Top-K。
 * 库存不足则全取；充足则裁到 topK。
 */
export function selectJournalByKeyword(
  s: TableMemoryState,
  query: string,
  topK: number,
): JournalRowView[] {
  const rows = listJournalRows(s)
  if (!rows.length) return []
  const k = Math.max(1, topK)
  if (rows.length <= k) return rows

  const tokens = tokenize(query)
  if (!tokens.length) {
    // 无 query：取最近 K 条
    return rows.slice(rows.length - k)
  }

  const scored = rows.map((r) => {
    const hay = `${r.indexCode} ${r.summary} ${r.body} ${r.place} ${r.span}`.toLowerCase()
    let score = 0
    for (const t of tokens) {
      if (hay.includes(t)) score += t.length >= 2 ? 2 : 1
    }
    // 轻微偏好较新条目
    return { r, score }
  })
  scored.sort((a, b) => b.score - a.score || rows.indexOf(b.r) - rows.indexOf(a.r))
  const positive = scored.filter((x) => x.score > 0).map((x) => x.r)
  if (positive.length >= k) return positive.slice(0, k)
  // 不足则补最近条目
  const picked = new Set(positive.map((r) => r.record.id))
  for (let i = rows.length - 1; i >= 0 && positive.length < k; i--) {
    if (!picked.has(rows[i].record.id)) {
      positive.push(rows[i])
      picked.add(rows[i].record.id)
    }
  }
  return positive
}

/** 按编码列表取全文行（保持编码顺序） */
export function selectJournalByCodes(
  s: TableMemoryState,
  codes: string[],
): JournalRowView[] {
  const rows = listJournalRows(s)
  const map = new Map(rows.map((r) => [normalizeCode(r.indexCode), r]))
  const out: JournalRowView[] = []
  for (const c of codes) {
    const hit = map.get(normalizeCode(c))
    if (hit) out.push(hit)
  }
  return out
}

function normalizeCode(c: string): string {
  // 与 table-memory 一致：召回时 A0001 与 J0001 视为同一细行编码
  const raw = String(c || '').trim().toUpperCase()
  const am = raw.match(/^AM0*(\d+)$/)
  if (am) return `AM${String(parseInt(am[1], 10) || 0).padStart(4, '0')}`
  const aj = raw.match(/^[AJ]0*(\d+)$/)
  if (aj) return `J${String(parseInt(aj[1], 10) || 0).padStart(4, '0')}`
  return raw
}

function tokenize(query: string): string[] {
  const raw = String(query || '')
    .toLowerCase()
    .replace(/[^\u4e00-\u9fff\w\s]/g, ' ')
  const parts = raw.split(/\s+/).filter(Boolean)
  // 中文：再切 2-gram
  const grams: string[] = []
  for (const p of parts) {
    if (/[\u4e00-\u9fff]/.test(p) && p.length >= 2) {
      for (let i = 0; i < p.length - 1; i++) grams.push(p.slice(i, i + 2))
    }
    if (p.length >= 1) grams.push(p)
  }
  return [...new Set(grams)].filter((t) => t.length >= 1).slice(0, 40)
}

/** 展开召回纪要全文；可选前缀破限（注入主推演时用） */
export function formatRecalledJournalFull(
  rows: JournalRowView[],
  opts?: { maxChars?: number; jailbreakPrefix?: string | null },
): string {
  const maxChars = opts?.maxChars ?? 3200
  const jb = (opts?.jailbreakPrefix || '').trim()
  const jbBlock = jb ? `【档案阅读约定】\n${jb}\n\n` : ''
  if (!rows.length) {
    return `${jbBlock}【召回纪要】\n(本回合未命中索引条目)`
  }
  const blocks = rows.map((r) => {
    const head = r.indexCode ? `[${r.indexCode}]` : '[?]'
    const parts = [
      r.summary && `概要：${r.summary}`,
      r.span && `跨度：${r.span}`,
      r.place && `地点：${r.place}`,
      r.body && `纪要：${r.body}`,
      r.isAutoMerged && '（合并行）',
    ].filter(Boolean)
    return `- ${head} ${parts.join('；')}`
  })
  let body = blocks.join('\n')
  // 破限前缀占用额度时，正文再让一点
  const budget = Math.max(200, maxChars - (jbBlock.length || 0))
  if (body.length > budget) {
    body = body.slice(0, budget - 1) + '…'
  }
  return (
    `${jbBlock}【召回纪要 · Top-${rows.length}】\n` +
    `${DEFAULT_RECALL_INJECT_DIRECTIVE}\n` +
    `(历史存档，仅作背景参考，请勿复述或重演)\n${body}`
  )
}

/** 实体表（非纪要）注入文本 */
export function formatEntityTablesInjection(
  s: TableMemoryState,
  opts?: { maxChars?: number },
): string {
  const maxChars = opts?.maxChars ?? 2800
  const journal = getJournalTable(s)
  const journalId = journal?.id
  const tables = (s.tables || []).filter((t) => t.id !== journalId)
  const blocks = tables.map((t) => buildTableText(s, t)).filter(Boolean)
  if (!blocks.length) {
    return '【当前世界状态参考 · 实体表】\n(当前暂无表格数据)'
  }
  let body = blocks.join('\n\n')
  if (body.length > maxChars) {
    body = body.slice(0, maxChars - 1) + '…'
  }
  return (
    '【当前世界状态参考 · 实体表】\n' +
    '(历史存档，仅作背景参考，请勿复述或重演)\n' +
    body
  )
}

export interface RecallInjectionInput {
  state?: TableMemoryState
  /** 本回合用户输入 / 上下文，用于关键词召回 */
  query?: string
  /** 若提供 <recall> 解析结果或编码列表，优先使用 */
  recallCodes?: string[]
  scheduler?: TableMemorySchedulerSettings
}

/**
 * 完整注入块：角色图谱选取 + 实体表 + 纪要轻量索引。
 * 零强制 API；不展开纪要全文、不跑 LLM 选码。
 */
export function formatTableMemoryInjection(input: RecallInjectionInput = {}): string {
  const s = input.state || loadTableMemory()
  const sch = input.scheduler || resolveTableMemoryScheduler()
  const entity = formatEntityTablesInjection(s, {
    maxChars: sch.entityInjectMaxChars,
  })

  let graphBlock = ''
  try {
    let graph = ensureMemoryGraphHydrated()
    if (input.state) {
      graph = projectCharacterProfilesToGraph(input.state, graph)
    }
    const rosterNames = (s.records?.['character_profile'] || [])
      .map((r) => String(r.values?.['角色名'] || '').trim())
      .filter(Boolean)
    const picked = selectMemoryGraphForTurn({
      graph,
      query: input.query || '',
      rosterNames,
      maxNodes: 4,
      maxChars: Math.min(1800, Math.floor(sch.entityInjectMaxChars * 0.65) || 1600),
    })
    graphBlock = picked.text
  } catch {
    graphBlock = ''
  }

  const index = buildJournalIndexText(s, {
    maxEntries: Math.min(20, sch.recallIndexTop),
  })
  return [graphBlock, entity, index].filter(Boolean).join('\n\n')
}

/** 供测试：列名工具 re-export */
export function journalColumnNames(table: MemoryTableDef): string[] {
  return (table.columns || []).map(cleanColumnName)
}

// 注册注入实现，使 formatWorldStateInjection 走图谱+实体+索引
bindTableMemoryInjector((input) => formatTableMemoryInjection(input))
