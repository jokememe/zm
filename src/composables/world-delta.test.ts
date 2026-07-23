import { describe, it, expect } from 'vitest'
import {
  parseSettlePayload,
  validateWorldDelta,
  sanitizeWorldDelta,
  applyWorldDeltaToSnapshot,
  emptyTestSnapshot,
} from './world-delta'
import type { Disciple, Faction, CityState } from '@/types/game'

const baseDisciple = (over: Partial<Disciple> = {}): Disciple => ({
  id: 'd1',
  name: '陆承渊',
  gender: '男',
  age: 19,
  realm: '炼气七层',
  aptitude: '上佳',
  role: '内门剑修',
  loyalty: 78,
  mood: '求进',
  talent: ['剑骨'],
  status: '在宗',
  avatarHue: 210,
  ...over,
})

const baseFaction = (over: Partial<Faction> = {}): Faction => ({
  id: 'fa1',
  name: '赤焰谷',
  power: '一方雄镇',
  relation: -28,
  stance: '觊觎',
  recent: '遣使',
  ...over,
})

const baseCity = (over: Partial<CityState> = {}): CityState => ({
  id: 'c1',
  name: '青石城',
  distance: '山脚',
  influence: 62,
  tribute: { type: '灵谷', amount: 180, period: '每季' },
  attitude: '恭顺',
  governor: '张衡',
  notes: '',
  ...over,
})

describe('parseSettlePayload', () => {
  it('parses bare JSON', () => {
    const r = parseSettlePayload('{"resources":{},"ops":[],"summary":"无局面变更"}')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.delta.ops).toEqual([])
  })

  it('parses markdown fenced JSON', () => {
    const r = parseSettlePayload('```json\n{"resources":{"灵石":-10},"ops":[]}\n```')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.delta.resources?.['灵石']).toBe(-10)
  })

  it('rejects invalid JSON', () => {
    const r = parseSettlePayload('{not json')
    expect(r.ok).toBe(false)
  })

  it('extracts JSON embedded in prose / think tags', () => {
    const r = parseSettlePayload(
      '分析如下\n<think>xxx</think>\n最终：{"resources":{"灵石":5},"ops":[],"summary":"得灵石"}\n完',
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.delta.resources?.['灵石']).toBe(5)
  })

  it('repairs single-quoted JSON (position 1 column 2 error)', () => {
    const r = parseSettlePayload("{'resources':{'灵石':-10},'ops':[],'summary':'耗灵石'}")
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.delta.resources?.['灵石']).toBe(-10)
      expect(r.delta.summary).toBe('耗灵石')
    }
  })

  it('repairs unquoted keys and trailing commas', () => {
    const r = parseSettlePayload('{resources:{"灵石":5,},ops:[],summary:"得",}')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.delta.resources?.['灵石']).toBe(5)
  })

  it('repairs unquoted Chinese resource keys', () => {
    const r = parseSettlePayload('{resources:{灵石:-3},ops:[],summary:"无"}')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.delta.resources?.['灵石']).toBe(-3)
  })

  it('strips fullwidth wrappers', () => {
    const r = parseSettlePayload('（{"resources":{},"ops":[],"summary":"无"}）')
    expect(r.ok).toBe(true)
  })
})

describe('sanitizeWorldDelta', () => {
  it('keeps all named disciple.add (5+) and only drops nameless ones', () => {
    const raw = {
      resources: {},
      ops: [
        { op: 'disciple.add', name: '甲' },
        { op: 'disciple.add' }, // no name → drop
        { op: 'disciple.add', 姓名: '乙' }, // alias
        { op: 'disciple.add', name: '丙' },
        { op: 'disciple.add', name: '丁' },
        { op: 'disciple.add', name: '戊' },
        { op: 'notify.push', title: '风闻' },
      ] as never[],
      summary: '收徒多人',
    }
    const cleaned = sanitizeWorldDelta(raw as never)
    const adds = (cleaned.ops || []).filter((o) => o.op === 'disciple.add')
    // 5 个有名新人全部入册，不因旧 MAX=3 截断
    expect(adds.map((o) => (o.op === 'disciple.add' ? o.name : ''))).toEqual([
      '甲',
      '乙',
      '丙',
      '丁',
      '戊',
    ])
    expect(adds.every((o) => o.op === 'disciple.add' && o.name?.trim())).toBe(true)
    const v = validateWorldDelta(cleaned, emptyTestSnapshot())
    expect(v.ok).toBe(true)
  })

  it('fills disciple.add name from 姓名 / character aliases', () => {
    const cleaned = sanitizeWorldDelta({
      ops: [{ op: 'disciple.add', character: '陆承渊', realm: '炼气一层' } as never],
    })
    expect(cleaned.ops?.[0]).toMatchObject({ op: 'disciple.add', name: '陆承渊' })
    expect(validateWorldDelta(cleaned, emptyTestSnapshot()).ok).toBe(true)
  })
})

describe('validateWorldDelta', () => {
  it('accepts disciple.add', () => {
    const snap = emptyTestSnapshot()
    const v = validateWorldDelta(
      { ops: [{ op: 'disciple.add', name: '张三', realm: '炼气一层' }] },
      snap,
    )
    expect(v.ok).toBe(true)
  })

  it('rejects disciple.update unknown id', () => {
    const snap = emptyTestSnapshot({ disciples: [baseDisciple()] })
    const v = validateWorldDelta(
      { ops: [{ op: 'disciple.update', id: 'nope', patch: { loyalty: 1 } }] },
      snap,
    )
    expect(v.ok).toBe(false)
    expect(v.errors.some((e) => e.includes('不存在'))).toBe(true)
  })

  it('rejects ops length > 12', () => {
    const snap = emptyTestSnapshot()
    const ops = Array.from({ length: 13 }, (_, i) => ({
      op: 'notify.push' as const,
      title: `t${i}`,
    }))
    const v = validateWorldDelta({ ops }, snap)
    expect(v.ok).toBe(false)
  })

  it('rejects illegal resource key', () => {
    const snap = emptyTestSnapshot()
    const v = validateWorldDelta({ resources: { 金币: 1 } as never }, snap)
    expect(v.ok).toBe(false)
  })
})

describe('applyWorldDeltaToSnapshot', () => {
  it('applies relative resource change', () => {
    const snap = emptyTestSnapshot()
    const { snap: next, result } = applyWorldDeltaToSnapshot(
      { resources: { 灵石: '-30' } },
      snap,
    )
    expect(next.resources.spiritStone).toBe(970)
    expect(result.changed).toBe(true)
  })

  it('adds disciple', () => {
    const snap = emptyTestSnapshot()
    const { snap: next } = applyWorldDeltaToSnapshot(
      { ops: [{ op: 'disciple.add', name: '张三', realm: '炼气一层' }] },
      snap,
    )
    expect(next.disciples).toHaveLength(1)
    expect(next.disciples[0].name).toBe('张三')
  })

  it('soft-removes disciple', () => {
    const snap = emptyTestSnapshot({ disciples: [baseDisciple()] })
    const { snap: next } = applyWorldDeltaToSnapshot(
      { ops: [{ op: 'disciple.remove', id: 'd1' }] },
      snap,
    )
    expect(next.disciples[0].status).toBe('叛离风险')
  })

  it('updates faction and city', () => {
    const snap = emptyTestSnapshot({
      factions: [baseFaction()],
      cities: [baseCity()],
    })
    const { snap: next } = applyWorldDeltaToSnapshot(
      {
        ops: [
          { op: 'faction.update', id: 'fa1', patch: { relation: -50, stance: '敌对' } },
          { op: 'city.update', name: '青石城', patch: { attitude: '犹豫', influence: 40 } },
        ],
      },
      snap,
    )
    expect(next.factions[0].stance).toBe('敌对')
    expect(next.factions[0].relation).toBe(-50)
    expect(next.cities[0].attitude).toBe('犹豫')
    expect(next.cities[0].influence).toBe(40)
  })
})
