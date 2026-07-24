/**
 * 索引 / Top-K 召回注入 — 对齐 shujuku 纪要索引 + <recall> Top-K。
 *
 * 流程：
 * 1. buildJournalIndexText：把纪要表压成「概要 + 编码索引」轻量索引（最多 indexTop 条）
 * 2. selectJournalByKeyword / parseRecallTag：从 query 或 <recall> 标签选出 Top-K 编码
 * 3. formatRecalledJournalFull：按编码展开全文纪要
 * 4. formatTableMemoryInjection：实体表（截断）+ 索引 + 召回全文
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
  DEFAULT_RECALL_SYSTEM_PROMPT,
  DEFAULT_RECALL_USER_TEMPLATE,
  resolveTableMemoryScheduler,
} from '@/composables/table-memory-settings'

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

/** 从 LLM 输出解析 <recall>A001,A002</recall> */
export function parseRecallTag(text: string): string[] {
  const m = String(text || '').match(RECALL_TAG_PATTERN)
  if (!m) return []
  return String(m[1] || '')
    .split(/[,，\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
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
  return String(c || '').trim().toUpperCase()
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
 * 完整注入块：实体表 + 纪要索引 + Top-K 召回全文。
 * 不再整表 chop 3500 字硬截断。
 */
export function formatTableMemoryInjection(input: RecallInjectionInput = {}): string {
  const s = input.state || loadTableMemory()
  const sch = input.scheduler || resolveTableMemoryScheduler()
  const entity = formatEntityTablesInjection(s, {
    maxChars: sch.entityInjectMaxChars,
  })

  if (!sch.recallEnabled) {
    // 关闭召回时：索引最近若干 + 实体
    const index = buildJournalIndexText(s, { maxEntries: sch.recallIndexTop })
    return [entity, index].join('\n\n')
  }

  const index = buildJournalIndexText(s, { maxEntries: sch.recallIndexTop })

  let selected: JournalRowView[]
  if (input.recallCodes?.length) {
    selected = selectJournalByCodes(s, input.recallCodes)
    // 不足 Top-K 时关键词补齐
    if (selected.length < sch.recallTopK) {
      const extra = selectJournalByKeyword(s, input.query || '', sch.recallTopK)
      const have = new Set(selected.map((r) => r.record.id))
      for (const r of extra) {
        if (selected.length >= sch.recallTopK) break
        if (!have.has(r.record.id)) {
          selected.push(r)
          have.add(r.record.id)
        }
      }
    }
  } else {
    selected = selectJournalByKeyword(s, input.query || '', sch.recallTopK)
  }

  const full = formatRecalledJournalFull(selected, {
    maxChars: sch.journalInjectMaxChars,
    // 主推演读档案时也需要破限挂点（与侧路选码共用同一字段）
    jailbreakPrefix: sch.recallJailbreakPrompt,
  })

  return [entity, index, full].join('\n\n')
}

/** 替换召回模板占位符 */
export function applyRecallTemplate(
  template: string,
  vars: Record<string, string | number>,
): string {
  let out = template || ''
  for (const [key, val] of Object.entries(vars)) {
    out = out.split(`{{${key}}}`).join(String(val))
  }
  return out
}

/**
 * 构建召回 LLM 任务 messages（可选二次 API 精确 Top-K）。
 * 顺序：system 任务 →（可选）system 破限 → user 任务
 * 主推演心法的 jailbreak 不会自动进来；破限只认本函数的 jailbreak 参数。
 * 占位：{{topK}} {{query}} {{previousPlot}} {{indexText}}
 */
export function buildRecallMessages(input: {
  query: string
  previousPlot?: string
  indexText: string
  topK: number
  /** 自定义 system；空/缺省 → 默认 */
  systemPrompt?: string | null
  /** 自定义 user 模板；空/缺省 → 默认 */
  userTemplate?: string | null
  /**
   * 破限正文；非空则插入独立 system（在任务 system 之后、user 之前）。
   * 这是召回支路专用挂点，与 ST 心法 jailbreak 分离。
   */
  jailbreakPrompt?: string | null
}): Array<{ role: 'system' | 'user'; content: string }> {
  const k = Math.max(1, input.topK)
  const vars = {
    topK: k,
    query: (input.query || '').slice(0, 400) || '（无）',
    previousPlot: (input.previousPlot || '').slice(0, 800) || '（无）',
    indexText: input.indexText || '(无索引)',
  }
  const sysRaw =
    typeof input.systemPrompt === 'string' && input.systemPrompt.trim()
      ? input.systemPrompt
      : DEFAULT_RECALL_SYSTEM_PROMPT
  const userRaw =
    typeof input.userTemplate === 'string' && input.userTemplate.trim()
      ? input.userTemplate
      : DEFAULT_RECALL_USER_TEMPLATE
  const msgs: Array<{ role: 'system' | 'user'; content: string }> = [
    { role: 'system', content: applyRecallTemplate(sysRaw, vars) },
  ]
  const jb =
    typeof input.jailbreakPrompt === 'string' ? input.jailbreakPrompt.trim() : ''
  if (jb) {
    msgs.push({ role: 'system', content: applyRecallTemplate(jb, vars) })
  }
  msgs.push({ role: 'user', content: applyRecallTemplate(userRaw, vars) })
  return msgs
}

/** 可选：调用 LLM 做精确召回，失败则回退关键词 */
export async function runIndexRecall(input: {
  state?: TableMemoryState
  query: string
  previousPlot?: string
  scheduler: TableMemorySchedulerSettings
  postChat?: (messages: Array<{ role: 'system' | 'user'; content: string }>) => Promise<string>
}): Promise<{
  codes: string[]
  rows: JournalRowView[]
  method: 'llm' | 'keyword'
  injection: string
}> {
  const s = input.state || loadTableMemory()
  const sch = input.scheduler
  const indexText = buildJournalIndexText(s, { maxEntries: sch.recallIndexTop })
  let codes: string[] = []
  let method: 'llm' | 'keyword' = 'keyword'

  if (input.postChat && sch.recallEnabled) {
    try {
      const messages = buildRecallMessages({
        query: input.query,
        previousPlot: input.previousPlot,
        indexText,
        topK: sch.recallTopK,
        systemPrompt: sch.recallSystemPrompt,
        userTemplate: sch.recallUserTemplate,
        jailbreakPrompt: sch.recallJailbreakPrompt,
      })
      const text = await input.postChat(messages)
      codes = parseRecallTag(text)
      if (codes.length) method = 'llm'
    } catch {
      codes = []
    }
  }

  const injection = formatTableMemoryInjection({
    state: s,
    query: input.query,
    recallCodes: codes.length ? codes : undefined,
    scheduler: sch,
  })
  const rows = codes.length
    ? selectJournalByCodes(s, codes)
    : selectJournalByKeyword(s, input.query, sch.recallTopK)

  return { codes, rows, method, injection }
}

/** 供测试：列名工具 re-export */
export function journalColumnNames(table: MemoryTableDef): string[] {
  return (table.columns || []).map(cleanColumnName)
}

// 注册注入实现，使 formatWorldStateInjection 走索引 Top-K 路径
bindTableMemoryInjector((input) => formatTableMemoryInjection(input))
