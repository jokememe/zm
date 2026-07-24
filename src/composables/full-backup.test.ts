import { describe, it, expect, beforeEach } from 'vitest'
import {
  collectLocalBackupState,
  applyLocalBackupState,
  extractGameSaveFromBackup,
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
  ],
  factions: [],
  cities: [],
  notifications: [],
  fieldPlots: [],
  urgentEvents: [],
  designatedHeirId: '',
  alchemyStocks: {},
}

describe('full-backup local slice', () => {
  beforeEach(() => {
    setGameSaveStorageForTests(undefined)
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
    expect(bag[OPENING_STORAGE_KEY]).toBe('done')
    expect(LOCAL_BACKUP_KEYS).toContain(GAME_SAVE_KEY)
  })

  it('extractGameSaveFromBackup prefers gameSave object', () => {
    const save = buildGameSave(basePayload)
    const got = extractGameSaveFromBackup({
      gameSave: save,
      localState: { [GAME_SAVE_KEY]: '{}' },
    })
    expect(got?.sectName).toBe('主线青岚')
    expect(got?.resources.spiritStone).toBe(999)
  })

  it('extractGameSaveFromBackup reads localState string', () => {
    const save = buildGameSave(basePayload)
    const got = extractGameSaveFromBackup({
      localState: { [GAME_SAVE_KEY]: JSON.stringify(save) },
    })
    expect(got?.masterName).toBe('沈青岚')
    expect(got?.disciples).toHaveLength(1)
  })

  it('extractGameSaveFromBackup accepts pure game JSON', () => {
    const save = buildGameSave(basePayload)
    const got = extractGameSaveFromBackup(save as unknown as { gameSave?: unknown })
    // pure object is passed as backup root — extract tries parseGameSave(backup)
    expect(parseGameSave(save)?.sectName).toBe('主线青岚')
    expect(got?.sectName).toBe('主线青岚')
  })

  it('applyLocalBackupState writes storage and marks opening done', () => {
    const s = memStore()
    const save = buildGameSave(basePayload)
    const r = applyLocalBackupState(
      {
        [GAME_SAVE_KEY]: JSON.stringify(save),
        [OPENING_STORAGE_KEY]: 'done',
      },
      { storage: s },
    )
    expect(r.gameSave?.sectName).toBe('主线青岚')
    expect(r.openingMarked).toBe(true)
    expect(s.getItem(OPENING_STORAGE_KEY)).toBe('done')
    expect(s.getItem(GAME_SAVE_KEY)).toBeTruthy()
    const again = parseGameSave(JSON.parse(s.getItem(GAME_SAVE_KEY)!))
    expect(again?.resources.spiritStone).toBe(999)
    expect(again?.disciples[0].name).toBe('陆承渊')
  })

  it('applyLocalBackupState accepts top-level gameSave without localState', () => {
    const s = memStore()
    const save = buildGameSave(basePayload)
    const r = applyLocalBackupState({}, { storage: s, gameSave: save })
    expect(r.gameSave?.calendar.year).toBe(3848)
    expect(s.getItem(GAME_SAVE_KEY)).toBeTruthy()
  })
})
