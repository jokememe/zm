import { describe, it, expect, beforeEach } from 'vitest'
import {
  createDefaultTableMemoryState,
  syncRowsFromGameSnapshot,
  formatWorldStateInjection,
  clearTableMemory,
  loadTableMemory,
  applyMemoryTextToState,
} from './table-memory'

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => store.set(k, String(v)),
      removeItem: (k: string) => store.delete(k),
    },
    configurable: true,
  })
  clearTableMemory()
})

const sampleSnap = {
  sectName: '青岚宗',
  masterName: '沈青岚',
  difficultyLabel: '标准',
  year: 3847,
  season: '仲春',
  disciples: [
    {
      name: '陆承渊',
      age: 19,
      gender: '男',
      role: '内门剑修',
      realm: '炼气七层',
      status: '在宗',
      mood: '求进',
      loyalty: 78,
      talent: ['剑骨'],
    },
  ],
  treasures: [
    {
      name: '青岚令',
      type: '信物',
      grade: '宗门重宝',
      owner: '沈青岚',
      desc: '掌门信物',
      bound: true,
    },
  ],
  forgeQueue: [],
  factions: [
    {
      name: '赤焰谷',
      stance: '觊觎',
      relation: -28,
      power: '一方雄镇',
      recent: '遣使借道',
      demand: '开放矿脉',
    },
  ],
  cities: [
    {
      name: '青石城',
      attitude: '恭顺',
      influence: 62,
      governor: '张衡',
      notes: '纳贡',
      distance: '半日',
    },
  ],
}

describe('syncRowsFromGameSnapshot (shipped)', () => {
  it('fills character/item/world tables from game snapshot', () => {
    const s = createDefaultTableMemoryState()
    const counts = syncRowsFromGameSnapshot(sampleSnap, s)
    expect(counts.characters).toBeGreaterThanOrEqual(2) // 掌门 + 陆承渊
    expect(counts.items).toBeGreaterThanOrEqual(1)
    expect(counts.world).toBeGreaterThanOrEqual(3) // 宗门 + 赤焰谷 + 青石城

    const inj = formatWorldStateInjection(s)
    expect(inj).toContain('陆承渊')
    expect(inj).toContain('青岚令')
    expect(inj).toContain('赤焰谷')
    expect(inj).toContain('【当前世界状态参考】')
  })

  it('preserves LLM Memory fields on same primary key after game sync', () => {
    const s = createDefaultTableMemoryState()
    applyMemoryTextToState(
      s,
      `<Memory>#角色档案\n[陆承渊]|身份：内门弟子|当前位置：青石城|约定：三日后比剑</Memory>`,
    )
    expect(s.records.character_profile[0].values['约定']).toBe('三日后比剑')
    expect(s.records.character_profile[0].values['当前位置']).toBe('青石城')

    // 游戏同步会更新身份/位置等，但不应抹掉「约定」（sync 未写该字段 → 保留）
    syncRowsFromGameSnapshot(sampleSnap, s)
    const rec = s.records.character_profile.find(
      (r) => r.values['角色名'] === '陆承渊',
    )
    expect(rec).toBeTruthy()
    expect(rec!.values['约定']).toBe('三日后比剑')
    // 游戏侧身份会覆盖为 内门剑修 · 炼气七层
    expect(rec!.values['身份']).toMatch(/内门剑修|炼气/)
  })
})

describe('hooks: tianji must sync before assemble', () => {
  it('useTianji sources call syncTableMemoryFromGame', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const { dirname, join } = await import('node:path')
    const here = dirname(fileURLToPath(import.meta.url))
    const src = readFileSync(join(here, 'useTianji.ts'), 'utf8')
    expect(src).toMatch(/syncTableMemoryFromGame/)
    expect(src).toMatch(/applyAssistantMemoryTags/)
    expect(src).toMatch(/showMemory/)
  })
})
