/**
 * 整包备份里的 localStorage 切片。
 *
 * 历史问题：密匣「导出备份」只含 IndexedDB（预设/会话/设置），
 * 经营进度、开局标记、表格记忆、短中长期记忆在 localStorage。
 * main 与 beta 不同域名时，只导 IDB → beta 导入后像「读不了存档」。
 */
import {
  OPENING_STORAGE_KEY,
  IDENTITY_STORAGE_KEY,
  MEMORY_STORAGE_KEY,
  TABLE_MEMORY_STORAGE_KEY,
} from '@/data/opening'
import { API_CACHE_KEY } from '@/composables/api-cache'
import {
  GAME_SAVE_KEY,
  parseGameSave,
  writeGameSaveToStorage,
  type GameSaveV1,
} from '@/composables/game-save'
import { loadMemoryBank } from '@/composables/memory-lore'
import { loadTableMemory } from '@/composables/table-memory'

/** 会打进备份的 localStorage 键（值一律存原始字符串） */
export const LOCAL_BACKUP_KEYS = [
  GAME_SAVE_KEY,
  OPENING_STORAGE_KEY,
  IDENTITY_STORAGE_KEY,
  MEMORY_STORAGE_KEY,
  TABLE_MEMORY_STORAGE_KEY,
  API_CACHE_KEY,
] as const

export type LocalBackupKey = (typeof LOCAL_BACKUP_KEYS)[number]

export type LocalBackupState = Partial<Record<LocalBackupKey, string>>

export function collectLocalBackupState(
  storage: Pick<Storage, 'getItem'> | null = typeof localStorage !== 'undefined'
    ? localStorage
    : null,
): LocalBackupState {
  const out: LocalBackupState = {}
  if (!storage) return out
  for (const key of LOCAL_BACKUP_KEYS) {
    try {
      const v = storage.getItem(key)
      if (v != null && v !== '') out[key] = v
    } catch {
      /* ignore */
    }
  }
  return out
}

/** 从备份 localState 或顶层 gameSave 抽出可解析的经营档 */
export function extractGameSaveFromBackup(backup: {
  localState?: LocalBackupState | Record<string, string> | null
  gameSave?: unknown
}): GameSaveV1 | null {
  if (backup.gameSave) {
    const g = parseGameSave(backup.gameSave)
    if (g) return g
  }
  const ls = backup.localState
  if (ls && typeof ls === 'object') {
    const raw = (ls as Record<string, string>)[GAME_SAVE_KEY]
    if (raw) {
      try {
        return parseGameSave(JSON.parse(raw))
      } catch {
        /* fall through */
      }
    }
  }
  // 纯经营 JSON（用户只拷了 zongmen-game-v1）
  const asSave = parseGameSave(backup as unknown)
  if (asSave) return asSave
  return null
}

export interface ApplyLocalBackupResult {
  keysWritten: string[]
  gameSave: GameSaveV1 | null
  /** 是否已写入开局完成标记 */
  openingMarked: boolean
}

/**
 * 把备份中的 local 切片写回 storage，并刷新内存中的记忆/表状态。
 * 不直接动 Vue 经营 ref —— 调用方再 hydrateFromSave。
 */
export function applyLocalBackupState(
  local: LocalBackupState | Record<string, string> | null | undefined,
  opts?: {
    storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
    /** 额外的经营对象（优先于 local 内字符串） */
    gameSave?: unknown
  },
): ApplyLocalBackupResult {
  const storage =
    opts?.storage !== undefined
      ? opts.storage
      : typeof localStorage !== 'undefined'
        ? localStorage
        : null

  const keysWritten: string[] = []
  if (storage && local && typeof local === 'object') {
    for (const key of LOCAL_BACKUP_KEYS) {
      const v = (local as Record<string, string>)[key]
      if (typeof v !== 'string') continue
      try {
        storage.setItem(key, v)
        keysWritten.push(key)
      } catch {
        /* ignore quota */
      }
    }
  }

  // 顶层 gameSave 覆盖/补写经营档
  let gameSave = extractGameSaveFromBackup({
    localState: local,
    gameSave: opts?.gameSave,
  })
  if (gameSave && storage) {
    writeGameSaveToStorage(gameSave, storage)
    if (!keysWritten.includes(GAME_SAVE_KEY)) keysWritten.push(GAME_SAVE_KEY)
  } else if (gameSave) {
    writeGameSaveToStorage(gameSave)
  }

  // 有经营档则保证开局标记为 done，否则 beta 启动不 hydrate
  let openingMarked = false
  if (gameSave && storage) {
    try {
      storage.setItem(OPENING_STORAGE_KEY, 'done')
      openingMarked = true
      if (!keysWritten.includes(OPENING_STORAGE_KEY)) {
        keysWritten.push(OPENING_STORAGE_KEY)
      }
    } catch {
      /* ignore */
    }
  }

  // 刷新模块内缓存
  try {
    loadMemoryBank()
  } catch {
    /* ignore */
  }
  try {
    loadTableMemory()
  } catch {
    /* ignore */
  }

  return { keysWritten, gameSave, openingMarked }
}

/**
 * 导入后把经营 live 状态与存档对齐（依赖 useGameState 单例）。
 */
export async function hydrateGameAfterBackupImport(): Promise<boolean> {
  try {
    const { useGameState } = await import('@/composables/useGameState')
    const gs = useGameState()
    return gs.hydrateFromSave()
  } catch (e) {
    console.warn('[备份] 经营态 hydrate 失败', e)
    return false
  }
}
