import type {
  CityState,
  Disciple,
  Faction,
  FieldPlot,
  ForgeItem,
  HeirCandidate,
  Manual,
  NotificationItem,
  RelationEdge,
  Resources,
  Treasure,
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
  /** 以下为第二期活世界实体；旧快照缺键 → restore 保留当前 live */
  manuals?: Manual[]
  treasures?: Treasure[]
  forgeQueue?: ForgeItem[]
  relationEdges?: RelationEdge[]
  heirs?: HeirCandidate[]
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
      op: 'faction.add'
      name: string
      power?: string
      relation?: number
      stance?: Faction['stance']
      recent?: string
      demand?: string
    }
  | {
      op: 'faction.update'
      id?: string
      name?: string
      patch: Partial<Pick<Faction, 'relation' | 'stance' | 'recent' | 'demand' | 'power'>>
    }
  | {
      op: 'city.add'
      name: string
      distance?: string
      influence?: number
      attitude?: CityState['attitude']
      governor?: string
      notes?: string
      tribute?: { type?: string; amount?: number; period?: string }
    }
  | {
      op: 'city.update'
      id?: string
      name?: string
      patch: Partial<Pick<CityState, 'attitude' | 'influence' | 'notes' | 'governor'>>
    }
  | {
      op: 'manual.add'
      name: string
      school?: string
      grade?: string
      restriction?: string
      readers?: number
      insight?: string
      sealed?: boolean
    }
  | {
      op: 'manual.update'
      id?: string
      name?: string
      patch: Partial<
        Pick<Manual, 'name' | 'school' | 'grade' | 'restriction' | 'readers' | 'insight' | 'sealed'>
      >
    }
  | {
      op: 'treasure.add'
      name: string
      type?: string
      grade?: string
      owner?: string | null
      desc?: string
      bound?: boolean
    }
  | {
      op: 'treasure.update'
      id?: string
      name?: string
      patch: Partial<Pick<Treasure, 'name' | 'type' | 'grade' | 'owner' | 'desc' | 'bound'>>
    }
  | {
      op: 'forge.add'
      name: string
      type?: ForgeItem['type']
      grade?: string
      progress?: number
      craftsman?: string | null
      materials?: string
      power?: string
    }
  | {
      op: 'forge.update'
      id?: string
      name?: string
      patch: Partial<
        Pick<ForgeItem, 'name' | 'type' | 'grade' | 'progress' | 'craftsman' | 'materials' | 'power'>
      >
    }
  | {
      op: 'relation.add'
      from: string
      to: string
      type: RelationEdge['type']
      intensity?: number
      note?: string
    }
  | {
      op: 'relation.update'
      id?: string
      from?: string
      to?: string
      type?: RelationEdge['type']
      patch: Partial<Pick<RelationEdge, 'type' | 'intensity' | 'note' | 'from' | 'to'>>
    }
  | {
      op: 'heir.add'
      /** 弟子 id 或姓名 */
      discipleId?: string
      name?: string
      score?: number
      strengths?: string[]
      risks?: string[]
      support?: number
      designated?: boolean
    }
  | {
      op: 'heir.update'
      id?: string
      name?: string
      discipleId?: string
      patch: Partial<
        Pick<HeirCandidate, 'name' | 'score' | 'strengths' | 'risks' | 'support' | 'designated'>
      >
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
