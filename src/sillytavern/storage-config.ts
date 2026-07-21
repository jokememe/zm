/**
 * SillyTavern storage isolation
 *
 * IndexedDB is keyed by **browser origin** (e.g. http://localhost:5173), not by
 * project path. Two Vite apps on the same host:port share one origin. If they
 * open the same DB name (the old template default `SillyTavernWebDB`), settings,
 * lorebooks and chats leak across projects.
 *
 * Rules:
 * 1. Every app MUST use a unique APP_ID (keep in sync with package.json "name").
 * 2. DB name is always derived from APP_ID — never a global constant alone.
 * 3. Never open LEGACY_SHARED_DB_NAMES for read/write in this app.
 * 4. Backups carry appId so import can warn on cross-app restore.
 */

/** Keep identical to package.json `"name"`. */
export const ST_APP_ID = 'zongmen-revival' as const;

/** Schema version of this app's Dexie stores (independent of app id). */
export const ST_DB_VERSION = 3;

/**
 * Hardcoded names used by older sillytavern-web templates.
 * This app must never open these databases.
 */
export const LEGACY_SHARED_DB_NAMES = ['SillyTavernWebDB'] as const;

export function sanitizeStorageId(id: string): string {
  const cleaned = id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return cleaned || 'app';
}

/** IndexedDB database name for this app. */
export function buildDbName(appId: string = ST_APP_ID): string {
  return `${sanitizeStorageId(appId)}__SillyTavern`;
}

export const ST_DB_NAME = buildDbName(ST_APP_ID);

export interface StorageIdentity {
  appId: string;
  dbName: string;
  dbVersion: number;
}

export function getStorageIdentity(): StorageIdentity {
  return {
    appId: ST_APP_ID,
    dbName: ST_DB_NAME,
    dbVersion: ST_DB_VERSION,
  };
}

/** True if a name is a known cross-project shared legacy DB. */
export function isLegacySharedDbName(name: string | undefined | null): boolean {
  if (!name) return false;
  return (LEGACY_SHARED_DB_NAMES as readonly string[]).includes(name);
}

/**
 * Detect leftover shared DBs on this origin (other projects may still use them).
 * Uses the async `indexedDB.databases()` API when available.
 */
export async function listOriginDatabases(): Promise<string[]> {
  if (typeof indexedDB === 'undefined') return [];
  try {
    const list = indexedDB.databases ? await indexedDB.databases() : [];
    return list
      .map((d) => d.name)
      .filter((n): n is string => typeof n === 'string' && n.length > 0);
  } catch {
    return [];
  }
}

export async function findLegacySharedDatabases(): Promise<string[]> {
  const names = await listOriginDatabases();
  return names.filter((n) => isLegacySharedDbName(n));
}
