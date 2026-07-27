/**
 * 系统世界书「宗门实况」
 * 定稿分层：Boot 锚 + L2 摘要（历史靠前 / 近端贴后）+ L1 图谱 + 可选 L3 语义
 */
import type { Lorebook, LorebookEntry, ApiSettings } from '@/sillytavern/types'
import {
  SYSTEM_LOREBOOK_ID,
  SYSTEM_LOREBOOK_NAME,
  buildLiveLoreContent,
} from '@/composables/game-bridge'
import {
  MEM_SHORT_ID,
  MEM_MID_ID,
  MEM_LONG_ID,
  formatHistoryMemoryBlock,
  formatRecentMemoryBlock,
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
import { saveLorebook, getLorebooks } from '@/sillytavern/database'

const LIVE_ENTRY_ID = 'live-snapshot'
const MEM_BOOT_ID = 'mem-boot-anchor'
const MEM_HISTORY_ID = 'mem-history-dir'
const MEM_RECENT_ID = 'mem-recent-sum'
const MEM_GRAPH_ID = 'mem-graph-beats'

/** 旧 entry id：刷新时剔除，避免残留表 dump / 单槽摘要 */
const LEGACY_ENTRY_IDS = new Set([
  'table-world-state',
  'table-memory-recall',
  MEM_SHORT_ID,
  MEM_MID_ID,
  MEM_LONG_ID,
])

const SYSTEM_ENTRY_IDS = new Set([
  LIVE_ENTRY_ID,
  MEM_BOOT_ID,
  MEM_HISTORY_ID,
  MEM_RECENT_ID,
  MEM_GRAPH_ID,
  ...LEGACY_ENTRY_IDS,
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

/** P1 Boot：固定人格/局面锚（学 Nocturne system://boot 思想，本地拼装） */
async function buildBootAnchorAsync(extra?: {
  contextLabel?: string | null
  contextDetail?: string | null
}): Promise<string> {
  const lines: string[] = ['【记忆锚 · Boot】']
  try {
    const { snapshotGameVariables } = await import('@/composables/game-bridge')
    const snap = snapshotGameVariables()
    lines.push(
      `你是推演「${snap['宗门'] || '宗门'}」叙事的天机；掌门为${snap['掌门'] || '（未名）'}。`,
    )
    lines.push(
      `历法锚点：天元 ${snap['年']} 年 ${snap['季']}。难度：${snap['难度'] || '—'}。`,
    )
  } catch {
    lines.push('你是宗门经营互动叙事的天机推演；以系统实况与角色记忆为准。')
  }
  if (extra?.contextLabel) {
    lines.push(
      `当前事务：${extra.contextLabel}${
        extra.contextDetail ? ` — ${extra.contextDetail}` : ''
      }`,
    )
  }
  lines.push(
    '只把下列记忆当背景，勿复述清单；人物行动与关系变化须写 <memory>，回合小结写 <sum>。',
  )
  return lines.join('\n')
}

function buildSystemEntriesSync(
  extra?: {
    contextLabel?: string | null
    contextDetail?: string | null
    recallQuery?: string | null
    currentYear?: number
    rosterNames?: string[]
    semanticHits?: SemanticHit[]
    bootText?: string
  },
): LorebookEntry[] {
  loadMemoryBank()
  const roster = extra?.rosterNames || []
  const graph = ensureMemoryGraphHydrated(roster.length ? roster : undefined)

  // P2 双槽：历史目录靠前(order 0.5) · 近端短期靠后贴近图谱
  const history = formatHistoryMemoryBlock(undefined, 1100)
  const recent = formatRecentMemoryBlock(undefined, 700)

  const entries: LorebookEntry[] = [
    makeEntry(LIVE_ENTRY_ID, buildLiveLoreContent(extra), '系统自动 · 局面快照', 0),
    makeEntry(
      MEM_BOOT_ID,
      extra?.bootText ||
        '【记忆锚 · Boot】\n以系统实况与角色记忆为准；须输出 <sum> 与必要时的 <memory>。',
      '系统自动 · 记忆锚',
      0.3,
    ),
    makeEntry(MEM_HISTORY_ID, history, '系统自动 · 长线摘要', 0.5),
    makeEntry(MEM_RECENT_ID, recent, '系统自动 · 近端小结', 3.2),
  ]

  // 兼容旧测试/展示：仍可单独 formatShort/Mid/Long（不注入三槽重复）
  void formatShortMemory
  void formatMidMemory
  void formatLongMemory

  const graphParts: string[] = []
  if (graph.nodes.length) {
    const q = [extra?.contextLabel, extra?.contextDetail, extra?.recallQuery]
      .filter(Boolean)
      .join('\n')
    const sel = selectMemoryGraphForTurn({
      graph,
      query: q,
      rosterNames: roster,
      maxNodes: 6,
      maxChars: 2200,
      currentYear: extra?.currentYear,
      flashbackTopK: 8,
    })
    if (sel.text.trim()) graphParts.push(sel.text)
  }
  if (extra?.semanticHits?.length) {
    const semLines = extra.semanticHits.map(
      (h) =>
        `· ${h.nodeName}：${h.text}${h.year ? `（${h.year}年${h.season || ''}）` : ''}`,
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
        '【角色记忆图谱】\n（暂无命中。通灵写 <memory>，或正文出现名册人名时会兜底生长；侧栏「角色记忆」可手改。）',
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
  recallQuery?: string | null
  recallCodes?: string[] | null
  currentYear?: number
  rosterNames?: string[]
  /** keyword | embedding | both；默认 keyword */
  memoryRecallMode?: 'keyword' | 'embedding' | 'both'
  api?: ApiSettings
  embeddingModel?: string
  /** VPS 记忆服务（可选 · 失败忽略） */
  memoryServerUrl?: string
  memoryServerToken?: string
}): Promise<Lorebook> {
  let currentYear = extra?.currentYear
  let roster = extra?.rosterNames || []
  if (currentYear == null || !roster.length) {
    try {
      const { useGameState } = await import('@/composables/useGameState')
      const gs = useGameState()
      if (currentYear == null) currentYear = Number(gs.calendar.year) || undefined
      if (!roster.length) {
        roster = [
          ...gs.disciples.value.map((d) => d.name),
          String(gs.masterName.value || ''),
        ].filter(Boolean)
      }
    } catch {
      /* ignore */
    }
  }

  // L3 语义
  let semanticHits: SemanticHit[] = []
  const mode = extra?.memoryRecallMode || 'keyword'
  if ((mode === 'embedding' || mode === 'both') && extra?.api) {
    const query =
      [extra.recallQuery, extra.contextLabel, extra.contextDetail].filter(Boolean).join('\n') ||
      ''
    if (query.trim()) {
      semanticHits = await semanticRecall(
        extra.api,
        query,
        6,
        extra.embeddingModel,
      ).catch(() => [])
    }
  }

  // L3 VPS：可选拉取一段补充文本（约定 GET ?q=）
  let vpsExtra = ''
  const server = (extra?.memoryServerUrl || '').trim().replace(/\/$/, '')
  if (server) {
    try {
      const q = encodeURIComponent(
        [extra?.recallQuery, extra?.contextLabel].filter(Boolean).join(' ').slice(0, 200),
      )
      const headers: Record<string, string> = {}
      if (extra?.memoryServerToken) {
        headers.Authorization = `Bearer ${extra.memoryServerToken}`
      }
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), 8000)
      const res = await fetch(`${server}/memory/search?q=${q}&limit=5`, {
        headers,
        signal: ac.signal,
      }).catch(() => null)
      clearTimeout(timer)
      if (res?.ok) {
        const data = await res.json().catch(() => null)
        if (typeof data?.text === 'string' && data.text.trim()) {
          vpsExtra = data.text.trim().slice(0, 1200)
        } else if (Array.isArray(data?.items)) {
          vpsExtra = data.items
            .map((it: { text?: string; title?: string }) => `· ${it.title || ''} ${it.text || ''}`.trim())
            .filter(Boolean)
            .join('\n')
            .slice(0, 1200)
        }
      }
    } catch {
      /* VPS 失败静默 */
    }
  }

  const bootText = await buildBootAnchorAsync(extra)
  const systemEntries = buildSystemEntriesSync({
    ...extra,
    currentYear,
    rosterNames: roster,
    semanticHits,
    bootText,
  })
  if (vpsExtra) {
    systemEntries.push(
      makeEntry(
        'mem-vps-extra',
        `【外置记忆补充】\n${vpsExtra}`,
        '系统自动 · VPS 记忆',
        3.6,
      ),
    )
  }

  const all = await getLorebooks()
  const existing = all.find((b) => b.id === SYSTEM_LOREBOOK_ID)
  const now = Date.now()
  const desc =
    '局面快照 + Boot 锚 + 长线/近端摘要 + 角色记忆图谱（可选语义/VPS）。常驻注入。'

  if (!existing) {
    const book: Lorebook = {
      id: SYSTEM_LOREBOOK_ID,
      name: SYSTEM_LOREBOOK_NAME,
      description: desc,
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

  const dropIds = new Set([...SYSTEM_ENTRY_IDS, 'mem-vps-extra'])
  const userEntries = existing.entries.filter((e) => !dropIds.has(e.id))
  const next: Lorebook = {
    ...existing,
    name: SYSTEM_LOREBOOK_NAME,
    description: desc,
    entries: [...systemEntries, ...userEntries],
    updatedAt: now,
  }
  await saveLorebook(next)
  return next
}
