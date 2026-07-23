/**
 * 岁月流转左侧卡片：按当前历法季节动态生成，不再读死 mock。
 */
export const SEASON_ORDER = [
  '孟春',
  '仲春',
  '季春',
  '孟夏',
  '仲夏',
  '季夏',
  '孟秋',
  '仲秋',
  '季秋',
  '孟冬',
  '仲冬',
  '季冬',
] as const

export type SeasonName = (typeof SEASON_ORDER)[number]

export type TimelineCardStatus = 'current' | 'next' | 'future'

export interface TimelineSeasonCard {
  id: string
  label: string
  events: string[]
  status: TimelineCardStatus
  season: string
  year: number
}

/** 各节气示意事件（展示用，非结算权威） */
const SEASON_HINTS: Record<string, string[]> = {
  孟春: ['春耕始', '半年贡窗口', '外门归山'],
  仲春: ['灵谷抽穗', '使者往来', '雾畦将熟'],
  季春: ['春末抢收', '山门岁修', '新苗考核'],
  孟夏: ['暑气起', '矿道加湿', '外勤增多'],
  仲夏: ['可能旱象', '议和窗口', '丹房催火'],
  季夏: ['伏日闭关', '城池纳凉贡', '护山巡夜'],
  孟秋: ['年贡清算', '半年贡窗口', '联姻议起？'],
  仲秋: ['中秋议事', '灵谷入库', '势力互访'],
  季秋: ['秋猎外勤', '药圃收尾', '冬储筹划'],
  孟冬: ['入冬封山', '矿道结霜', '气运检视'],
  仲冬: ['闭关潮', '矿道结冰', '气运结算'],
  季冬: ['岁末盘点', '继位观察', '来年布局'],
}

const PREFIX: Record<TimelineCardStatus, string> = {
  current: '本季',
  next: '下季',
  future: '后季',
}

function seasonIndex(season: string): number {
  const i = SEASON_ORDER.indexOf(season as SeasonName)
  return i >= 0 ? i : 0
}

/** 自当前季节起第 offset 步（0=本季）的年与季节名 */
export function seasonAtOffset(
  year: number,
  season: string,
  offset: number,
): { year: number; season: string } {
  const n = SEASON_ORDER.length
  let idx = seasonIndex(season) + offset
  let y = year
  while (idx >= n) {
    idx -= n
    y += 1
  }
  while (idx < 0) {
    idx += n
    y -= 1
  }
  return { year: y, season: SEASON_ORDER[idx] }
}

/**
 * 生成当前起连续 count 张季节卡（默认 4）。
 * status：0 current，1 next，其余 future。
 */
export function buildTimelineSeasons(
  year: number,
  season: string,
  count = 4,
): TimelineSeasonCard[] {
  const cards: TimelineSeasonCard[] = []
  for (let i = 0; i < count; i++) {
    const { year: y, season: s } = seasonAtOffset(year, season, i)
    const status: TimelineCardStatus = i === 0 ? 'current' : i === 1 ? 'next' : 'future'
    const hints = SEASON_HINTS[s] ?? ['时令推移', '人事消长', '气数暗动']
    cards.push({
      id: `s-${y}-${s}`,
      label: `${PREFIX[status]} · ${s}`,
      events: [...hints],
      status,
      season: s,
      year: y,
    })
  }
  return cards
}
