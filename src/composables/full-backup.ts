/**
 * 整包备份：IndexedDB（天机）+ localStorage（经营/记忆）。
 *
 * 可靠契约：
 * - 导出：forcePersistForBackup() 返回的对象 **直接** 写入 JSON.gameSave
 * - 导入：先写 localStorage，再 hydrate，再整页刷新（避免内存半旧）
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

/** 会打进备份的 localStorage 键 */
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
 * 导出前强制 capture live 经营态。
 * gameSave 以 forcePersist 返回值为准（不依赖再读 storage）。
 */
export async function forceCaptureGameForExport(): Promise<{
  gameSave: GameSaveV1 | null
  localState: LocalBackupState
  persisted: boolean
  liveDiscipleCount: number
}> {
  let gameSave: GameSaveV1 | null = null
  let persisted = false
  let liveDiscipleCount = 0
  try {
    const { useGameState } = await import('@/composables/useGameState')
    const gs = useGameState()
    liveDiscipleCount = gs.liveDiscipleCount?.() ?? 0
    // 直接拿返回值，禁止只信 storage 再读
    const saved = gs.forcePersistForBackup()
    if (saved) {
      gameSave = saved
      persisted = true
    }
  } catch (e) {
    console.warn('[备份] forceCaptureGameForExport', e)
  }

  // 兜底：内存 capture 失败时读已有 localStorage
  if (!gameSave) {
    try {
      const { loadGameSaveFromStorage } = await import('@/composables/game-save')
      gameSave = loadGameSaveFromStorage()
    } catch {
      gameSave = null
    }
  }

  const localState = collectLocalBackupState()
  if (gameSave) {
    // 保证 JSON 与 local 切片一致
    localState[GAME_SAVE_KEY] = JSON.stringify(gameSave)
    localState[OPENING_STORAGE_KEY] = 'done'
  } else if (localState[GAME_SAVE_KEY]) {
    try {
      gameSave = parseGameSave(JSON.parse(localState[GAME_SAVE_KEY]!))
    } catch {
      /* ignore */
    }
  }

  return { gameSave, localState, persisted, liveDiscipleCount }
}

/** 从备份抽出可解析的经营档 */
export function extractGameSaveFromBackup(backup: {
  localState?: LocalBackupState | Record<string, string> | null
  gameSave?: unknown
  [key: string]: unknown
}): GameSaveV1 | null {
  if (backup.gameSave != null) {
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
  return parseGameSave(backup)
}

export interface ApplyLocalBackupResult {
  keysWritten: string[]
  gameSave: GameSaveV1 | null
  openingMarked: boolean
}

/**
 * 写回 localStorage 切片。返回解析到的 gameSave。
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

  const gameSave = extractGameSaveFromBackup({
    localState: local,
    gameSave: opts?.gameSave,
  })

  // 顶层 gameSave 优先覆盖（可能比 localState 字符串更新）
  if (gameSave) {
    if (storage) {
      writeGameSaveToStorage(gameSave, storage)
      if (!keysWritten.includes(GAME_SAVE_KEY)) keysWritten.push(GAME_SAVE_KEY)
      try {
        storage.setItem(OPENING_STORAGE_KEY, 'done')
        if (!keysWritten.includes(OPENING_STORAGE_KEY)) {
          keysWritten.push(OPENING_STORAGE_KEY)
        }
      } catch {
        /* ignore */
      }
    } else {
      writeGameSaveToStorage(gameSave)
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
    openingMarked: !!gameSave,
  }
}

export async function hydrateGameAfterBackupImport(): Promise<boolean> {
  try {
    const { useGameState } = await import('@/composables/useGameState')
    const gs = useGameState()
    return gs.hydrateFromSave({ mergeSparse: false })
  } catch (e) {
    console.warn('[备份] 经营态 hydrate 失败', e)
    return false
  }
}

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
  spiritStone: number
  keysWritten: string[]
  errors: string[]
}

/** 应用 local + hydrate 经营 + reboot 天机 */
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
    if (!gameHydrated) {
      errors.push('经营档已写入存储，但界面 hydrate 失败')
    } else {
      // 校验 live 弟子数
      try {
        const { useGameState } = await import('@/composables/useGameState')
        const n = useGameState().liveDiscipleCount()
        const expect = applied.gameSave?.disciples?.length ?? 0
        if (expect > 0 && n !== expect) {
          errors.push(`弟子数不一致：档内 ${expect}，界面 ${n}`)
          gameHydrated = false
        }
      } catch {
        /* ignore */
      }
    }
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
    spiritStone: applied.gameSave?.resources?.spiritStone ?? 0,
    keysWritten: applied.keysWritten,
    errors,
  }
}

/**
 * 纯函数 roundtrip：build → JSON → extract → 校验弟子。
 * 不依赖 Vue / IndexedDB，给测试和导出前自检用。
 */
export function verifyGameSaveRoundtrip(gameSave: unknown): {
  ok: boolean
  discipleCount: number
  spiritStone: number
  error?: string
} {
  const parsed = parseGameSave(gameSave)
  if (!parsed) {
    return { ok: false, discipleCount: 0, spiritStone: 0, error: 'parseGameSave 失败' }
  }
  const again = extractGameSaveFromBackup({ gameSave: parsed })
  if (!again) {
    return { ok: false, discipleCount: 0, spiritStone: 0, error: 'extract 失败' }
  }
  if (again.disciples.length !== parsed.disciples.length) {
    return {
      ok: false,
      discipleCount: again.disciples.length,
      spiritStone: again.resources.spiritStone,
      error: '弟子数 roundtrip 不一致',
    }
  }
  return {
    ok: true,
    discipleCount: again.disciples.length,
    spiritStone: again.resources.spiritStone,
  }
}
