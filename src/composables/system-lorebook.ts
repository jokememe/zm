/**
 * 系统世界书「宗门实况」— 局面快照 + 短/中/长期 + 角色记忆图谱（constant 常驻）
 * 记忆主路径是图谱，不再注入整表/纪要索引 dump。
 */
import type { Lorebook, LorebookEntry } from '@/sillytavern/types'
import {
  SYSTEM_LOREBOOK_ID,
  SYSTEM_LOREBOOK_NAME,
  buildLiveLoreContent,
} from '@/composables/game-bridge'
import {
  MEM_SHORT_ID,
  MEM_MID_ID,
  MEM_LONG_ID,
  formatShortMemory,
  formatMidMemory,
  formatLongMemory,
  loadMemoryBank,
} from '@/composables/memory-lore'
import {
  ensureMemoryGraphHydrated,
  selectMemoryGraphForTurn,
} from '@/composables/memory-graph'
import { semanticRecall, type SemanticHit } from '@/composables/memory-embed'
import type { ApiSettings } from '@/sillytavern/types'
import { saveLorebook, getLorebooks } from '@/sillytavern/database'

const LIVE_ENTRY_ID = 'live-snapshot'
const MEM_GRAPH_ID = 'mem-graph-beats'
/** 旧表格世界状态 / 召回 entry，写入时剔除，不再注入 */
const LEGACY_TABLE_ENTRY_IDS = new Set([
  'table-world-state',
  'table-memory-recall',
])

const SYSTEM_ENTRY_IDS = new Set([
  LIVE_ENTRY_ID,
  MEM_SHORT_ID,
  MEM_MID_ID,
  MEM_LONG_ID,
  MEM_GRAPH_ID,
  ...LEGACY_TABLE_ENTRY_IDS,
])

function makeEntry(
  id: string,
  content: string,
  comment: string,
  order: number,
): LorebookEntry {
  return {
    id,
    keys: ['宗门', '实况', '气数', '记忆', '掌门'],
    secondaryKeys: [],
    content,
    comment,
    order,
    position: 'before_char',
    selective: false,
    selectiveLogic: 'and_any',
    constant: true,
    probability: 100,
    useProbability: false,
    addMemo: true,
  }
}

function buildSystemEntries(extra?: {
  contextLabel?: string | null
  contextDetail?: string | null
  tableMemoryEnabled?: boolean
  recallQuery?: string | null
  recallCodes?: string[] | null
  semanticHits?: SemanticHit[]
  currentYear?: number
}): LorebookEntry[] {
  loadMemoryBank()
  const entries: LorebookEntry[] = [
    makeEntry(LIVE_ENTRY_ID, buildLiveLoreContent(extra), '系统自动 · 局面快照', 0),
    makeEntry(MEM_SHORT_ID, formatShortMemory(), '系统自动 · 短期记忆', 1),
    makeEntry(MEM_MID_ID, formatMidMemory(), '系统自动 · 中期记忆', 2),
    makeEntry(MEM_LONG_ID, formatLongMemory(), '系统自动 · 长期记忆', 3),
  ]
  // 唯一记忆主路径：角色图谱规则选取 + 冷档案闪回（零强制 API）
  const graph = ensureMemoryGraphHydrated()
  const graphParts: string[] = []
  if (graph.nodes.length) {
    const q = [extra?.contextLabel, extra?.contextDetail, extra?.recallQuery]
      .filter(Boolean)
      .join('\n')
    const sel = selectMemoryGraphForTurn({
      graph,
      query: q,
      maxNodes: 6,
      maxChars: 2200,
      currentYear: extra?.currentYear,
      flashbackTopK: 8,
    })
    if (sel.text.trim()) graphParts.push(sel.text)
  }
  if (extra?.semanticHits?.length) {
    const semLines = extra.semanticHits.map(
      (h) => `· ${h.nodeName}：${h.text}${h.year ? `（${h.year}年${h.season || ''}）` : ''}`,
    )
    graphParts.push(`【语义补充】\n${semLines.join('\n')}`)
  }
  if (graphParts.length) {
    const combined = graphParts.join('\n').slice(0, 2400)
    entries.push(
      makeEntry(MEM_GRAPH_ID, `【角色记忆图谱】\n${combined}`, '系统自动 · 角色记忆', 3.5),
    )
  } else {
    entries.push(
      makeEntry(
        MEM_GRAPH_ID,
        '【角色记忆图谱】\n（暂无命中节点。通灵写入角色近事或侧栏「角色记忆」从档案刷新后会生长。）',
        '系统自动 · 角色记忆',
        3.5,
      ),
    )
  }
  return entries
}

export async function ensureAndRefreshSystemLorebook(extra?: {
  contextLabel?: string | null
  contextDetail?: string | null
  tableMemoryEnabled?: boolean
  recallQuery?: string | null
  recallCodes?: string[] | null
  memoryRecallMode?: 'keyword' | 'embedding' | 'both'
  api?: ApiSettings
  currentYear?: number
}): Promise<Lorebook> {
  // 语义召回（embedding / both 模式）
  let semanticHits: SemanticHit[] = []
  const mode = extra?.memoryRecallMode || 'keyword'
  if ((mode === 'embedding' || mode === 'both') && extra?.api) {
    const query = extra.contextLabel || extra.recallQuery || ''
    if (query.trim()) {
      semanticHits = await semanticRecall(extra.api, query, 6).catch(() => [])
    }
  }

  let currentYear = extra?.currentYear
  if (currentYear == null) {
    try {
      const { useGameState } = await import('@/composables/useGameState')
      currentYear = Number(useGameState().calendar.year) || undefined
    } catch {
      currentYear = undefined
    }
  }

  const systemEntries = buildSystemEntries({ ...extra, semanticHits, currentYear })
  const all = await getLorebooks()
  const existing = all.find((b) => b.id === SYSTEM_LOREBOOK_ID)
  const now = Date.now()

  if (!existing) {
    const book: Lorebook = {
      id: SYSTEM_LOREBOOK_ID,
      name: SYSTEM_LOREBOOK_NAME,
      description:
        '由游戏状态自动生成：局面快照 + 短/中/长期记忆 + 角色记忆图谱。常驻注入，请保持启用。',
      entries: systemEntries,
      recursiveScanning: false,
      caseSensitive: false,
      matchWholeWords: false,
      createdAt: now,
      updatedAt: now,
    }
    await saveLorebook(book)
    return book
  }

  const userEntries = existing.entries.filter((e) => !SYSTEM_ENTRY_IDS.has(e.id))
  const next: Lorebook = {
    ...existing,
    name: SYSTEM_LOREBOOK_NAME,
    description:
      '由游戏状态自动生成：局面快照 + 短/中/长期记忆 + 角色记忆图谱。常驻注入，请保持启用。',
    entries: [...systemEntries, ...userEntries],
    updatedAt: now,
  }
  await saveLorebook(next)
  return next
}
