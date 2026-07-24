/**
 * 纪要表自动合并 — 对齐 shujuku performAutoMergeSummary_ACU。
 *
 * cleanup ≠ 删除：把细粒度纪要行合并为更粗的 auto_merged 行，
 * 保留已有 auto_merged + 新合并结果 + reserve 之后的细行。
 */
import {
  cleanColumnName,
  findTable,
  getPrimaryColumnName,
  loadTableMemory,
  saveTableMemory,
  type MemoryRecord,
  type TableMemoryState,
} from '@/composables/table-memory'
import type { TableMemorySchedulerSettings } from '@/composables/table-memory-settings'

export const JOURNAL_TABLE_ID = 'plot_journal'
export const JOURNAL_TABLE_NAME = '纪要表'
export const AUTO_MERGED_TAG = 'auto_merged'

export interface JournalRowView {
  record: MemoryRecord
  indexCode: string
  summary: string
  span: string
  place: string
  body: string
  isAutoMerged: boolean
}

export function isJournalTableName(name: string): boolean {
  const n = String(name || '').trim()
  return n === '纪要表' || n === '总结表' || n === '剧情摘要'
}

export function getJournalTable(s: TableMemoryState = loadTableMemory()) {
  return (
    findTable(s, JOURNAL_TABLE_NAME) ||
    findTable(s, '总结表') ||
    findTable(s, '剧情摘要') ||
    s.tables.find((t) => t.id === JOURNAL_TABLE_ID) ||
    null
  )
}

export function isAutoMergedRecord(rec: MemoryRecord): boolean {
  const mark = String(rec?.values?.['标记'] || rec?.values?.['mark'] || '').trim()
  if (mark === AUTO_MERGED_TAG) return true
  // 兼容：编码以 AM 开头视为合并行
  const code = String(rec?.values?.['编码索引'] || '').trim()
  return /^AM\d+/i.test(code) && mark.toLowerCase().includes('merge')
}

export function listJournalRows(s: TableMemoryState = loadTableMemory()): JournalRowView[] {
  const table = getJournalTable(s)
  if (!table) return []
  const list = s.records[table.id] || []
  return list.map((record) => {
    const v = record.values || {}
    const indexCode = String(v['编码索引'] || v[getPrimaryColumnName(table)] || '').trim()
    return {
      record,
      indexCode,
      summary: String(v['概要'] || v['概览'] || '').trim(),
      span: String(v['时间跨度'] || '').trim(),
      place: String(v['地点'] || '').trim(),
      body: String(v['纪要'] || v['内容'] || '').trim(),
      isAutoMerged: isAutoMergedRecord(record),
    }
  })
}

export function countFineJournalRows(s: TableMemoryState = loadTableMemory()): number {
  return listJournalRows(s).filter((r) => !r.isAutoMerged).length
}

export interface MergeTriggerResult {
  shouldMerge: boolean
  fineCount: number
  mergeCount: number
  reserve: number
  threshold: number
  reason: string
}

/** 对齐 checkAndTriggerAutoMergeSummary：细行数 >= threshold + reserve 时合并前 mergeCount 条 */
export function checkAutoMergeTrigger(
  s: TableMemoryState,
  scheduler: Pick<
    TableMemorySchedulerSettings,
    'autoMergeEnabled' | 'autoMergeThreshold' | 'autoMergeReserve'
  >,
): MergeTriggerResult {
  if (!scheduler.autoMergeEnabled) {
    return {
      shouldMerge: false,
      fineCount: 0,
      mergeCount: 0,
      reserve: scheduler.autoMergeReserve,
      threshold: scheduler.autoMergeThreshold,
      reason: 'disabled',
    }
  }
  const fine = listJournalRows(s).filter((r) => !r.isAutoMerged)
  const fineCount = fine.length
  const threshold = Math.max(2, scheduler.autoMergeThreshold || 20)
  const reserve = Math.max(0, scheduler.autoMergeReserve || 0)
  const trigger = threshold + reserve
  if (fineCount < trigger) {
    return {
      shouldMerge: false,
      fineCount,
      mergeCount: 0,
      reserve,
      threshold,
      reason: 'below_threshold',
    }
  }
  const mergeCount = fineCount - reserve
  return {
    shouldMerge: mergeCount > 0,
    fineCount,
    mergeCount,
    reserve,
    threshold,
    reason: mergeCount > 0 ? 'ready' : 'nothing_to_merge',
  }
}

/** 格式化一批细行为合并 prompt 输入 */
export function formatFineRowsForMerge(
  rows: JournalRowView[],
  startOrdinal = 1,
): string {
  return rows
    .map((r, i) => {
      const n = startOrdinal + i
      const parts = [
        r.indexCode && `编码:${r.indexCode}`,
        r.summary && `概要:${r.summary}`,
        r.span && `跨度:${r.span}`,
        r.place && `地点:${r.place}`,
        r.body && `纪要:${r.body}`,
      ].filter(Boolean)
      return `[${n}] ${parts.join(' | ')}`
    })
    .join('\n')
}

export function buildMergePrompt(input: {
  fineText: string
  existingMergedText?: string
  targetCount?: number
}): Array<{ role: 'system' | 'user'; content: string }> {
  const target = Math.max(1, input.targetCount ?? 1)
  return [
    {
      role: 'system',
      content:
        '你是纪要合并引擎。把多条细粒度剧情纪要合并为更粗粒度的总结行。' +
        '只输出 <Memory><!--...--></Memory>，不要解释。' +
        '合并后的行必须写在 #纪要表 下；标记字段必须写 auto_merged；编码索引用 AM 前缀（如 AM0001）。',
    },
    {
      role: 'user',
      content: [
        '【已有粗粒度合并纪要（可参考衔接，勿重复堆砌）】',
        input.existingMergedText?.trim() || '（无）',
        '',
        '【待合并的细粒度纪要】',
        input.fineText || '（无）',
        '',
        `请将上述细纪要合并为 ${target} 条粗纪要。`,
        '输出格式：',
        '<Memory><!--',
        '#纪要表',
        '[AM0001]|概要：…|时间跨度：…|地点：…|纪要：…|标记：auto_merged',
        '--></Memory>',
        '规则：保留关键人物/地点/因果；压缩废话；禁止空字段；编码索引全局唯一。',
      ].join('\n'),
    },
  ]
}

/**
 * 应用合并结果：删除被合并的细行，保留 auto_merged + 新行 + 剩余细行。
 * startFineIndex/endFineIndex 基于「仅细行」的 0-based 区间 [start, end)。
 */
export function applyMergeResultToState(
  s: TableMemoryState,
  opts: {
    startFineIndex: number
    endFineIndex: number
    mergedRows: Array<Record<string, string>>
  },
): { removed: number; added: number } {
  const table = getJournalTable(s)
  if (!table) return { removed: 0, added: 0 }

  const all = [...(s.records[table.id] || [])]
  const fineIndices: number[] = []
  all.forEach((rec, i) => {
    if (!isAutoMergedRecord(rec)) fineIndices.push(i)
  })

  const start = Math.max(0, opts.startFineIndex)
  const end = Math.min(fineIndices.length, opts.endFineIndex)
  const removeSet = new Set(fineIndices.slice(start, end))

  const kept = all.filter((_, i) => !removeSet.has(i))
  const primary = getPrimaryColumnName(table)
  const added: MemoryRecord[] = []

  for (const values of opts.mergedRows || []) {
    const code =
      String(values['编码索引'] || values[primary] || '').trim() ||
      nextAmCode(s)
    const rec: MemoryRecord = {
      id: `record_am_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      values: {},
    }
    for (const col of table.columns) {
      const name = cleanColumnName(col)
      rec.values[name] = String(values[name] ?? '').trim()
    }
    rec.values[primary] = code
    rec.values['编码索引'] = code
    rec.values['标记'] = AUTO_MERGED_TAG
    if (!rec.values['概要'] && values['概览']) {
      rec.values['概要'] = String(values['概览'])
    }
    added.push(rec)
  }

  // 顺序：原有 auto_merged → 新合并 → 剩余细行（与 ACU 一致）
  const existingMerged = kept.filter((r) => isAutoMergedRecord(r))
  const remainingFine = kept.filter((r) => !isAutoMergedRecord(r))
  s.records[table.id] = [...existingMerged, ...added, ...remainingFine]

  // 推进 AM 序号
  if (!s.meta) s.meta = { lastUpdatedAiFloor: 0, filledFloors: [], nextIndexCode: 1 }
  for (const rec of added) {
    const m = String(rec.values['编码索引'] || '').match(/^AM(\d+)/i)
    if (m) {
      const n = parseInt(m[1], 10)
      if (n >= (s.meta.nextIndexCode || 1)) s.meta.nextIndexCode = n + 1
    }
  }

  return { removed: removeSet.size, added: added.length }
}

export function nextAmCode(s: TableMemoryState): string {
  if (!s.meta) s.meta = { lastUpdatedAiFloor: 0, filledFloors: [], nextIndexCode: 1 }
  const n = Math.max(1, s.meta.nextIndexCode || 1)
  s.meta.nextIndexCode = n + 1
  return `AM${String(n).padStart(4, '0')}`
}

export function nextJournalCode(s: TableMemoryState): string {
  if (!s.meta) s.meta = { lastUpdatedAiFloor: 0, filledFloors: [], nextIndexCode: 1 }
  // 细行用 J 前缀，合并行用 AM
  const n = Math.max(1, s.meta.nextIndexCode || 1)
  s.meta.nextIndexCode = n + 1
  return `J${String(n).padStart(4, '0')}`
}

/**
 * 解析合并 LLM 输出中的纪要行（Memory 标签内 #纪要表）。
 * 使用轻量本地解析，避免与 table-memory 循环依赖。
 */
export function parseMergedJournalRows(text: string): Array<Record<string, string>> {
  const out: Array<Record<string, string>> = []
  const tagRe =
    /<(Memory|GaigaiMemory|memory|tableEdit|gaigaimemory|tableedit)>([\s\S]*?)<\/\1>/gi
  let body = String(text || '')
  const chunks: string[] = []
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(body)) !== null) chunks.push(m[2])
  if (!chunks.length) chunks.push(body)

  for (const chunk of chunks) {
    let currentTable = ''
    for (const rawLine of chunk.replace(/<!--|-->/g, '\n').split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line) continue
      if (line.startsWith('#')) {
        currentTable = line.replace(/^#+/, '').trim()
        continue
      }
      const keyMatch = line.match(/^\[([^\]]+)\]\s*(?:\||$)([\s\S]*)$/)
      if (!keyMatch) continue
      const tableOk =
        !currentTable ||
        isJournalTableName(currentTable) ||
        currentTable === JOURNAL_TABLE_ID ||
        /纪要|总结|剧情/.test(currentTable)
      if (!tableOk && !/^AM/i.test(keyMatch[1])) continue

      const values: Record<string, string> = {
        编码索引: keyMatch[1].trim(),
        标记: AUTO_MERGED_TAG,
      }
      String(keyMatch[2] || '')
        .split('|')
        .map((p) => p.trim())
        .filter(Boolean)
        .forEach((seg) => {
          const fm = seg.match(/^([^:：]+)[:：]([\s\S]*)$/)
          if (!fm) return
          values[fm[1].trim().replace(/^[#*]+/, '')] = fm[2].trim()
        })
      values['标记'] = AUTO_MERGED_TAG
      out.push(values)
    }
  }
  return out
}

/**
 * 同步执行「本地折叠合并」兜底：无 LLM 时把细行拼成一条粗行。
 */
export function localCollapseMerge(
  s: TableMemoryState,
  opts: { startFineIndex: number; endFineIndex: number },
): { removed: number; added: number } {
  const fine = listJournalRows(s).filter((r) => !r.isAutoMerged)
  const slice = fine.slice(opts.startFineIndex, opts.endFineIndex)
  if (!slice.length) return { removed: 0, added: 0 }

  const summary = slice
    .map((r) => r.summary || r.body.slice(0, 40))
    .filter(Boolean)
    .slice(0, 6)
    .join('；')
  const body = slice
    .map((r) => r.body || r.summary)
    .filter(Boolean)
    .join('｜')
  const place = [...new Set(slice.map((r) => r.place).filter(Boolean))].join('、')
  const span = [slice[0]?.span, slice[slice.length - 1]?.span].filter(Boolean).join('→')
  const code = nextAmCode(s)

  return applyMergeResultToState(s, {
    startFineIndex: opts.startFineIndex,
    endFineIndex: opts.endFineIndex,
    mergedRows: [
      {
        编码索引: code,
        概要: summary || `合并纪要 ${slice.length} 条`,
        时间跨度: span,
        地点: place,
        纪要: body.slice(0, 1200),
        标记: AUTO_MERGED_TAG,
      },
    ],
  })
}

/**
 * 跑一轮自动合并（可注入 LLM）。
 * postChat 可选：有则走 LLM 合并；无则本地折叠。
 */
export async function runAutoMergeJournal(input: {
  state?: TableMemoryState
  scheduler: TableMemorySchedulerSettings
  postChat?: (messages: Array<{ role: 'system' | 'user'; content: string }>) => Promise<string>
}): Promise<{
  status: 'skipped' | 'merged' | 'failed'
  reason?: string
  removed?: number
  added?: number
  error?: string
}> {
  const s = input.state || loadTableMemory()
  const trigger = checkAutoMergeTrigger(s, input.scheduler)
  if (!trigger.shouldMerge) {
    return { status: 'skipped', reason: trigger.reason }
  }

  const fine = listJournalRows(s).filter((r) => !r.isAutoMerged)
  const mergeCount = trigger.mergeCount
  const batchSize = Math.max(1, input.scheduler.mergeBatchSize || 5)
  const existingMerged = listJournalRows(s)
    .filter((r) => r.isAutoMerged)
    .slice(-3)
  const existingText = formatFineRowsForMerge(existingMerged, 1)

  let totalRemoved = 0
  let totalAdded = 0
  // 从开头合并 mergeCount 条细行，按 batch 折叠；每批目标 1 条粗行
  let remaining = mergeCount
  let cursor = 0

  try {
    while (remaining > 0) {
      const take = Math.min(batchSize, remaining)
      const batchRows = fine.slice(cursor, cursor + take)
      if (!batchRows.length) break

      let mergedValues: Array<Record<string, string>> = []

      if (input.postChat) {
        const fineText = formatFineRowsForMerge(batchRows, cursor + 1)
        const messages = buildMergePrompt({
          fineText,
          existingMergedText: existingText,
          targetCount: 1,
        })
        const text = await input.postChat(messages)
        mergedValues = parseMergedJournalRows(text)
      }

      if (!mergedValues.length) {
        // 本地兜底
        const r = localCollapseMerge(s, {
          startFineIndex: cursor,
          endFineIndex: cursor + take,
        })
        totalRemoved += r.removed
        totalAdded += r.added
      } else {
        const r = applyMergeResultToState(s, {
          startFineIndex: cursor,
          endFineIndex: cursor + take,
          mergedRows: mergedValues,
        })
        totalRemoved += r.removed
        totalAdded += r.added
      }

      // 合并后 fine 列表变化：cursor 不前进（已删），remaining 减 take
      // 重新读 fine 视图
      const fineNow = listJournalRows(s).filter((r) => !r.isAutoMerged)
      // 已从头部删了 take 条，cursor 保持 0 语义：下一批仍从当前细行头开始
      remaining -= take
      cursor = 0
      // 防止死循环
      if (fineNow.length >= fine.length && take > 0 && !mergedValues.length) {
        break
      }
      fine.length = 0
      fine.push(...fineNow)
    }

    saveTableMemory(s)
    return {
      status: totalAdded > 0 ? 'merged' : 'skipped',
      reason: totalAdded > 0 ? 'ok' : 'no_rows',
      removed: totalRemoved,
      added: totalAdded,
    }
  } catch (e) {
    return {
      status: 'failed',
      error: String((e as Error)?.message || e),
    }
  }
}
