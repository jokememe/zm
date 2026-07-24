import { describe, it, expect, beforeEach } from 'vitest'
import {
  collectLocalBackupState,
  applyLocalBackupState,
  extractGameSaveFromBackup,
  verifyGameSaveRoundtrip,
  LOCAL_BACKUP_KEYS,
} from './full-backup'
import {
  buildGameSave,
  GAME_SAVE_KEY,
  parseGameSave,
  setGameSaveStorageForTests,
  type GameSavePayload,
} from './game-save'
import { OPENING_STORAGE_KEY } from '@/data/opening'

function memStore(): Storage {
  const m = new Map<string, string>()
  return {
    get length() {
      return m.size
    },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => {
      m.set(k, String(v))
    },
    removeItem: (k: string) => {
      m.delete(k)
    },
    key: (i: number) => [...m.keys()][i] ?? null,
  }
}

const basePayload: GameSavePayload = {
  sectName: '主线青岚',
  masterName: '沈青岚',
  difficulty: 'standard',
  resources: {
    spiritStone: 999,
    spiritGrain: 100,
    herb: 10,
    ore: 5,
    prestige: 3,
    destiny: 2,
  },
  calendar: {
    era: '天元历',
    year: 3848,
    season: '孟夏',
    day: 3,
    hour: '午时',
    weather: '晴',
  },
  disciples: [
    {
      id: 'd1',
      name: '陆承渊',
      gender: '男',
      age: 18,
      realm: '炼气三层',
      aptitude: '上',
      role: '内门',
      loyalty: 80,
      mood: '振奋',
      talent: ['剑'],
      status: '在宗',
      avatarHue: 120,
    },
    {
      id: 'd2',
      name: '林晚舟',
      gender: '女',
      age: 19,
      realm: '炼气二层',
      aptitude: '上',
      role: '内门',
      loyalty: 85,
      mood: '平静',
      talent: ['丹'],
      status: '在宗',
      avatarHue: 200,
    },
  ],
  factions: [],
  cities: [],
  notifications: [],
  fieldPlots: [],
  urgentEvents: [],
  designatedHeirId: '',
  alchemyStocks: {},
}

describe('full-backup · 导出必须能用', () => {
  beforeEach(() => {
    setGameSaveStorageForTests(undefined)
  })

  it('JSON.stringify(backup) roundtrip keeps disciples', () => {
    const save = buildGameSave(basePayload)
    // 模拟 exportAllData 产物
    const backup = {
      version: 3,
      appId: 'zongmen-revival',
      dbName: 'zongmen-revival__SillyTavern',
      exportedAt: Date.now(),
      lorebooks: [] as unknown[],
      presets: [] as unknown[],
      settings: [] as unknown[],
      chats: [] as unknown[],
      gameSave: save,
      localState: {
        [GAME_SAVE_KEY]: JSON.stringify(save),
        [OPENING_STORAGE_KEY]: 'done',
      },
    }
    const text = JSON.stringify(backup, null, 2)
    const re = JSON.parse(text)
    expect(re.gameSave).toBeTruthy()
    expect(re.gameSave.disciples).toHaveLength(2)
    expect(re.gameSave.disciples[0].name).toBe('陆承渊')
    expect(re.gameSave.resources.spiritStone).toBe(999)

    const extracted = extractGameSaveFromBackup(re)
    expect(extracted).not.toBeNull()
    expect(extracted!.disciples).toHaveLength(2)
    expect(extracted!.disciples.map((d) => d.name)).toEqual(['陆承渊', '林晚舟'])

    const check = verifyGameSaveRoundtrip(re.gameSave)
    expect(check.ok).toBe(true)
    expect(check.discipleCount).toBe(2)
  })

  it('import path: applyLocalBackupState restores disciples to storage', () => {
    const s = memStore()
    const save = buildGameSave(basePayload)
    const backupText = JSON.stringify({
      gameSave: save,
      localState: { [GAME_SAVE_KEY]: JSON.stringify(save) },
    })
    const data = JSON.parse(backupText)
    const r = applyLocalBackupState(data.localState, {
      storage: s,
      gameSave: data.gameSave,
    })
    expect(r.gameSave?.disciples).toHaveLength(2)
    const raw = s.getItem(GAME_SAVE_KEY)
    expect(raw).toBeTruthy()
    const again = parseGameSave(JSON.parse(raw!))
    expect(again?.disciples).toHaveLength(2)
    expect(again?.disciples[1].name).toBe('林晚舟')
    expect(s.getItem(OPENING_STORAGE_KEY)).toBe('done')
  })

  it('old backup without gameSave extracts null', () => {
    const old = {
      version: 3,
      appId: 'zongmen-revival',
      lorebooks: [],
      presets: [],
      settings: [],
      chats: [{ id: 'c1', messages: [] }],
    }
    expect(extractGameSaveFromBackup(old)).toBeNull()
  })

  it('collectLocalBackupState reads known keys only', () => {
    const s = memStore()
    s.setItem(GAME_SAVE_KEY, JSON.stringify(buildGameSave(basePayload)))
    s.setItem(OPENING_STORAGE_KEY, 'done')
    s.setItem('unrelated', 'x')
    const bag = collectLocalBackupState(s)
    expect(Object.keys(bag).sort()).toEqual(
      [GAME_SAVE_KEY, OPENING_STORAGE_KEY].sort(),
    )
    expect(LOCAL_BACKUP_KEYS).toContain(GAME_SAVE_KEY)
  })

  it('extract prefers top-level gameSave over broken localState', () => {
    const save = buildGameSave(basePayload)
    const got = extractGameSaveFromBackup({
      gameSave: save,
      localState: { [GAME_SAVE_KEY]: 'not-json' },
    })
    expect(got?.disciples).toHaveLength(2)
  })

  it('accepts gameSave as JSON string', () => {
    const save = buildGameSave(basePayload)
    const got = extractGameSaveFromBackup({ gameSave: JSON.stringify(save) })
    expect(got?.disciples[0].name).toBe('陆承渊')
  })
})
