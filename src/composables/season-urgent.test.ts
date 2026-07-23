import { describe, it, expect, beforeEach } from 'vitest'
import {
  parseSeasonUrgentPayload,
  buildSeasonUrgentMessages,
  runSeasonUrgents,
  SEASON_URGENT_SYSTEM,
  SEASON_URGENT_CONTRACT,
  normalizeSeasonEvent,
} from './season-urgent'
import { emptyTestSnapshot } from './world-delta'
import { useGameState } from './useGameState'
import type { AppSettings } from '@/sillytavern/types'

const sampleJson = JSON.stringify({
  events: [
    {
      title: '山门客商求见',
      summary: '青石城商队携灵谷求换护身符，事关声望与灵谷。',
      severity: 'warn',
      source: '山门执事',
      choices: [
        {
          id: 'a',
          label: '允诺小批交易',
          effect: '灵谷+80 声望+1',
          resourceDelta: { 灵谷: 80, 声望: 1 },
        },
        { id: 'b', label: '婉拒', effect: '无事发生', risk: '商队改投他宗' },
        {
          id: 'c',
          label: '请入侧殿细谈',
          effect: '天机交涉',
          openTianji: true,
        },
      ],
    },
    {
      title: '西涧药圃异动',
      summary: '药童报有雾气凝而不散，或需禁制。',
      severity: 'info',
      source: '灵田管事',
      choices: [
        { id: 'x1', label: '加派禁制', effect: '丹材-8', resourceDelta: { 丹材: -8 } },
        { id: 'x2', label: '观望三日', effect: '暂无' },
      ],
    },
  ],
  summary: '本季两件待决',
})

describe('parseSeasonUrgentPayload', () => {
  it('parses valid season events with resourceDelta mapping', () => {
    const r = parseSeasonUrgentPayload(sampleJson, { timeLabel: '仲春', idPrefix: 'evt-test' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.events).toHaveLength(2)
    expect(r.events[0].title).toBe('山门客商求见')
    expect(r.events[0].status).toBe('open')
    expect(r.events[0].choices[0].resourceDelta?.spiritGrain).toBe(80)
    expect(r.events[0].choices[0].resourceDelta?.prestige).toBe(1)
    expect(r.events[0].choices[2].openTianji).toBe(true)
    expect(r.summary).toContain('待决')
  })

  it('drops events with fewer than 2 choices', () => {
    const bad = JSON.stringify({
      events: [
        {
          title: '残缺',
          summary: '只有一个选项',
          choices: [{ id: 'a', label: '唯一', effect: '无' }],
        },
      ],
      summary: '坏',
    })
    const r = parseSeasonUrgentPayload(bad)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.events).toHaveLength(0)
  })

  it('extracts fenced JSON', () => {
    const r = parseSeasonUrgentPayload('```json\n' + sampleJson + '\n```')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.events.length).toBe(2)
  })
})

describe('buildSeasonUrgentMessages', () => {
  it('uses primary-oriented NL contract without response_format fields', () => {
    const msgs = buildSeasonUrgentMessages({
      snap: emptyTestSnapshot(),
      year: 3847,
      season: '仲春',
      memoryBrief: '上季收徒陆承渊',
      openTitles: ['旧事一条'],
    })
    expect(msgs[0].content).toBe(SEASON_URGENT_SYSTEM)
    expect(msgs[1].content).toContain(SEASON_URGENT_CONTRACT)
    expect(msgs[1].content).toContain('旧事一条')
    expect(msgs[1].content).toContain('上季收徒')
    expect(JSON.stringify(msgs)).not.toMatch(/response_format|json_schema/)
  })
})

describe('normalizeSeasonEvent', () => {
  it('returns null without title', () => {
    expect(
      normalizeSeasonEvent(
        { summary: 'x', choices: [{ label: 'a', effect: '1' }, { label: 'b', effect: '2' }] },
        { idPrefix: 't', index: 0, timeLabel: '今' },
      ),
    ).toBeNull()
  })
})

describe('runSeasonUrgents + appendUrgentEvents', () => {
  beforeEach(() => {
    const gs = useGameState()
    gs.resetGameToOpening()
    gs.markOpeningDone()
  })

  it('runSeasonUrgents uses injected postChat and returns applied events', async () => {
    const outcome = await runSeasonUrgents({
      settings: {
        api: {
          baseUrl: 'https://example.com/v1',
          apiKey: 'sk-test',
          model: 'strong-model',
        },
      } as AppSettings,
      snap: emptyTestSnapshot(),
      year: 3848,
      season: '孟夏',
      memoryBrief: '无',
      openTitles: [],
      postChat: async () => ({ ok: true as const, text: sampleJson }),
    })
    expect(outcome.status).toBe('applied')
    if (outcome.status !== 'applied') return
    expect(outcome.count).toBe(2)
  })

  it('skips when primary API missing', async () => {
    const outcome = await runSeasonUrgents({
      settings: { api: { baseUrl: '', apiKey: '', model: '' } } as AppSettings,
      snap: emptyTestSnapshot(),
      year: 1,
      season: '孟春',
      memoryBrief: '',
      openTitles: [],
    })
    expect(outcome).toEqual({ status: 'skipped', reason: 'no_primary_api' })
  })

  it('appendUrgentEvents adds to hall open list without duplicating titles', () => {
    const gs = useGameState()
    // clear seed opens by resolving all
    for (const e of [...gs.openUrgentEvents.value]) {
      const c = e.choices[0]
      if (c) gs.resolveUrgentEvent(e.id, c.id)
    }
    expect(gs.openUrgentEvents.value.length).toBe(0)

    const parsed = parseSeasonUrgentPayload(sampleJson)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const n = gs.appendUrgentEvents(parsed.events)
    expect(n).toBe(2)
    expect(gs.openUrgentEvents.value.map((e) => e.title)).toEqual([
      '山门客商求见',
      '西涧药圃异动',
    ])
    // same titles again → 0
    expect(gs.appendUrgentEvents(parsed.events)).toBe(0)
  })
})
