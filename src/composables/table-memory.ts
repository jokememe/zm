/**
 * yuzuki-Memory 风格表格记忆 — 纯逻辑可单测。
 * 解析 <Memory>/<GaigaiMemory>/<tableEdit>，主键合并，注入「当前世界状态参考」。
 * 与 short/mid/long 的 <sum> 路径并存，不替换。
 */
import { TABLE_MEMORY_STORAGE_KEY } from '@/data/opening'

// 召回注入在 formatWorldStateInjection 运行时再取，避免与 recall 模块循环初始化
let _formatTableMemoryInjection:
  | ((input: {
      state?: TableMemoryState
      query?: string
      recallCodes?: string[]
    }) => string)
  | null = null

export function bindTableMemoryInjector(
  fn: (input: {
    state?: TableMemoryState
    query?: string
    recallCodes?: string[]
  }) => string,
): void {
  _formatTableMemoryInjection = fn
}

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

/** 调度/编码进度（对齐 ACU lastUpdated + 索引序号） */
export interface TableMemoryMeta {
  /** 上次填表完成时的 AI 楼层号（1-based） */
  lastUpdatedAiFloor: number
  /** 已填表的 AI 楼层号列表（供 retain 清理） */
  filledFloors: number[]
  /** 下一个编码序号（J/AM 共用递增） */
  nextIndexCode: number
  /** 最近一次召回编码 */
  lastRecallCodes?: string[]
  /** 最近一次调度原因 */
  lastScheduleReason?: string
}

export interface TableMemoryState {
  tables: MemoryTableDef[]
  records: Record<string, MemoryRecord[]>
  meta?: TableMemoryMeta
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
  /**
   * 纪要表 — 对齐 shujuku@mov5.5：
   * 轮次客观日志（细行 J）；合并 auto_merged（AM）；
   * 纪要≥约300字第三方事实、概要≤30字；索引召回只读概要+编码。
   */
  {
    id: 'plot_journal',
    name: '纪要表',
    columns: ['编码索引', '时间跨度', '地点', '纪要', '概要', '标记'],
  },
]

export const TABLE_WORLD_STATE_ENTRY_ID = 'table-world-state'

const INJECT_MAX_CHARS = 3500

export function createDefaultMeta(): TableMemoryMeta {
  return {
    lastUpdatedAiFloor: 0,
    filledFloors: [],
    nextIndexCode: 1,
  }
}

export function createDefaultTableMemoryState(): TableMemoryState {
  return {
    tables: DEFAULT_MEMORY_TABLES.map((t) => ({
      id: t.id,
      name: t.name,
      columns: [...t.columns],
    })),
    records: {},
    meta: createDefaultMeta(),
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

/**
 * 纪要编码规范化：
 * - 原版 shujuku / 模型习惯常用 A0001 作细行索引
 * - 本仓统一细行为 Jxxxx、合并行为 AMxxxx
 * - A#### → J####，避免 A/J 交替双轨；已是 J/AM 则只做大写补零
 */
export function normalizeJournalIndexCode(code: string): string {
  const raw = String(code || '').trim().toUpperCase()
  if (!raw) return ''
  const am = raw.match(/^AM0*(\d+)$/i)
  if (am) return `AM${String(parseInt(am[1], 10) || 0).padStart(4, '0')}`
  const aj = raw.match(/^[AJ]0*(\d+)$/i)
  if (aj) return `J${String(parseInt(aj[1], 10) || 0).padStart(4, '0')}`
  return raw
}

/** 纪要正文指纹：去空白标点，供近似去重 */
export function journalBodyFingerprint(text: string): string {
  return String(text || '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/[，。；、：:！!？?·•|｜\-—_（）()【】\[\]「」""'']/g, '')
    .toLowerCase()
}

/** 两条纪要是否同事件（精确 / 包含 / 前缀重叠） */
export function isSimilarJournalText(a: string, b: string): boolean {
  const na = journalBodyFingerprint(a)
  const nb = journalBodyFingerprint(b)
  if (!na || !nb) return false
  if (na === nb) return true
  if (na.length >= 8 && nb.length >= 8 && (na.includes(nb) || nb.includes(na))) {
    return true
  }
  const n = Math.min(28, na.length, nb.length)
  return n >= 12 && na.slice(0, n) === nb.slice(0, n)
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

  // 纪要表：每条细行独立插入（主键=编码索引）；同编码则合并字段
  // A#### 归一为 J####；正文近似重复则并入已有行，避免 A/J 双轨与 sum 叠写
  if (table.id === 'plot_journal') {
    const primaryName = getPrimaryColumnName(table)
    const validUpdates = Object.entries(row.values || {})
      .map(([field, value]) => {
        const column = findColumn(table, field)
        if (!column) return null
        const nextValue = String(value || '').trim()
        if (!nextValue) return null
        return { column, value: nextValue }
      })
      .filter((x): x is { column: string; value: string } => !!x)

    const incomingBody =
      validUpdates.find((u) => cleanColumnName(u.column) === '纪要')?.value ||
      String(row.values?.['纪要'] || row.values?.['内容'] || '').trim()
    const incomingSummary =
      validUpdates.find((u) => cleanColumnName(u.column) === '概要')?.value ||
      String(row.values?.['概要'] || row.values?.['概览'] || '').trim()
    const contentProbe = incomingBody || incomingSummary

    let primaryValue = normalizeJournalIndexCode(String(row.primaryValue || '').trim())
    // 模型写了 A/J 以外的「摘要」当主键时，当作无编码，走内容去重/新号
    if (primaryValue && !/^(J|AM)\d+$/i.test(primaryValue)) {
      // 保留 AM/J 以外的显式编码仅当不像自然语言
      if (/[\u4e00-\u9fff]/.test(primaryValue) || primaryValue.length > 12) {
        primaryValue = ''
      }
    }

    const codeMatch = (entry: MemoryRecord, code: string) => {
      if (!code) return false
      const existing = normalizeJournalIndexCode(
        String(entry?.values?.[primaryName] || entry?.values?.['编码索引'] || '').trim(),
      )
      return existing === code
    }

    let record = primaryValue
      ? records.find((entry) => codeMatch(entry, primaryValue))
      : undefined

    // 无匹配编码时：用正文/概要撞已有细行 → 合并而非新建（防 J 堆重复）
    if (!record && contentProbe) {
      const markOf = (entry: MemoryRecord) =>
        String(entry?.values?.['标记'] || '').trim() === 'auto_merged' ||
        /^AM\d+/i.test(String(entry?.values?.['编码索引'] || ''))
      record = [...records].reverse().find((entry) => {
        if (markOf(entry)) return false
        const body = String(entry.values?.['纪要'] || entry.values?.['内容'] || '').trim()
        const summary = String(entry.values?.['概要'] || '').trim()
        return (
          isSimilarJournalText(contentProbe, body) ||
          isSimilarJournalText(contentProbe, summary) ||
          (incomingSummary && isSimilarJournalText(incomingSummary, summary))
        )
      })
      if (record) {
        primaryValue = normalizeJournalIndexCode(
          String(record.values?.[primaryName] || record.values?.['编码索引'] || '').trim(),
        )
      }
    }

    if (!record) {
      if (!primaryValue) {
        if (!s.meta) s.meta = createDefaultMeta()
        const n = Math.max(1, s.meta.nextIndexCode || 1)
        primaryValue = `J${String(n).padStart(4, '0')}`
        s.meta.nextIndexCode = n + 1
      } else if (/^J\d+$/i.test(primaryValue) && s.meta) {
        const num = parseInt(primaryValue.replace(/\D/g, ''), 10)
        if (num >= (s.meta.nextIndexCode || 1)) s.meta.nextIndexCode = num + 1
      }
      record = createRecord(table, { [primaryName]: primaryValue })
      records.push(record)
    }

    record.values = record.values || {}
    record.values[primaryName] = primaryValue
    record.values['编码索引'] = primaryValue
    for (const { column, value } of validUpdates) {
      const columnName = cleanColumnName(column)
      if (columnName === '编码索引' || columnName === primaryName) continue
      // 标记：细行写入时不要被模型乱标 auto_merged
      if (columnName === '标记' && value === 'auto_merged' && !/^AM/i.test(primaryValue)) {
        continue
      }
      const prev = String(record.values[columnName] || '').trim()
      // 已有更长纪要时，短重复不覆盖
      if (
        (columnName === '纪要' || columnName === '概要') &&
        prev &&
        isSimilarJournalText(prev, value) &&
        value.length < prev.length
      ) {
        continue
      }
      record.values[columnName] = value
    }
    // shujuku：概览与概要同义
    if (!String(record.values['概要'] || '').trim() && row.values?.['概览']) {
      record.values['概要'] = String(row.values['概览']).trim().slice(0, 30)
    }
    if (!String(record.values['概要'] || '').trim()) {
      const body = String(record.values['纪要'] || '').trim()
      if (body) record.values['概要'] = body.slice(0, 30)
    } else {
      record.values['概要'] = String(record.values['概要']).trim().slice(0, 30)
    }
    return true
  }

  const primaryName = getPrimaryColumnName(table)
  let primaryValue = String(row.primaryValue || '').trim()
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

  // 角色档案改名：带 原名/旧名/曾用名 时并入旧行，不新建
  const formerName =
    table.id === 'character_profile'
      ? String(
          row.values?.['原名'] ||
            row.values?.['旧名'] ||
            row.values?.['曾用名'] ||
            row.values?.['formerName'] ||
            '',
        ).trim()
      : ''

  let record = records.find(
    (entry) => String(entry?.values?.[primaryName] || '').trim() === primaryValue,
  )
  if (!record && formerName) {
    record = records.find(
      (entry) => String(entry?.values?.[primaryName] || '').trim() === formerName,
    )
  }
  // 新名行与旧名行都在：合并到旧行并删新行占位
  if (record && formerName && primaryValue !== formerName) {
    const dup = records.find(
      (entry) =>
        entry.id !== record!.id &&
        String(entry?.values?.[primaryName] || '').trim() === primaryValue,
    )
    if (dup) {
      // 保留旧行 id，删掉误建的新名行
      s.records[table.id] = records.filter((e) => e.id !== dup.id)
    }
  }
  if (!record) {
    record = createRecord(table, { [primaryName]: primaryValue })
    records.push(record)
  }
  record.values = record.values || {}
  record.values[primaryName] = primaryValue

  for (const { column, value } of validUpdates) {
    const columnName = cleanColumnName(column)
    if (
      columnName === '原名' ||
      columnName === '旧名' ||
      columnName === '曾用名' ||
      columnName === 'formerName'
    ) {
      continue
    }
    const currentValue = String(record.values[columnName] || '').trim()
    if (isFillOnceColumn(column) && currentValue) continue
    record.values[columnName] = isAppendColumn(column)
      ? appendCellValue(record.values[columnName], value)
      : value
  }
  return true
}

/**
 * 弟子/角色改名时同步角色档案主键，避免旧名新名双行。
 */
export function renameCharacterProfileRow(
  oldName: string,
  newName: string,
  s: TableMemoryState = state,
): boolean {
  const from = String(oldName || '').trim()
  const to = String(newName || '').trim()
  if (!from || !to || from === to) return false
  const table = s.tables.find((t) => t.id === 'character_profile')
  if (!table) return false
  const primary = getPrimaryColumnName(table)
  const list = s.records[table.id] || []
  const oldRec = list.find((r) => String(r.values?.[primary] || '').trim() === from)
  if (!oldRec) return false
  const clash = list.find(
    (r) => r.id !== oldRec.id && String(r.values?.[primary] || '').trim() === to,
  )
  if (clash) {
    s.records[table.id] = list.filter((r) => r.id !== clash.id)
  }
  oldRec.values = { ...oldRec.values, [primary]: to }
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
 * 生成注入块。
 * 默认走「实体表 + 纪要索引 + Top-K 召回全文」（对齐 shujuku，非整表硬截断）。
 * 传入 maxChars 且 forceLegacy 时保留旧版全表截断（兼容旧测试）。
 */
export function formatWorldStateInjection(
  s: TableMemoryState = state,
  opts?: {
    maxChars?: number
    /** 强制旧版全表截断 */
    forceLegacy?: boolean
    /** 召回 query（用户本回输入） */
    query?: string
    recallCodes?: string[]
  },
): string {
  if (!opts?.forceLegacy && _formatTableMemoryInjection) {
    return _formatTableMemoryInjection({
      state: s,
      query: opts?.query,
      recallCodes: opts?.recallCodes,
    })
  }

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

/** 确保默认表（含纪要表）存在，旧存档自动补表结构 */
function ensureDefaultTables(tables: MemoryTableDef[]): MemoryTableDef[] {
  const byId = new Map(tables.map((t) => [t.id, t]))
  for (const def of DEFAULT_MEMORY_TABLES) {
    if (!byId.has(def.id)) {
      tables.push({
        id: def.id,
        name: def.name,
        columns: [...def.columns],
      })
    }
  }
  return tables
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
    let tables =
      Array.isArray(o.tables) && o.tables.length
        ? o.tables.map((t) => ({
            id: String(t.id || ''),
            name: String(t.name || ''),
            columns: Array.isArray(t.columns)
              ? t.columns.map(String)
              : [],
          }))
        : base.tables
    tables = ensureDefaultTables(tables)
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
    const meta: TableMemoryMeta = {
      ...createDefaultMeta(),
      ...(o.meta && typeof o.meta === 'object' ? o.meta : {}),
      lastUpdatedAiFloor: Math.max(
        0,
        Math.floor(Number(o.meta?.lastUpdatedAiFloor) || 0),
      ),
      filledFloors: Array.isArray(o.meta?.filledFloors)
        ? o.meta!.filledFloors.map((n) => Math.floor(Number(n) || 0)).filter((n) => n > 0)
        : [],
      nextIndexCode: Math.max(1, Math.floor(Number(o.meta?.nextIndexCode) || 1)),
    }
    state = { tables, records, meta }
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
  // 手改/合并/同步后也刷新叙事图谱（钩子未绑定时 no-op）
  notifyTableMemoryWritten(state)
}

export function clearTableMemory(): void {
  state = createDefaultTableMemoryState()
  try {
    localStorage.removeItem(TABLE_MEMORY_STORAGE_KEY)
  } catch {
    /* ignore */
  }
  // 通知图谱侧可清空/重投影（钩子内会 sync；若需硬清由 clearMemoryGraph 负责）
  notifyTableMemoryWritten(state)
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
  if (result.count > 0) {
    // saveTableMemory → notifyTableMemoryWritten → 图谱投影
    saveTableMemory(state)
  }
  return { success: result.success, count: result.count }
}

/** 表格写入后钩子：由 memory-graph 绑定，避免循环依赖 */
let _afterTableMemoryWrite: ((s: TableMemoryState) => void) | null = null

export function bindAfterTableMemoryWrite(
  fn: (s: TableMemoryState) => void,
): void {
  _afterTableMemoryWrite = fn
}

export function notifyTableMemoryWritten(s: TableMemoryState = state): void {
  try {
    _afterTableMemoryWrite?.(s)
  } catch {
    /* ignore */
  }
}

/** 按主键写入/合并一行（游戏同步与手改共用） */
export function upsertTableRow(
  tableNameOrId: string,
  primaryValue: string,
  values: Record<string, string>,
  s: TableMemoryState = state,
): boolean {
  return applyMemoryRow(s, {
    table: tableNameOrId,
    primaryValue,
    values,
  })
}

export function countAllRecords(s: TableMemoryState = state): number {
  return Object.values(s.records || {}).reduce(
    (n, list) => n + (Array.isArray(list) ? list.length : 0),
    0,
  )
}

export function getTableRecordCount(
  tableId: string,
  s: TableMemoryState = state,
): number {
  const list = s.records?.[tableId]
  return Array.isArray(list) ? list.length : 0
}

/** 删除某表全部行（保留表结构） */
export function clearTableRecords(tableId: string, s: TableMemoryState = state): void {
  if (!s.records) s.records = {}
  s.records[tableId] = []
}

/** 按 record.id 删除一行 */
export function deleteTableRecord(
  tableId: string,
  recordId: string,
  s: TableMemoryState = state,
): boolean {
  if (!s.records?.[tableId]?.length) return false
  const before = s.records[tableId].length
  s.records[tableId] = s.records[tableId].filter((r) => r.id !== recordId)
  return s.records[tableId].length < before
}

/** 手改某一字段（按 record.id） */
export function setTableRecordField(
  tableId: string,
  recordId: string,
  column: string,
  value: string,
  s: TableMemoryState = state,
): boolean {
  const list = s.records?.[tableId]
  if (!list?.length) return false
  const rec = list.find((r) => r.id === recordId)
  if (!rec) return false
  const col = cleanColumnName(column)
  if (!col) return false
  rec.values = { ...(rec.values || {}), [col]: String(value ?? '') }
  // 主键列与编码索引对齐（纪要表）
  if (tableId === 'plot_journal' && (col === '编码索引' || col === getPrimaryColumnName(
    s.tables.find((t) => t.id === tableId) || { id: '', name: '', columns: ['编码索引'] },
  ))) {
    const code = normalizeJournalIndexCode(String(value || '').trim()) || String(value || '').trim()
    rec.values['编码索引'] = code
    const primary = getPrimaryColumnName(
      s.tables.find((t) => t.id === tableId) || { id: '', name: '', columns: ['编码索引'] },
    )
    rec.values[primary] = code
  }
  return true
}

/**
 * 在指定表新增空行（或带初值）。
 * 纪要表自动分配 J 编码。
 */
export function addTableRecord(
  tableId: string,
  values: Record<string, string> = {},
  s: TableMemoryState = state,
): MemoryRecord | null {
  const table = s.tables.find((t) => t.id === tableId)
  if (!table) return null
  if (!s.records) s.records = {}
  if (!Array.isArray(s.records[tableId])) s.records[tableId] = []

  const primary = getPrimaryColumnName(table)
  const out: Record<string, string> = {}
  for (const column of table.columns || []) {
    const name = cleanColumnName(column)
    out[name] = String(values[name] ?? '')
  }

  if (tableId === 'plot_journal') {
    if (!s.meta) s.meta = createDefaultMeta()
    let code = normalizeJournalIndexCode(out['编码索引'] || out[primary] || '')
    if (!code) {
      const n = Math.max(1, s.meta.nextIndexCode || 1)
      code = `J${String(n).padStart(4, '0')}`
      s.meta.nextIndexCode = n + 1
    }
    out[primary] = code
    out['编码索引'] = code
  } else if (!String(out[primary] || '').trim()) {
    out[primary] = `新建${s.records[tableId].length + 1}`
  }

  const rec: MemoryRecord = {
    id: newRecordId(),
    values: out,
  }
  s.records[tableId].push(rec)
  return rec
}

/**
 * 用游戏侧快照覆盖式同步「系统底表」行（弟子/宝物/势力城池等）。
 * 仅更新本函数写入的字段；LLM 额外字段在同主键上保留（非空字段合并）。
 */
export function syncRowsFromGameSnapshot(
  snap: {
    sectName: string
    masterName: string
    difficultyLabel: string
    year: number | string
    season: string
    disciples: Array<{
      name: string
      age?: number | string
      gender?: string
      role?: string
      realm?: string
      status?: string
      mood?: string
      loyalty?: number | string
      talent?: string[]
      master?: string
      spouse?: string
    }>
    treasures?: Array<{
      name: string
      type?: string
      grade?: string
      owner?: string | null
      desc?: string
      bound?: boolean
    }>
    forgeQueue?: Array<{
      name: string
      type?: string
      grade?: string
      craftsman?: string | null
      progress?: number
      power?: string
    }>
    factions?: Array<{
      name: string
      stance?: string
      relation?: number
      power?: string
      recent?: string
      demand?: string
    }>
    cities?: Array<{
      name: string
      attitude?: string
      influence?: number
      governor?: string
      notes?: string
      distance?: string
    }>
  },
  s: TableMemoryState = state,
): { characters: number; items: number; world: number } {
  let characters = 0
  let items = 0
  let world = 0

  // 掌门
  if (snap.masterName?.trim()) {
    if (
      upsertTableRow(
        '角色档案',
        snap.masterName.trim(),
        {
          身份: `${snap.sectName || '本宗'}掌门`,
          性格: '主视角',
          当前位置: '山门/宗务',
          人际关系: '掌门',
        },
        s,
      )
    ) {
      characters += 1
    }
  }

  for (const d of snap.disciples || []) {
    const name = String(d.name || '').trim()
    if (!name) continue
    const rel: string[] = []
    if (d.master) rel.push(`师：${d.master}`)
    if (d.spouse) rel.push(`道侣倾向：${d.spouse}`)
    if (d.loyalty != null) rel.push(`忠心${d.loyalty}`)
    const ok = upsertTableRow(
      '角色档案',
      name,
      {
        年龄: d.age != null ? String(d.age) : '',
        性别: d.gender ? String(d.gender) : '',
        身份: [d.role, d.realm].filter(Boolean).join(' · '),
        性格: d.mood ? String(d.mood) : '',
        当前位置: d.status ? String(d.status) : '在宗',
        人际关系: rel.join('；'),
        生理: Array.isArray(d.talent) && d.talent.length ? d.talent.join('、') : '',
      },
      s,
    )
    if (ok) characters += 1
  }

  for (const t of snap.treasures || []) {
    const name = String(t.name || '').trim()
    if (!name) continue
    const ok = upsertTableRow(
      '物品追踪',
      name,
      {
        物品描述: [t.grade, t.type, t.desc].filter(Boolean).join(' · '),
        物品位置: t.bound ? '已认主' : '库藏/待分配',
        持有者: t.owner ? String(t.owner) : '无主',
        状态: t.bound ? '绑定' : '未绑定',
        备注: t.type ? String(t.type) : '',
      },
      s,
    )
    if (ok) items += 1
  }

  for (const g of snap.forgeQueue || []) {
    const name = String(g.name || '').trim()
    if (!name) continue
    const ok = upsertTableRow(
      '物品追踪',
      name,
      {
        物品描述: [g.grade, g.type, g.power].filter(Boolean).join(' · '),
        物品位置: '锻器房',
        持有者: g.craftsman ? String(g.craftsman) : '未指派',
        状态: `锻造进度 ${g.progress ?? 0}%`,
        备注: '锻器队列',
      },
      s,
    )
    if (ok) items += 1
  }

  // 宗门本体
  if (snap.sectName?.trim()) {
    if (
      upsertTableRow(
        '世界设定',
        snap.sectName.trim(),
        {
          类型: '本宗',
          详细说明: `掌门${snap.masterName || '？'}；难度${snap.difficultyLabel || '—'}；历法天元${snap.year}年${snap.season}`,
          影响范围: '山门内外政务与气运',
        },
        s,
      )
    ) {
      world += 1
    }
  }

  for (const f of snap.factions || []) {
    const name = String(f.name || '').trim()
    if (!name) continue
    const ok = upsertTableRow(
      '世界设定',
      name,
      {
        类型: `势力·${f.stance || '中立'}`,
        详细说明: [
          f.power,
          f.relation != null ? `关系${f.relation}` : '',
          f.recent,
          f.demand ? `诉求：${f.demand}` : '',
        ]
          .filter(Boolean)
          .join('；'),
        影响范围: '外交/战事',
      },
      s,
    )
    if (ok) world += 1
  }

  for (const c of snap.cities || []) {
    const name = String(c.name || '').trim()
    if (!name) continue
    const ok = upsertTableRow(
      '世界设定',
      name,
      {
        类型: `城池·${c.attitude || '中立'}`,
        详细说明: [
          c.distance,
          c.governor ? `主事${c.governor}` : '',
          c.influence != null ? `影响${c.influence}` : '',
          c.notes,
        ]
          .filter(Boolean)
          .join('；'),
        影响范围: '纳贡/声望',
      },
      s,
    )
    if (ok) world += 1
  }

  return { characters, items, world }
}

/** 开局种子：清空后由 syncTableMemoryFromGame 填入（见 table-memory-sync） */
export function seedOpeningTableMemory(): void {
  clearTableMemory()
}
