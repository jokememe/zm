/**
 * IndexedDB Database Layer (project-scoped)
 */

import Dexie, { type Table } from 'dexie';
import type { Lorebook, ChatPreset, AppSettings, ChatSession } from './types';
import { DEFAULT_SETTINGS } from './types';
import {
  ST_APP_ID,
  ST_DB_NAME,
  ST_DB_VERSION,
  getStorageIdentity,
  isLegacySharedDbName,
  type StorageIdentity,
} from './storage-config';

export {
  ST_APP_ID,
  ST_DB_NAME,
  ST_DB_VERSION,
  getStorageIdentity,
  findLegacySharedDatabases,
  listOriginDatabases,
  isLegacySharedDbName,
} from './storage-config';

export type { StorageIdentity };

const DB_NAME = ST_DB_NAME;
const DB_VERSION = ST_DB_VERSION;

if (isLegacySharedDbName(DB_NAME)) {
  throw new Error(
    `[SillyTavern] Refusing to open legacy shared DB name "${DB_NAME}". ` +
      `Set a unique ST_APP_ID in storage-config.ts.`,
  );
}

class AppDatabase extends Dexie {
  lorebooks!: Table<Lorebook>;
  presets!: Table<ChatPreset>;
  settings!: Table<AppSettings>;
  chats!: Table<ChatSession>;

  constructor(name: string = DB_NAME) {
    if (isLegacySharedDbName(name)) {
      throw new Error(`[SillyTavern] Blocked open of legacy shared database: ${name}`);
    }
    super(name);
    this.version(1).stores({
      lorebooks: 'id, name, updatedAt',
      presets: 'id, name, updatedAt',
      settings: 'key',
      chats: 'id, name, updatedAt',
    });
    this.version(2).stores({
      lorebooks: 'id, name, updatedAt',
      presets: 'id, name, updatedAt',
      settings: 'key',
      chats: 'id, name, updatedAt',
    });
    this.version(3)
      .stores({
        lorebooks: 'id, name, updatedAt',
        presets: 'id, name, updatedAt',
        settings: 'key',
        chats: 'id, name, updatedAt',
      })
      .upgrade(async (tx) => {
        const settings = await tx.table('settings').toCollection().toArray();
        for (const s of settings) {
          if (s.uiMode === undefined) s.uiMode = 'game';
          if (s.customTags === undefined) {
            s.customTags = ['maintext', 'option', 'sum', 'vars', 'thinking', 'think'];
          }
          if (s.thinkingDisplay === undefined) s.thinkingDisplay = 'fold';
          if (s.formatPromptTemplate === undefined) s.formatPromptTemplate = '';
          if (s.api && s.api.secondary === undefined) {
            s.api.secondary = { enabled: false, baseUrl: '', apiKey: '', model: '' };
          }
          await tx.table('settings').put(s);
        }
      });
  }
}

let dbInstance: AppDatabase | null = null;

export function getDatabase(): AppDatabase {
  if (!dbInstance) {
    dbInstance = new AppDatabase(DB_NAME);
  }
  return dbInstance;
}

/** Current storage identity (for UI / diagnostics). */
export function getActiveStorageInfo(): StorageIdentity {
  return getStorageIdentity();
}

export async function initializeDatabase(): Promise<void> {
  const db = getDatabase();

  const presetCount = await db.presets.count();
  if (presetCount === 0) {
    const { createDefaultPreset } = await import('./types');
    const defaultPreset = createDefaultPreset();
    await db.presets.add({
      ...defaultPreset,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as ChatPreset);
  }

  const settingsCount = await db.settings.count();
  if (settingsCount === 0) {
    await db.settings.put({ ...DEFAULT_SETTINGS, key: 'settings' });
  }
}

export async function clearAllData(): Promise<void> {
  const db = getDatabase();
  await db.delete();
  dbInstance = null;
}

export interface FullBackup {
  /** Backup format version (store schema). */
  version: number;
  /** Which app produced this backup. */
  appId: string;
  /** Exact IndexedDB name at export time. */
  dbName: string;
  exportedAt: number;
  lorebooks: Lorebook[];
  presets: ChatPreset[];
  settings: AppSettings[];
  chats: ChatSession[];
}

export async function exportAllData(): Promise<FullBackup> {
  const db = getDatabase();
  const identity = getStorageIdentity();
  const [lorebooks, presets, settings, chats] = await Promise.all([
    db.lorebooks.toArray(),
    db.presets.toArray(),
    db.settings.toArray(),
    db.chats.toArray(),
  ]);
  return {
    version: DB_VERSION,
    appId: identity.appId,
    dbName: identity.dbName,
    exportedAt: Date.now(),
    lorebooks,
    presets,
    settings,
    chats,
  };
}

export interface ImportBackupOptions {
  /**
   * When backup.appId is present and differs from this app, require explicit
   * confirmation via this flag. Defaults to false (reject cross-app).
   */
  allowCrossApp?: boolean;
}

export async function importAllData(
  backup: FullBackup,
  options: ImportBackupOptions = {},
): Promise<void> {
  if (!backup || typeof backup !== 'object') {
    throw new Error('备份格式无效');
  }

  const sourceAppId =
    typeof backup.appId === 'string' && backup.appId.trim()
      ? backup.appId.trim()
      : null;

  if (sourceAppId && sourceAppId !== ST_APP_ID && !options.allowCrossApp) {
    throw new Error(
      `备份来自其他应用「${sourceAppId}」，当前为「${ST_APP_ID}」。` +
        `若确认要导入，请勾选允许跨应用恢复。`,
    );
  }

  // Legacy backups without appId are allowed (user-exported lore may be portable)
  // but never bind to a legacy shared DB name on this machine.
  if (backup.dbName && isLegacySharedDbName(backup.dbName) && !options.allowCrossApp) {
    throw new Error(
      `备份标记了共享库名「${backup.dbName}」（多项目易串数据）。` +
        `确认后可勾选允许跨应用恢复再导入。`,
    );
  }

  const db = getDatabase();
  await db.transaction('rw', db.lorebooks, db.presets, db.settings, db.chats, async () => {
    await db.lorebooks.clear();
    await db.presets.clear();
    await db.settings.clear();
    await db.chats.clear();
    if (Array.isArray(backup.lorebooks)) await db.lorebooks.bulkPut(backup.lorebooks);
    if (Array.isArray(backup.presets)) await db.presets.bulkPut(backup.presets);
    if (Array.isArray(backup.settings)) await db.settings.bulkPut(backup.settings);
    if (Array.isArray(backup.chats)) await db.chats.bulkPut(backup.chats);
  });
}

/**
 * IndexedDB 只能存 structured-clone 友好数据。
 * Vue reactive / Proxy / 嵌套 Ref 会触发 DataCloneError（如 Array could not be cloned）。
 */
function toPlain<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T
  } catch (e) {
    console.error('[IndexedDB] toPlain failed', e)
    throw e
  }
}

export async function getLorebooks(): Promise<Lorebook[]> {
  return getDatabase().lorebooks.toArray();
}

export async function saveLorebook(lorebook: Lorebook): Promise<string> {
  const plain = toPlain(lorebook)
  await getDatabase().lorebooks.put(plain);
  return plain.id;
}

export async function deleteLorebook(id: string): Promise<void> {
  await getDatabase().lorebooks.delete(id);
}

export async function getPresets(): Promise<ChatPreset[]> {
  return getDatabase().presets.toArray();
}

export async function savePreset(preset: ChatPreset): Promise<string> {
  const plain = toPlain(preset)
  await getDatabase().presets.put(plain);
  return plain.id;
}

export async function deletePreset(id: string): Promise<void> {
  await getDatabase().presets.delete(id);
}

export async function getSettings(): Promise<AppSettings | undefined> {
  const all = await getDatabase().settings.toArray();
  const s = all[0];
  if (!s) return undefined;
  if (s.settlementMode === undefined) {
    s.settlementMode = 'secondary_then_primary';
  }
  if (s.historyKeepMessages === undefined || !Number.isFinite(s.historyKeepMessages)) {
    s.historyKeepMessages = 12;
  } else {
    s.historyKeepMessages = Math.max(0, Math.min(200, Math.round(Number(s.historyKeepMessages))));
  }
  if (s.tableMemoryEnabled === undefined) s.tableMemoryEnabled = true;
  if (s.historyCompress === undefined) s.historyCompress = true;
  if (s.historyMaxTokens === undefined || !Number.isFinite(s.historyMaxTokens)) {
    s.historyMaxTokens = 12000;
  } else {
    s.historyMaxTokens = Math.max(0, Math.min(500_000, Math.round(Number(s.historyMaxTokens))));
  }
  return s;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const plain = toPlain({ ...settings, key: 'settings' as const })
  await getDatabase().settings.put(plain);
}

export async function getChats(): Promise<ChatSession[]> {
  return getDatabase().chats.toArray();
}

export async function saveChat(chat: ChatSession): Promise<string> {
  const plain = toPlain(chat)
  await getDatabase().chats.put(plain);
  return plain.id;
}

export async function deleteChat(id: string): Promise<void> {
  await getDatabase().chats.delete(id);
}

export async function setVariables(chatId: string, variables: Record<string, any>): Promise<void> {
  const db = getDatabase();
  const chat = await db.chats.get(chatId);
  if (!chat) return;
  chat.variables = toPlain(variables);
  chat.updatedAt = Date.now();
  await db.chats.put(toPlain(chat));
}
