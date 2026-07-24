/**
 * 整包备份：IndexedDB（天机）+ localStorage（经营/记忆）。
 *
 * 失败点教训：
 * - 旧导出只有 IDB → main→beta 无弟子/资源
 * - 导入后只 reload 预设，不 reboot 会话 → 卷宗仍是旧内存
 * - hydrate 失败仍 toast「成功」
 * - 导出时 openingDone=false 导致 persist 跳过 → gameSave 空
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

/**
 * 导出前强制把 live 经营态写入 localStorage，并返回 gameSave 对象。
 * 即使 openingDone 为 false（界面卡在开场），只要有资源/弟子 live 态也会落盘。
 */
export async function forceCaptureGameForExport(): Promise<{
  gameSave: GameSaveV1 | null
  localState: LocalBackupState
  persisted: boolean
}> {
  let gameSave: GameSaveV1 | null = null
  let persisted = false
  try {
    const { useGameState } = await import('@/composables/useGameState')
    const gs = useGameState()
    // 强制落盘（无视 openingDone）
    try {
      persisted = gs.forcePersistForBackup()
    } catch {
      persisted = false
    }
    try {
      const { loadGameSaveFromStorage } = await import('@/composables/game-save')
      gameSave = loadGameSaveFromStorage()
    } catch {
      gameSave = null
    }
  } catch (e) {
    console.warn('[备份] forceCaptureGameForExport', e)
  }

  const localState = collectLocalBackupState()
  if (!gameSave && localState[GAME_SAVE_KEY]) {
    try {
      gameSave = parseGameSave(JSON.parse(localState[GAME_SAVE_KEY]!))
    } catch {
      /* ignore */
    }
  }
  if (gameSave) {
    localState[GAME_SAVE_KEY] = JSON.stringify(gameSave)
    localState[OPENING_STORAGE_KEY] = 'done'
  }
  return { gameSave, localState, persisted }
}

/** 从备份 localState 或顶层 gameSave 抽出可解析的经营档 */
export function extractGameSaveFromBackup(backup: {
  localState?: LocalBackupState | Record<string, string> | null
  gameSave?: unknown
  [key: string]: unknown
}): GameSaveV1 | null {
  if (backup.gameSave != null) {
    // gameSave 可能是对象，也可能是 JSON 字符串
    if (typeof backup.gameSave === 'string') {
      try {
        const g = parseGameSave(JSON.parse(backup.gameSave))
        if (g) return g
      } catch {
        /* fall through */
      }
    } else {
      const g = parseGameSave(backup.gameSave)
      if (g) return g
    }
  }
  const ls = backup.localState
  if (ls && typeof ls === 'object') {
    const raw = (ls as Record<string, string>)[GAME_SAVE_KEY]
    if (raw) {
      try {
        const g = parseGameSave(typeof raw === 'string' ? JSON.parse(raw) : raw)
        if (g) return g
      } catch {
        /* fall through */
      }
    }
  }
  // 纯经营 JSON（用户只拷了 zongmen-game-v1）
  const asSave = parseGameSave(backup)
  if (asSave) return asSave
  return null
}

export interface ApplyLocalBackupResult {
  keysWritten: string[]
  gameSave: GameSaveV1 | null
  openingMarked: boolean
  hydrateOk: boolean
  error?: string
}

/**
 * 把备份中的 local 切片写回 storage，并刷新内存中的记忆/表/经营态。
 */
export function applyLocalBackupState(
  local: LocalBackupState | Record<string, string> | null | undefined,
  opts?: {
    storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
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

  return {
    keysWritten,
    gameSave,
    openingMarked,
    hydrateOk: false,
  }
}

/**
 * 导入后同步经营 live 状态（必须成功才算经营导入成功）。
 */
export async function hydrateGameAfterBackupImport(): Promise<boolean> {
  try {
    const { useGameState } = await import('@/composables/useGameState')
    const gs = useGameState()
    // 备份导入：以档为准，不 merge 种子（否则弟子册可能被旧 live 干扰体感）
    const ok = gs.hydrateFromSave({ mergeSparse: false })
    if (!ok) {
      console.warn('[备份] hydrateFromSave 返回 false（localStorage 无有效经营档）')
    }
    return ok
  } catch (e) {
    console.warn('[备份] 经营态 hydrate 失败', e)
    return false
  }
}

/**
 * 导入后强制重载天机会话（reloadStMeta 不会换 chat 消息）。
 */
export async function rebootTianjiAfterBackupImport(): Promise<boolean> {
  try {
    const { useTianji } = await import('@/composables/useTianji')
    const tj = useTianji()
    await tj.forceRebootFromDb()
    return true
  } catch (e) {
    console.warn('[备份] 天机 reboot 失败', e)
    return false
  }
}

export interface FullImportLocalResult {
  gameHydrated: boolean
  tianjiRebooted: boolean
  hasGameSave: boolean
  discipleCount: number
  keysWritten: string[]
  errors: string[]
}

/** 应用 local 切片 + hydrate 经营 + reboot 天机 */
export async function finishBackupImportSideEffects(backup: {
  localState?: LocalBackupState | Record<string, string> | null
  gameSave?: unknown
}): Promise<FullImportLocalResult> {
  const errors: string[] = []
  const applied = applyLocalBackupState(backup.localState || {}, {
    gameSave: backup.gameSave,
  })
  const hasGameSave = !!applied.gameSave
  let gameHydrated = false
  if (hasGameSave) {
    gameHydrated = await hydrateGameAfterBackupImport()
    if (!gameHydrated) errors.push('经营档已写入存储，但界面 hydrate 失败')
  }
  let tianjiRebooted = false
  try {
    tianjiRebooted = await rebootTianjiAfterBackupImport()
    if (!tianjiRebooted) errors.push('天机会话未能从库重载')
  } catch (e) {
    errors.push(`天机重载异常: ${(e as Error).message || e}`)
  }
  return {
    gameHydrated,
    tianjiRebooted,
    hasGameSave,
    discipleCount: applied.gameSave?.disciples?.length ?? 0,
    keysWritten: applied.keysWritten,
    errors,
  }
}
