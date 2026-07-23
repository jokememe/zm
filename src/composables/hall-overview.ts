/**
 * 大殿总览：stats / 捷径 / 简史 — 读 live 局面，不读死 mock 数字。
 */
import type {
  AlchemyRecipe,
  CityState,
  Disciple,
  Faction,
  FieldPlot,
  UrgentEvent,
  ViewId,
} from '@/types/game'

export interface HallStatCard {
  id: string
  label: string
  value: string
  sub: string
  icon: string
  tone: 'moon' | 'amber' | 'rose' | 'jade'
}

export interface HallShortcut {
  id: ViewId
  label: string
  desc: string
  icon: string
}

export interface HallChronicleEntry {
  id: string
  year: string
  text: string
}

export interface HallOverviewInput {
  era: string
  year: number
  season: string
  sectName: string
  masterName: string
  disciples: Disciple[]
  factions: Faction[]
  cities: CityState[]
  fieldPlots: FieldPlot[]
  openUrgents: UrgentEvent[]
  alchemyRecipes: AlchemyRecipe[]
  designatedHeirId: string
  heirName?: string | null
  resources: { prestige: number; destiny: number; herb: number }
}

function threatLevel(factions: Faction[]): { value: string; sub: string } {
  if (!factions.length) return { value: '低', sub: '四周暂无强敌' }
  const worst = [...factions].sort((a, b) => a.relation - b.relation)[0]
  if (worst.relation <= 20 || worst.stance === '敌对' || worst.stance === '觊觎') {
    return { value: '高', sub: `${worst.name}·${worst.stance}` }
  }
  if (worst.relation <= 45) {
    return { value: '中', sub: `${worst.name}·${worst.stance}` }
  }
  return { value: '低', sub: `${worst.name}关系尚可` }
}

function moralePct(disciples: Disciple[], prestige: number, destiny: number): number {
  if (!disciples.length) return Math.min(99, 20 + prestige + destiny)
  const avgLoyalty =
    disciples.reduce((s, d) => s + (typeof d.loyalty === 'number' ? d.loyalty : 50), 0) /
    disciples.length
  return Math.max(5, Math.min(99, Math.round(avgLoyalty * 0.7 + prestige * 0.2 + destiny * 0.5)))
}

export function buildHallStats(input: HallOverviewInput): HallStatCard[] {
  const inSect = input.disciples.filter((d) => d.status === '在宗').length
  const outDuty = input.disciples.filter((d) => d.status === '外勤').length
  const closed = input.disciples.filter((d) => d.status === '闭关').length
  const harvest = input.fieldPlots.filter((f) => f.status === 'harvest').length
  const growing = input.fieldPlots.filter((f) => f.status === 'growing').length
  const plots = input.fieldPlots.length
  const threat = threatLevel(input.factions)
  const morale = moralePct(input.disciples, input.resources.prestige, input.resources.destiny)
  const openN = input.openUrgents.length

  return [
    {
      id: 'disciples',
      label: '在册弟子',
      value: String(input.disciples.length),
      sub: `在宗 ${inSect} · 外勤 ${outDuty} · 闭关 ${closed}`,
      icon: 'disciples',
      tone: 'moon',
    },
    {
      id: 'fields',
      label: '灵田',
      value: `${growing + harvest}/${plots || 0}`,
      sub: harvest ? `${harvest} 块可收` : growing ? `${growing} 块生长中` : '多待播种',
      icon: 'fields',
      tone: 'amber',
    },
    {
      id: 'threat',
      label: '外部威胁',
      value: threat.value,
      sub: openN ? `待决 ${openN} · ${threat.sub}` : threat.sub,
      icon: 'diplomacy',
      tone: 'rose',
    },
    {
      id: 'morale',
      label: '宗门士气',
      value: `${morale}%`,
      sub: `声望 ${input.resources.prestige} · 气运 ${input.resources.destiny}`,
      icon: 'destiny',
      tone: 'jade',
    },
  ]
}

export function buildHallShortcuts(input: HallOverviewInput): HallShortcut[] {
  const harvest = input.fieldPlots.filter((f) => f.status === 'harvest').length
  const barren = input.fieldPlots.filter((f) => f.status === 'barren').length
  const fieldDesc = harvest
    ? `${harvest} 块将熟`
    : barren
      ? `${barren} 块荒田`
      : `${input.fieldPlots.length} 块在册`

  const pillStock = input.alchemyRecipes.reduce((s, r) => s + (r.stock || 0), 0)
  const alchemyDesc = `成丹 ${pillStock} · 丹材 ${input.resources.herb}`

  const worst = [...input.factions].sort((a, b) => a.relation - b.relation)[0]
  const dipDesc = worst ? `${worst.name}·${worst.stance}` : '暂无外事'

  const city = [...input.cities].sort((a, b) => (b.influence || 0) - (a.influence || 0))[0]
  const cityDesc = city ? `${city.name}·${city.attitude}` : '无城池'

  const heir = input.heirName?.trim() || '未指定'

  return [
    { id: 'fields', label: '灵田', desc: fieldDesc, icon: 'fields' },
    { id: 'alchemy', label: '炼丹', desc: alchemyDesc, icon: 'alchemy' },
    {
      id: 'disciples',
      label: '弟子',
      desc: `在册 ${input.disciples.length} 人`,
      icon: 'disciples',
    },
    { id: 'diplomacy', label: '外交', desc: dipDesc, icon: 'diplomacy' },
    { id: 'legacy', label: '继位', desc: heir, icon: 'legacy' },
    { id: 'cities', label: '城池', desc: cityDesc, icon: 'cities' },
  ]
}

/** 固定前史 + 当前历法动态条 */
export function buildHallChronicle(input: HallOverviewInput): HallChronicleEntry[] {
  const openN = input.openUrgents.length
  const dynamic: HallChronicleEntry = {
    id: 'ch-live',
    year: `${input.era} ${input.year}`,
    text: openN
      ? `${input.season}，${input.sectName} 尚有 ${openN} 件待决；掌门 ${input.masterName} 坐镇大殿。`
      : `${input.season}，${input.sectName} 待决已清；掌门 ${input.masterName} 可推演或流转岁月。`,
  }
  return [
    {
      id: 'ch1',
      year: '天元 3840',
      text: '先师坐化，宗势如残烛，外门散去过半。',
    },
    {
      id: 'ch2',
      year: '天元 3842',
      text: `你继任掌门，以残令重聚旧部，守住${input.sectName}山门。`,
    },
    {
      id: 'ch3',
      year: '天元 3845',
      text: '开垦东坡灵田，与青石城再立纳贡之约。',
    },
    dynamic,
  ]
}
