/**
 * 系统世界书「宗门实况」— 局面快照 + 短/中/长期记忆（constant 常驻）
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
import { saveLorebook, getLorebooks } from '@/sillytavern/database'

const LIVE_ENTRY_ID = 'live-snapshot'

const SYSTEM_ENTRY_IDS = new Set([
  LIVE_ENTRY_ID,
  MEM_SHORT_ID,
  MEM_MID_ID,
  MEM_LONG_ID,
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
}): LorebookEntry[] {
  loadMemoryBank()
  return [
    makeEntry(LIVE_ENTRY_ID, buildLiveLoreContent(extra), '系统自动 · 局面快照', 0),
    makeEntry(MEM_SHORT_ID, formatShortMemory(), '系统自动 · 短期记忆', 1),
    makeEntry(MEM_MID_ID, formatMidMemory(), '系统自动 · 中期记忆', 2),
    makeEntry(MEM_LONG_ID, formatLongMemory(), '系统自动 · 长期记忆', 3),
  ]
}

export async function ensureAndRefreshSystemLorebook(extra?: {
  contextLabel?: string | null
  contextDetail?: string | null
}): Promise<Lorebook> {
  const systemEntries = buildSystemEntries(extra)
  const all = await getLorebooks()
  const existing = all.find((b) => b.id === SYSTEM_LOREBOOK_ID)
  const now = Date.now()

  if (!existing) {
    const book: Lorebook = {
      id: SYSTEM_LOREBOOK_ID,
      name: SYSTEM_LOREBOOK_NAME,
      description:
        '由游戏状态自动生成：局面快照 + 短/中/长期记忆。常驻注入，请保持启用。',
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
      '由游戏状态自动生成：局面快照 + 短/中/长期记忆。常驻注入，请保持启用。',
    entries: [...systemEntries, ...userEntries],
    updatedAt: now,
  }
  await saveLorebook(next)
  return next
}
