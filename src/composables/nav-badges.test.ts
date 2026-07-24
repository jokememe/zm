import { describe, it, expect, beforeEach } from 'vitest'
import { buildNavItems, resolveNavBadge } from './nav-badges'
import { useGameState } from './useGameState'
import type { Disciple, Faction, FieldPlot, UrgentEvent } from '@/types/game'

function emptyInput() {
  return {
    openUrgents: [] as UrgentEvent[],
    fieldPlots: [] as FieldPlot[],
    disciples: [] as Disciple[],
    factions: [] as Faction[],
  }
}

describe('nav-badges', () => {
  beforeEach(() => {
    const gs = useGameState()
    gs.resetGameToOpening()
    gs.markOpeningDone()
  })

  it('does not hardcode mock badge 2 / 1 on disciples / diplomacy', () => {
    const gs = useGameState()
    const items = buildNavItems({
      openUrgents: gs.openUrgentEvents.value,
      fieldPlots: gs.fieldPlots.value,
      disciples: gs.disciples.value,
      factions: gs.factions.value,
    })
    const disc = items.find((i) => i.id === 'disciples')
    const dip = items.find((i) => i.id === 'diplomacy')
    // mock 曾写死 badge:2 / badge:1；动态后仅在有关注项时出现
    expect(disc?.badge).not.toBe(2)
    // 种子势力可能有敌对 → 允许有数字，但不能是写死的 1 且与 live 不符
    if (dip?.badge !== undefined) {
      const expected = resolveNavBadge('diplomacy', {
        openUrgents: gs.openUrgentEvents.value,
        fieldPlots: gs.fieldPlots.value,
        disciples: gs.disciples.value,
        factions: gs.factions.value,
      })
      expect(dip.badge).toBe(expected)
    }
  })

  it('hall badge equals open urgent count', () => {
    const input = emptyInput()
    input.openUrgents = [
      {
        id: 'u1',
        title: 'a',
        summary: '',
        severity: 'info',
        source: '',
        timeLabel: '',
        status: 'open',
        choices: [],
      },
      {
        id: 'u2',
        title: 'b',
        summary: '',
        severity: 'info',
        source: '',
        timeLabel: '',
        status: 'resolved',
        choices: [],
      },
    ]
    expect(resolveNavBadge('hall', input)).toBe(1)
    const items = buildNavItems(input)
    expect(items.find((i) => i.id === 'hall')?.badge).toBe(1)
  })

  it('fields badge counts harvest plots only', () => {
    const input = emptyInput()
    input.fieldPlots = [
      {
        id: 'f1',
        name: 'a',
        grade: '黄',
        crop: '谷',
        yieldPerSeason: 1,
        moisture: 50,
        assigned: null,
        status: 'harvest',
        seasonLeft: 0,
      },
      {
        id: 'f2',
        name: 'b',
        grade: '黄',
        crop: '谷',
        yieldPerSeason: 1,
        moisture: 50,
        assigned: null,
        status: 'growing',
        seasonLeft: 1,
      },
    ]
    expect(resolveNavBadge('fields', input)).toBe(1)
  })

  it('disciples badge counts low loyalty / 叛离风险', () => {
    const input = emptyInput()
    input.disciples = [
      {
        id: 'd1',
        name: '甲',
        gender: '男',
        age: 20,
        realm: '炼气',
        aptitude: '中',
        role: '外门',
        loyalty: 40,
        mood: '躁',
        talent: [],
        status: '在宗',
        avatarHue: 1,
      },
      {
        id: 'd2',
        name: '乙',
        gender: '女',
        age: 18,
        realm: '炼气',
        aptitude: '中',
        role: '外门',
        loyalty: 90,
        mood: '稳',
        talent: [],
        status: '叛离风险',
        avatarHue: 2,
      },
      {
        id: 'd3',
        name: '丙',
        gender: '男',
        age: 22,
        realm: '炼气',
        aptitude: '中',
        role: '外门',
        loyalty: 80,
        mood: '稳',
        talent: [],
        status: '在宗',
        avatarHue: 3,
      },
    ]
    expect(resolveNavBadge('disciples', input)).toBe(2)
  })

  it('no badge when nothing needs attention', () => {
    const items = buildNavItems(emptyInput())
    for (const it of items) {
      expect(it.badge).toBeUndefined()
    }
  })
})
