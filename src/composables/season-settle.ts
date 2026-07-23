/**
 * 季节本地结算：灵田产出、城池纳贡、弟子修炼、外交漂移、维护开销。
 * 与主 API 季报待决分离——先本地汇总，再可选 LLM 生成紧急事务。
 */
import type {
  CityState,
  Disciple,
  Faction,
  FieldPlot,
  Resources,
} from '@/types/game'

export interface SeasonSettleInput {
  fields: FieldPlot[]
  cities: CityState[]
  disciples: Disciple[]
  factions: Faction[]
  resources: Resources
  /** 历法季节名，用于半年贡等 */
  season: string
}

export interface SeasonSettleResult {
  resourcesDelta: Partial<Resources>
  fields: FieldPlot[]
  disciples: Disciple[]
  factions: Faction[]
  lines: string[]
}

const HALF_YEAR_SEASONS = new Set(['孟春', '孟秋'])

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)))
}

function addDelta(acc: Partial<Resources>, key: keyof Resources, n: number) {
  if (!n) return
  acc[key] = (acc[key] ?? 0) + n
}

/** 作物类型粗分：药类进丹材，其余灵谷 */
function yieldKeyForCrop(crop: string): keyof Resources {
  if (/参|药|莲|草|丹|苗/.test(crop)) return 'herb'
  return 'spiritGrain'
}

function tributeResourceKey(type: string): keyof Resources {
  if (/丹/.test(type)) return 'herb'
  if (/矿|铁/.test(type)) return 'ore'
  if (/石|银|折色/.test(type)) return 'spiritStone'
  return 'spiritGrain'
}

/**
 * 推进灵田一季：可收田入库；生长田倒计时；收获后转待播。
 */
export function tickFields(fields: FieldPlot[]): {
  next: FieldPlot[]
  delta: Partial<Resources>
  lines: string[]
} {
  const delta: Partial<Resources> = {}
  const lines: string[] = []
  const next = fields.map((f) => {
    const plot = { ...f }

    if (plot.status === 'harvest' && plot.yieldPerSeason > 0) {
      const moistureFactor = Math.max(0.35, Math.min(1.15, plot.moisture / 100))
      const amount = Math.max(1, Math.round(plot.yieldPerSeason * moistureFactor))
      const key = yieldKeyForCrop(plot.crop)
      addDelta(delta, key, amount)
      const label = key === 'herb' ? '丹材' : key === 'spiritGrain' ? '灵谷' : key
      lines.push(`灵田「${plot.name}」收获 ${plot.crop || '产出'} → ${label}+${amount}`)
      plot.status = 'idle'
      plot.crop = '待播'
      plot.yieldPerSeason = 0
      plot.seasonLeft = 0
      plot.moisture = clamp(plot.moisture - 8, 15, 100)
      return plot
    }

    if (plot.status === 'growing') {
      const left = Math.max(0, (plot.seasonLeft || 1) - 1)
      plot.seasonLeft = left
      plot.moisture = clamp(plot.moisture + (plot.assigned ? 2 : -3), 10, 100)
      if (left <= 0) {
        plot.status = 'harvest'
        lines.push(`灵田「${plot.name}」已熟，可安排收割`)
      }
      return plot
    }

    if (plot.status === 'idle' && plot.assigned) {
      // 有人看管的闲田自动复种一季黄品灵谷（原型）
      plot.status = 'growing'
      plot.crop = '青穗灵谷'
      plot.yieldPerSeason = 280
      plot.seasonLeft = 2
      plot.moisture = clamp(plot.moisture + 5, 20, 100)
      lines.push(`灵田「${plot.name}」由 ${plot.assigned} 复种灵谷`)
      return plot
    }

    if (plot.status === 'barren') {
      plot.moisture = clamp(plot.moisture - 1, 5, 100)
    }

    return plot
  })

  return { next, delta, lines }
}

/**
 * 城池纳贡：恭顺/中立入账；犹豫减半；敌视不交。
 * period 含「半年」时仅在孟春/孟秋入账。
 */
export function collectTributes(
  cities: CityState[],
  season: string,
): { delta: Partial<Resources>; lines: string[] } {
  const delta: Partial<Resources> = {}
  const lines: string[] = []

  for (const c of cities) {
    const period = c.tribute?.period || '每季'
    if (/半年/.test(period) && !HALF_YEAR_SEASONS.has(season)) continue

    let factor = 0
    if (c.attitude === '恭顺') factor = 1
    else if (c.attitude === '中立') factor = 0.85
    else if (c.attitude === '犹豫') factor = 0.45
    else factor = 0 // 敌视

    if (factor <= 0 || !c.tribute?.amount) {
      if (c.attitude === '敌视') {
        lines.push(`城池「${c.name}」敌视本宗，本季拒贡`)
      }
      continue
    }

    const amount = Math.max(1, Math.round(c.tribute.amount * factor * (c.influence / 50)))
    const key = tributeResourceKey(c.tribute.type)
    addDelta(delta, key, amount)
    const label =
      key === 'herb'
        ? '丹材'
        : key === 'ore'
          ? '矿铁'
          : key === 'spiritStone'
            ? '灵石'
            : '灵谷'
    lines.push(
      `城池「${c.name}」纳贡（${c.attitude}）→ ${label}+${amount}`,
    )
  }

  return { delta, lines }
}

/** 弟子修炼/人事：在宗稳忠诚，闭关微损外务，外勤换声望 */
export function tickDisciples(disciples: Disciple[]): {
  next: Disciple[]
  delta: Partial<Resources>
  lines: string[]
} {
  const delta: Partial<Resources> = {}
  const lines: string[] = []
  let closed = 0
  let fielded = 0
  let trained = 0

  const next = disciples.map((d) => {
    const row = { ...d }
    if (row.status === '在宗') {
      row.loyalty = clamp(row.loyalty + 1, 0, 100)
      trained += 1
    } else if (row.status === '闭关') {
      row.loyalty = clamp(row.loyalty + 0, 0, 100)
      closed += 1
    } else if (row.status === '外勤') {
      fielded += 1
      addDelta(delta, 'prestige', 1)
    } else if (row.status === '受伤') {
      row.loyalty = clamp(row.loyalty - 1, 0, 100)
    } else if (row.status === '叛离风险') {
      row.loyalty = clamp(row.loyalty - 2, 0, 100)
    }
    return row
  })

  if (trained) lines.push(`弟子修炼：${trained} 人在宗，忠诚微升`)
  if (closed) lines.push(`闭关中 ${closed} 人，不问外务`)
  if (fielded) lines.push(`外勤 ${fielded} 人，声望+${fielded}`)

  return { next, delta, lines }
}

/** 外交自然漂移：敌对/觊觎恶化，友好/同盟缓升 */
export function tickFactions(factions: Faction[]): {
  next: Faction[]
  lines: string[]
} {
  const lines: string[] = []
  const next = factions.map((f) => {
    const row = { ...f }
    let d = 0
    if (row.stance === '敌对') d = -3
    else if (row.stance === '觊觎') d = -2
    else if (row.stance === '友好') d = 1
    else if (row.stance === '同盟') d = 1
    // 中立 0
    if (d) {
      const before = row.relation
      row.relation = clamp(row.relation + d, -100, 100)
      if (row.relation !== before) {
        lines.push(
          `势力「${row.name}」关系 ${before}→${row.relation}（${row.stance}）`,
        )
      }
    }
    return row
  })
  return { next, lines }
}

/** 宗门维护：按在册弟子规模扣灵石 */
export function maintenanceCost(discipleCount: number): {
  delta: Partial<Resources>
  lines: string[]
} {
  const stone = -(20 + Math.min(80, discipleCount * 2))
  return {
    delta: { spiritStone: stone },
    lines: [`宗门维护开销 灵石${stone}（在册 ${discipleCount} 人）`],
  }
}

function mergeDelta(...parts: Partial<Resources>[]): Partial<Resources> {
  const out: Partial<Resources> = {}
  for (const p of parts) {
    for (const [k, v] of Object.entries(p)) {
      if (typeof v === 'number') addDelta(out, k as keyof Resources, v)
    }
  }
  return out
}

/** 一整季本地结算（纯函数） */
export function settleSeasonTick(input: SeasonSettleInput): SeasonSettleResult {
  const fieldsR = tickFields(input.fields)
  const tributeR = collectTributes(input.cities, input.season)
  const discR = tickDisciples(input.disciples)
  const facR = tickFactions(input.factions)
  const maintR = maintenanceCost(input.disciples.length)

  const resourcesDelta = mergeDelta(
    fieldsR.delta,
    tributeR.delta,
    discR.delta,
    maintR.delta,
  )

  const lines = [
    ...fieldsR.lines,
    ...tributeR.lines,
    ...discR.lines,
    ...facR.lines,
    ...maintR.lines,
  ]

  return {
    resourcesDelta,
    fields: fieldsR.next,
    disciples: discR.next,
    factions: facR.next,
    lines,
  }
}

export function formatSeasonSettleSummary(lines: string[], max = 6): string {
  if (!lines.length) return '本季无显著本地结算'
  if (lines.length <= max) return lines.join('；')
  return lines.slice(0, max).join('；') + `…共${lines.length}项`
}
