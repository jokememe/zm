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
  saveTableMemory,
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
  DEFAULT_RECALL_ASSISTANT_ACK,
  DEFAULT_RECALL_INJECT_DIRECTIVE,
  resolveTableMemoryScheduler,
} from '@/composables/table-memory-settings'
import {
  DEFAULT_API_MAX_ATTEMPTS,
  isRetryableFailureMessage,
  withRetry,
} from '@/composables/api-retry'
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
 * 完整注入块：叙事图谱（规则选取）+ 实体表 +（可选）纪要索引/Top-K。
 * 默认图谱优先；纪要 LLM 选码非必需。
 */
export function formatTableMemoryInjection(input: RecallInjectionInput = {}): string {
  const s = input.state || loadTableMemory()
  const sch = input.scheduler || resolveTableMemoryScheduler()
  const entity = formatEntityTablesInjection(s, {
    maxChars: sch.entityInjectMaxChars,
  })

  // 叙事记忆图谱：优先用传入 state 投影，再规则选取（零 API）
  let graphBlock = ''
  try {
    let graph = ensureMemoryGraphHydrated()
    // 注入若带了完整 table state，用其投影保证与本轮表一致（测试/离线）
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

  if (!sch.recallEnabled) {
    // 关闭纪要召回：图谱 + 实体 + 轻量索引
    const index = buildJournalIndexText(s, { maxEntries: Math.min(20, sch.recallIndexTop) })
    return [graphBlock, entity, index].filter(Boolean).join('\n\n')
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

  return [graphBlock, entity, index, full].filter(Boolean).join('\n\n')
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
 * 构建召回 LLM messages — 参考「疯狂原始人 纯召回」多轮选码：
 * system 角色 → assistant 接话 → user 上下文包 →（可选破限）→ user 开召
 * 主推演心法 jailbreak 不会自动进来。
 * 占位：{{topK}} {{query}} {{previousPlot}} {{indexText}} {{background}}
 */
export function buildRecallMessages(input: {
  query: string
  previousPlot?: string
  indexText: string
  topK: number
  /** 背景/设定摘要（对应纯召回 $1） */
  background?: string
  /** 自定义 system；空/缺省 → 默认 */
  systemPrompt?: string | null
  /** 自定义 user 模板；空/缺省 → 默认 */
  userTemplate?: string | null
  /**
   * 破限正文；非空则插入独立 system。
   */
  jailbreakPrompt?: string | null
  /**
   * simple：仅 system+user（旧密匣双段）
   * multi：纯召回多轮（默认）
   */
  mode?: 'simple' | 'multi'
}): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const k = Math.max(1, input.topK)
  const vars = {
    topK: k,
    query: (input.query || '').slice(0, 500) || '（无）',
    previousPlot: (input.previousPlot || '').slice(0, 1200) || '（无）',
    indexText: input.indexText || '(无索引)',
    background: (input.background || '').slice(0, 800) || '（无额外背景）',
  }
  const sysRaw =
    typeof input.systemPrompt === 'string' && input.systemPrompt.trim()
      ? input.systemPrompt
      : DEFAULT_RECALL_SYSTEM_PROMPT
  const userRaw =
    typeof input.userTemplate === 'string' && input.userTemplate.trim()
      ? input.userTemplate
      : DEFAULT_RECALL_USER_TEMPLATE
  const sys = applyRecallTemplate(sysRaw, vars)
  const userBody = applyRecallTemplate(userRaw, vars)
  const jb =
    typeof input.jailbreakPrompt === 'string' ? input.jailbreakPrompt.trim() : ''

  // 用户在密匣只改了短 system/user 时，仍可用 simple 双段
  const mode =
    input.mode ||
    (sysRaw === DEFAULT_RECALL_SYSTEM_PROMPT && userRaw === DEFAULT_RECALL_USER_TEMPLATE
      ? 'multi'
      : 'simple')

  if (mode === 'simple') {
    const msgs: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: sys },
    ]
    if (jb) msgs.push({ role: 'system', content: applyRecallTemplate(jb, vars) })
    msgs.push({ role: 'user', content: userBody })
    return msgs
  }

  // multi：疯狂原始人式多轮
  const msgs: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: sys },
    { role: 'assistant', content: DEFAULT_RECALL_ASSISTANT_ACK },
    { role: 'user', content: '以下为本宗设定与历史信息（索引 + 前文 + 本轮输入）。' },
    { role: 'user', content: userBody },
  ]
  if (jb) {
    // 破限插在上下文后、开召前
    msgs.push({ role: 'system', content: applyRecallTemplate(jb, vars) })
  }
  msgs.push({
    role: 'user',
    content: `现在请按照要求立刻检索与掌门本轮输入相关的纪要编码（目标约 ${k} 条，不足则全列）。只输出 thought + recall，不要写剧情。`,
  })
  return msgs
}

/** 发话前精确召回：LLM 选码，失败/空结果回退关键词；可重试 */
export async function runIndexRecall(input: {
  state?: TableMemoryState
  query: string
  previousPlot?: string
  background?: string
  scheduler: TableMemorySchedulerSettings
  postChat?: (
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  ) => Promise<string>
}): Promise<{
  codes: string[]
  rows: JournalRowView[]
  method: 'llm' | 'keyword'
  injection: string
  attempts: number
  error?: string
}> {
  const s = input.state || loadTableMemory()
  const sch = input.scheduler
  const indexText = buildJournalIndexText(s, { maxEntries: sch.recallIndexTop })
  let codes: string[] = []
  let method: 'llm' | 'keyword' = 'keyword'
  let attempts = 1
  let error: string | undefined

  if (input.postChat && sch.recallEnabled && listJournalRows(s).length > 0) {
    try {
      const messages = buildRecallMessages({
        query: input.query,
        previousPlot: input.previousPlot,
        background: input.background,
        indexText,
        topK: sch.recallTopK,
        systemPrompt: sch.recallSystemPrompt,
        userTemplate: sch.recallUserTemplate,
        jailbreakPrompt: sch.recallJailbreakPrompt,
        mode: 'multi',
      })
      const loop = await withRetry(
        async () => {
          const text = await input.postChat!(messages)
          const parsed = parseRecallTag(text)
          return { text, codes: parsed }
        },
        {
          maxAttempts: DEFAULT_API_MAX_ATTEMPTS,
          shouldRetry: (r, _a) => {
            if (!r.codes.length) return true
            return false
          },
        },
      )
      attempts = loop.attempts
      codes = loop.result.codes
      if (codes.length) method = 'llm'
    } catch (e) {
      error = String((e as Error)?.message || e)
      if (!isRetryableFailureMessage(error)) {
        /* keep keyword fallback */
      }
    }
  }

  const injection = formatTableMemoryInjection({
    state: s,
    query: input.query,
    recallCodes: codes.length ? codes : undefined,
    scheduler: sch,
  })
  const rows =
    codes.length > 0
      ? (() => {
          const byCode = selectJournalByCodes(s, codes)
          // LLM 选码不足 Top-K 时关键词补齐
          if (byCode.length >= sch.recallTopK) return byCode.slice(0, sch.recallTopK)
          const extra = selectJournalByKeyword(s, input.query, sch.recallTopK)
          const have = new Set(byCode.map((r) => r.record.id))
          for (const r of extra) {
            if (byCode.length >= sch.recallTopK) break
            if (!have.has(r.record.id)) {
              byCode.push(r)
              have.add(r.record.id)
            }
          }
          return byCode
        })()
      : selectJournalByKeyword(s, input.query, sch.recallTopK)

  // 回写最近召回码，供面板/调试
  if (s.meta) {
    s.meta.lastRecallCodes = rows.map((r) => r.indexCode).filter(Boolean)
    saveTableMemory(s)
  }

  return {
    codes: rows.map((r) => r.indexCode).filter(Boolean),
    rows,
    method,
    injection,
    attempts,
    error,
  }
}

/** 供测试：列名工具 re-export */
export function journalColumnNames(table: MemoryTableDef): string[] {
  return (table.columns || []).map(cleanColumnName)
}

// 注册注入实现，使 formatWorldStateInjection 走索引 Top-K 路径
bindTableMemoryInjector((input) => formatTableMemoryInjection(input))
