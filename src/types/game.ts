export type ViewId =
  | 'hall'
  | 'fields'
  | 'alchemy'
  | 'forge'
  | 'library'
  | 'treasury'
  | 'disciples'
  | 'relations'
  | 'legacy'
  | 'cities'
  | 'diplomacy'
  | 'timeline'
  | 'story'

export type ResourceKey =
  | 'spiritStone'
  | 'spiritGrain'
  | 'herb'
  | 'ore'
  | 'prestige'
  | 'destiny'

export interface Resources {
  spiritStone: number
  spiritGrain: number
  herb: number
  ore: number
  prestige: number
  destiny: number
}

export interface ResourceMeta {
  key: ResourceKey
  label: string
  icon: string
  unit?: string
}

export interface NavItem {
  id: ViewId
  label: string
  icon: string
  group: string
  badge?: number
}

export interface UrgentEvent {
  id: string
  title: string
  summary: string
  severity: 'info' | 'warn' | 'critical'
  source: string
  timeLabel: string
  choices: EventChoice[]
  /** open = 待决；resolved = 已处理，大殿列表默认隐藏 */
  status?: 'open' | 'resolved'
  resolvedChoiceId?: string
  resolvedLabel?: string
}

export interface EventChoice {
  id: string
  label: string
  effect: string
  risk?: string
  /** 选择后立即写入资源的相对变化（可负） */
  resourceDelta?: Partial<Resources>
  /** 是否转入天机交涉（不在此关闭事件时由 UI 注入） */
  openTianji?: boolean
}

export interface FieldPlot {
  id: string
  name: string
  grade: string
  crop: string
  yieldPerSeason: number
  moisture: number
  assigned: string | null
  status: 'idle' | 'growing' | 'harvest' | 'barren'
  seasonLeft: number
}

export interface AlchemyRecipe {
  id: string
  name: string
  grade: string
  cost: { herb: number; spiritStone: number }
  effect: string
  successRate: number
  time: string
  stock: number
}

export interface ForgeItem {
  id: string
  name: string
  type: '法宝' | '飞剑' | '护甲' | '法器'
  grade: string
  progress: number
  craftsman: string | null
  materials: string
  power: string
}

export interface Manual {
  id: string
  name: string
  school: string
  grade: string
  restriction: string
  readers: number
  insight: string
  sealed: boolean
}

export interface Treasure {
  id: string
  name: string
  type: string
  grade: string
  owner: string | null
  desc: string
  bound: boolean
}

export interface Disciple {
  id: string
  name: string
  gender: '男' | '女'
  age: number
  realm: string
  aptitude: string
  role: string
  loyalty: number
  mood: string
  talent: string[]
  master?: string
  spouse?: string
  status: '在宗' | '闭关' | '外勤' | '受伤' | '叛离风险'
  avatarHue: number
}

export interface RelationEdge {
  id: string
  from: string
  to: string
  type: '师徒' | '道侣' | '结义' | '仇恨' | '竞争' | '血缘'
  intensity: number
  note: string
}

export interface CityState {
  id: string
  name: string
  distance: string
  influence: number
  tribute: { type: string; amount: number; period: string }
  attitude: '恭顺' | '中立' | '犹豫' | '敌视'
  governor: string
  notes: string
}

export interface Faction {
  id: string
  name: string
  power: string
  relation: number
  stance: '同盟' | '友好' | '中立' | '敌对' | '觊觎'
  recent: string
  demand?: string
}

export interface HeirCandidate {
  id: string
  discipleId: string
  name: string
  score: number
  strengths: string[]
  risks: string[]
  support: number
  designated: boolean
}

export interface TianjiMessage {
  id: string
  role: 'system' | 'event' | 'player' | 'oracle'
  content: string
  time: string
  contextTag?: string
  choices?: { id: string; label: string }[]
}

export interface ToastItem {
  id: string
  type: 'success' | 'info' | 'warn' | 'error'
  title: string
  message?: string
  duration?: number
}

export interface NotificationItem {
  id: string
  title: string
  body: string
  time: string
  read: boolean
  category: string
}

export interface ModalState {
  id: string | null
  props?: Record<string, unknown>
}
