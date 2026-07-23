import type {
  CityState,
  Disciple,
  Faction,
  FieldPlot,
  NotificationItem,
  Resources,
  UrgentEvent,
} from '@/types/game'

export type SettlementMode = 'off' | 'secondary_only' | 'secondary_then_primary'

export interface WorldSnapshot {
  resources: Resources
  calendar: { year: number; season: string; day: number }
  sectName: string
  masterName: string
  disciples: Disciple[]
  factions: Faction[]
  cities: CityState[]
  notifications: NotificationItem[]
  /** 灵田；旧会话 stateAfter 可能缺此键 → restore 保留当前 live */
  fieldPlots?: FieldPlot[]
  /** 待决；旧会话 stateAfter 可能缺此键 → restore 保留当前 live */
  urgentEvents?: UrgentEvent[]
}

export type ResourceCnName = '灵石' | '灵谷' | '丹材' | '矿铁' | '声望' | '气运'

export type WorldOp =
  | {
      op: 'disciple.add'
      name: string
      gender?: '男' | '女'
      age?: number
      realm?: string
      aptitude?: string
      role?: string
      loyalty?: number
      mood?: string
      talent?: string[]
      status?: Disciple['status']
      master?: string
    }
  | {
      op: 'disciple.update'
      id?: string
      name?: string
      patch: Partial<
        Pick<
          Disciple,
          | 'name'
          | 'gender'
          | 'age'
          | 'realm'
          | 'aptitude'
          | 'role'
          | 'loyalty'
          | 'mood'
          | 'talent'
          | 'status'
          | 'master'
          | 'spouse'
        >
      >
    }
  | {
      op: 'disciple.remove'
      id?: string
      name?: string
    }
  | {
      op: 'faction.update'
      id?: string
      name?: string
      patch: Partial<Pick<Faction, 'relation' | 'stance' | 'recent' | 'demand' | 'power'>>
    }
  | {
      op: 'city.update'
      id?: string
      name?: string
      patch: Partial<Pick<CityState, 'attitude' | 'influence' | 'notes' | 'governor'>>
    }
  | {
      op: 'notify.push'
      title: string
      body?: string
      category?: string
    }

export interface WorldDelta {
  resources?: Partial<Record<ResourceCnName, string | number>>
  ops?: WorldOp[]
  summary?: string
}

export interface ValidateResult {
  ok: boolean
  errors: string[]
  warnings: string[]
  delta?: WorldDelta
}

export interface ApplyResult {
  lines: string[]
  changed: boolean
}
