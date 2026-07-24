/**
 * yuzuki-Memory 风格表格记忆 — 纯逻辑可单测。
 * 解析 <Memory>/<GaigaiMemory>/<tableEdit>，主键合并，注入「当前世界状态参考」。
 * 与 short/mid/long 的 <sum> 路径并存，不替换。
 */
import { TABLE_MEMORY_STORAGE_KEY } from '@/data/opening'

export interface MemoryTableDef {
  id: string
  name: string
  /** 列名；前缀 # 表示追加列，* 表示仅首次填充 */
  columns: string[]
}

export interface MemoryRecord {
  id: string
  values: Record<string, string>
}

export interface TableMemoryState {
  tables: MemoryTableDef[]
  records: Record<string, MemoryRecord[]>
}

export interface ParsedMemoryRow {
  table: string
  primaryValue: string
  values: Record<string, string>
}

const MEMORY_TAG_PATTERN =
  /<(Memory|GaigaiMemory|memory|tableEdit|gaigaimemory|tableedit)>([\s\S]*?)<\/\1>/gi
const COMMENT_PATTERN = /<!--|-->/g

/** 与 yuzuki 默认表对齐，主键为首列 */
export const DEFAULT_MEMORY_TABLES: MemoryTableDef[] = [
  {
    id: 'character_profile',
    name: '角色档案',
    columns: [
      '角色名',
      '年龄',
      '性别',
      '身份',
      '性格',
      '当前位置',
      '周围角色',
      '生理',
      '人际关系',
      '着装',
      '待办事项',
      '约定',
    ],
  },
  {
    id: 'item_tracking',
    name: '物品追踪',
    columns: ['物品名称', '物品描述', '物品位置', '持有者', '状态', '备注'],
  },
  {
    id: 'world_setting',
    name: '世界设定',
    columns: ['设定名', '类型', '详细说明', '影响范围'],
  },
  {
    id: 'plot_summary',
    name: '剧情摘要',
    columns: ['#主线', '#支线'],
  },
]

export const TABLE_WORLD_STATE_ENTRY_ID = 'table-world-state'

const INJECT_MAX_CHARS = 3500

export function createDefaultTableMemoryState(): TableMemoryState {
  return {
    tables: DEFAULT_MEMORY_TABLES.map((t) => ({
      id: t.id,
      name: t.name,
      columns: [...t.columns],
    })),
    records: {},
  }
}

let state: TableMemoryState = createDefaultTableMemoryState()

export function cleanColumnName(column: string): string {
  return String(column || '')
    .trim()
    .replace(/^[#*]+/, '')
    .trim()
}

export function isAppendColumn(column: string): boolean {
  return /^[#*]*#/.test(String(column || '').trim()) || getColumnModifiers(column).includes('#')
}

function getColumnModifiers(column: string): string {
  const match = String(column || '')
    .trim()
    .match(/^[#*]+/)
  return match ? match[0] : ''
}

export function isFillOnceColumn(column: string): boolean {
  return getColumnModifiers(column).includes('*')
}

export function normalizeName(value: string): string {
  return String(value || '')
    .normalize('NFKC')
    .replace(/^[#*]+/, '')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase()
}

export function getPrimaryColumnName(table: MemoryTableDef): string {
  return cleanColumnName(table.columns[0] || '名称')
}

export function findTable(
  s: TableMemoryState,
  tableName: string,
): MemoryTableDef | null {
  const key = normalizeName(tableName)
  const tables = s.tables || []
  return (
    tables.find((t) => normalizeName(t.name) === key) ||
    tables.find((t) => normalizeName(t.id) === key) ||
    tables.find((t) => key.length > 0 && normalizeName(t.name).includes(key)) ||
    null
  )
}

function findColumn(table: MemoryTableDef, fieldName: string): string {
  const key = normalizeName(fieldName)
  return (
    (table.columns || []).find((column) => normalizeName(column) === key) || ''
  )
}

function splitSegments(line: string): string[] {
  return String(line || '')
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
}

function parseFieldSegment(segment: string): { field: string; value: string } | null {
  const match = String(segment || '').match(/^([^:：]+)[:：]([\s\S]*)$/)
  if (!match) return null
  return { field: match[1].trim(), value: match[2].trim() }
}

function appendCellValue(current: string, next: string): string {
  const currentText = String(current || '').trim()
  const nextText = String(next || '').trim()
  if (!nextText) return currentText
  if (!currentText) return nextText
  return `${currentText}；${nextText}`
}

function newRecordId(): string {
  return `record_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`
}

/**
 * 解析 Memory 标签体内的文本（可含 #表名 / [主键]|字段：值）为行操作。
 */
export function parseMemoryText(text: string): ParsedMemoryRow[] {
  const cleanText = String(text || '').replace(COMMENT_PATTERN, '\n')
  const rows: ParsedMemoryRow[] = []
  let currentTable = ''

  const knownTableNames = DEFAULT_MEMORY_TABLES.map((t) => t.name)

  const parseInlineTableLine = (line: string): boolean => {
    const parts = splitSegments(line)
    if (parts.length < 2) return false
    const tableToken = parts[0].replace(/^#+/, '').trim()
    const matchedTable = knownTableNames.find(
      (name) => normalizeName(name) === normalizeName(tableToken),
    )
    if (!matchedTable) return false
    const keyPartIndex = parts.findIndex(
      (part, index) => index > 0 && /^\[[^\]]+\]$/.test(part.trim()),
    )
    if (keyPartIndex < 0) return false
    const primaryValue = parts[keyPartIndex]
      .trim()
      .replace(/^\[|\]$/g, '')
      .trim()
    const body = parts
      .slice(keyPartIndex + 1)
      .join('|')
      .trim()
      .replace(/^内容\s*[:：]\s*/, '')
    const values: Record<string, string> = {}
    splitSegments(body).forEach((segment) => {
      const parsed = parseFieldSegment(segment)
      if (!parsed?.field) return
      values[parsed.field.replace(/^[#*]+/, '').trim()] = parsed.value
    })
    rows.push({ table: matchedTable, primaryValue, values })
    return true
  }

  cleanText.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim()
    if (!line) return
    if (parseInlineTableLine(line)) return
    if (line.startsWith('#')) {
      currentTable = line.replace(/^#+/, '').trim()
      return
    }
    const keyMatch = line.match(/^\[([^\]]+)\]\s*(?:\||$)([\s\S]*)$/)
    if (!keyMatch || !currentTable) return
    const primaryValue = keyMatch[1].trim()
    const values: Record<string, string> = {}
    splitSegments(keyMatch[2]).forEach((segment) => {
      const parsed = parseFieldSegment(segment)
      if (!parsed?.field) return
      values[parsed.field.replace(/^[#*]+/, '').trim()] = parsed.value
    })
    rows.push({ table: currentTable, primaryValue, values })
  })

  return rows
}

/** 从助手全文提取所有 Memory 标签内的行 */
export function extractMemoryRows(text: string): ParsedMemoryRow[] {
  const rows: ParsedMemoryRow[] = []
  MEMORY_TAG_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = MEMORY_TAG_PATTERN.exec(String(text || ''))) !== null) {
    rows.push(...parseMemoryText(match[2]))
  }
  return rows
}

export function hasMemoryTag(text: string): boolean {
  MEMORY_TAG_PATTERN.lastIndex = 0
  return MEMORY_TAG_PATTERN.test(String(text || ''))
}

function createRecord(
  table: MemoryTableDef,
  values: Record<string, string> = {},
): MemoryRecord {
  const out: Record<string, string> = {}
  for (const column of table.columns || []) {
    const name = cleanColumnName(column)
    out[name] = String(values[name] ?? '')
  }
  return { id: newRecordId(), values: out }
}

/**
 * 主键合并：仅更新提供的非空字段；# 列追加；* 列已有值则跳过。
 * 剧情摘要：按主线/支线列追加行文本。
 */
export function applyMemoryRow(
  s: TableMemoryState,
  row: ParsedMemoryRow,
): boolean {
  const table = findTable(s, row.table)
  if (!table) return false

  s.records = s.records && typeof s.records === 'object' ? s.records : {}
  s.records[table.id] = Array.isArray(s.records[table.id])
    ? s.records[table.id]
    : []
  const records = s.records[table.id]

  // 剧情摘要：primary 主线/支线 → 追加到对应 # 列
  if (table.id === 'plot_summary') {
    const kind = /支线/.test(row.primaryValue) ? '支线' : '主线'
    const body =
      Object.entries(row.values || {})
        .map(([k, v]) => `${k}：${v}`)
        .join('；') || String(row.primaryValue || '').trim()
    const text = body.trim()
    if (!text) return false
    let record = records[0]
    if (!record) {
      record = createRecord(table, {})
      records.push(record)
    }
    record.values = record.values || {}
    record.values[kind] = appendCellValue(record.values[kind] || '', text)
    return true
  }

  const primaryName = getPrimaryColumnName(table)
  const primaryValue = String(row.primaryValue || '').trim()
  if (!primaryValue) return false

  const validUpdates = Object.entries(row.values || {})
    .map(([field, value]) => {
      const column = findColumn(table, field)
      if (!column) return null
      const nextValue = String(value || '').trim()
      if (!nextValue) return null
      return { column, value: nextValue }
    })
    .filter((x): x is { column: string; value: string } => !!x)

  if (!validUpdates.length) return false

  let record = records.find(
    (entry) => String(entry?.values?.[primaryName] || '').trim() === primaryValue,
  )
  if (!record) {
    record = createRecord(table, { [primaryName]: primaryValue })
    records.push(record)
  }
  record.values = record.values || {}
  record.values[primaryName] = primaryValue

  for (const { column, value } of validUpdates) {
    const columnName = cleanColumnName(column)
    const currentValue = String(record.values[columnName] || '').trim()
    if (isFillOnceColumn(column) && currentValue) continue
    record.values[columnName] = isAppendColumn(column)
      ? appendCellValue(record.values[columnName], value)
      : value
  }
  return true
}

export function applyRowsToState(
  s: TableMemoryState,
  rows: ParsedMemoryRow[],
): number {
  let count = 0
  for (const row of rows || []) {
    if (applyMemoryRow(s, row)) count += 1
  }
  return count
}

/** 解析全文中的 Memory 标签并合并进状态；返回应用行数 */
export function applyMemoryTextToState(
  s: TableMemoryState,
  text: string,
): { success: boolean; count: number; rows: ParsedMemoryRow[] } {
  const rows = extractMemoryRows(text)
  if (!rows.length) return { success: false, count: 0, rows }
  const count = applyRowsToState(s, rows)
  return { success: count > 0, count, rows }
}

function recordToText(table: MemoryTableDef, record: MemoryRecord): string {
  if (!record) return ''
  const values = record.values || {}
  const parts = (table.columns || [])
    .map((column) => {
      const name = cleanColumnName(column)
      const value = String(values[name] ?? '').trim()
      return value ? `${name}: ${value}` : ''
    })
    .filter(Boolean)
  return parts.length ? `- ${parts.join('；')}` : ''
}

export function buildTableText(
  s: TableMemoryState,
  table: MemoryTableDef,
): string {
  if (!table) return ''
  const rows = (s.records[table.id] || [])
    .map((record) => recordToText(table, record))
    .filter(Boolean)
  if (!rows.length) {
    return `【${table.name}】\n(历史存档，当前暂无数据)`
  }
  return [`【${table.name}】`, ...rows].join('\n')
}

/**
 * 生成注入块：【当前世界状态参考】+ 各表内容。
 * 空库返回明确占位，不抛错。
 */
export function formatWorldStateInjection(
  s: TableMemoryState = state,
  opts?: { maxChars?: number },
): string {
  const maxChars = opts?.maxChars ?? INJECT_MAX_CHARS
  const tables = s.tables || []
  const blocks = tables.map((table) => buildTableText(s, table)).filter(Boolean)
  if (!blocks.length) {
    return (
      '【当前世界状态参考】\n' +
      '(历史存档，仅作背景参考，请勿复述或重演)\n' +
      '(当前暂无表格数据)'
    )
  }
  let body = blocks.join('\n\n')
  if (body.length > maxChars) {
    body = body.slice(0, maxChars - 1) + '…'
  }
  return (
    '【当前世界状态参考】\n' +
    '(历史存档，仅作背景参考，请勿复述或重演)\n' +
    body
  )
}

export function loadTableMemory(): TableMemoryState {
  try {
    const raw = localStorage.getItem(TABLE_MEMORY_STORAGE_KEY)
    if (!raw) {
      state = createDefaultTableMemoryState()
      return state
    }
    const o = JSON.parse(raw) as Partial<TableMemoryState>
    const base = createDefaultTableMemoryState()
    const tables =
      Array.isArray(o.tables) && o.tables.length
        ? o.tables.map((t) => ({
            id: String(t.id || ''),
            name: String(t.name || ''),
            columns: Array.isArray(t.columns)
              ? t.columns.map(String)
              : [],
          }))
        : base.tables
    const records: Record<string, MemoryRecord[]> = {}
    if (o.records && typeof o.records === 'object') {
      for (const [id, list] of Object.entries(o.records)) {
        if (!Array.isArray(list)) continue
        records[id] = list.map((r) => ({
          id: String(r?.id || newRecordId()),
          values:
            r?.values && typeof r.values === 'object'
              ? Object.fromEntries(
                  Object.entries(r.values).map(([k, v]) => [k, String(v ?? '')]),
                )
              : {},
        }))
      }
    }
    state = { tables, records }
    return state
  } catch {
    state = createDefaultTableMemoryState()
    return state
  }
}

export function getTableMemory(): TableMemoryState {
  return state
}

export function saveTableMemory(s: TableMemoryState = state): void {
  state = s
  try {
    localStorage.setItem(TABLE_MEMORY_STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* ignore */
  }
}

export function clearTableMemory(): void {
  state = createDefaultTableMemoryState()
  try {
    localStorage.removeItem(TABLE_MEMORY_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * 从助手回复应用 Memory 标签并持久化。
 * 供 Tianji 回合结束路径调用。
 */
export function applyAssistantMemoryTags(text: string): {
  success: boolean
  count: number
} {
  loadTableMemory()
  const result = applyMemoryTextToState(state, text)
  if (result.count > 0) saveTableMemory(state)
  return { success: result.success, count: result.count }
}

/** 开局种子：清空表格记忆（与 seedOpeningMemory 对齐） */
export function seedOpeningTableMemory(): void {
  clearTableMemory()
}
