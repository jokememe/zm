/**
 * 开局剧本 — 从头开始时的资源、历法、难度与天机卷首
 */
import type { Disciple, Resources, TianjiMessage } from '@/types/game'
import { disciples as allDisciples } from '@/data/mock'

export const OPENING_STORAGE_KEY = 'zongmen-opening-v1'
export const IDENTITY_STORAGE_KEY = 'zongmen-identity-v1'
export const MEMORY_STORAGE_KEY = 'zongmen-memory-v1'

export const OPENING_CALENDAR = {
  era: '天元历',
  year: 3847,
  season: '仲春',
  day: 1,
  hour: '卯时',
  weather: '残雾未散',
}

/** 默认名（可在开场最后一页改写） */
export const DEFAULT_SECT_NAME = '青岚宗'
export const DEFAULT_MASTER_NAME = '沈青岚'

/** 初任掌门时的清贫局面（比演示中局更紧） */
export const OPENING_RESOURCES: Resources = {
  spiritStone: 620,
  spiritGrain: 1800,
  herb: 72,
  ore: 40,
  prestige: 18,
  destiny: 8,
}

export type DifficultyId = 'standard' | 'hard' | 'hardcore'

export interface DifficultyOption {
  id: DifficultyId
  label: string
  blurb: string
  resources: Resources
  /** null = 全部 mock 弟子 */
  discipleIds: string[] | null
  tone: 'jade' | 'amber' | 'rose'
}

export const DIFFICULTY_OPTIONS: DifficultyOption[] = [
  {
    id: 'standard',
    label: '标准',
    blurb: '残宗可守。仓库尚有余粮，旧部十人在册。',
    resources: { ...OPENING_RESOURCES },
    discipleIds: null,
    tone: 'jade',
  },
  {
    id: 'hard',
    label: '困难',
    blurb: '资源腰斩，仅数名核心弟子愿留。',
    resources: {
      spiritStone: 280,
      spiritGrain: 720,
      herb: 28,
      ore: 12,
      prestige: 10,
      destiny: 4,
    },
    // 陆承渊、林晚舟、沈微、韩铁山
    discipleIds: ['d1', 'd3', 'd7', 'd4'],
    tone: 'amber',
  },
  {
    id: 'hardcore',
    label: '硬核·一无所有',
    blurb: '仓廪皆空，只余一二人与掌门印。',
    resources: {
      spiritStone: 0,
      spiritGrain: 0,
      herb: 0,
      ore: 0,
      prestige: 2,
      destiny: 1,
    },
    // 林晚舟、沈微
    discipleIds: ['d3', 'd7'],
    tone: 'rose',
  },
]

export function getDifficulty(id: DifficultyId): DifficultyOption {
  return DIFFICULTY_OPTIONS.find((d) => d.id === id) ?? DIFFICULTY_OPTIONS[0]
}

export function pickDisciplesForDifficulty(id: DifficultyId): Disciple[] {
  const opt = getDifficulty(id)
  const base = allDisciples.map((d) => ({ ...d }))
  if (!opt.discipleIds) return base
  return base.filter((d) => opt.discipleIds!.includes(d.id))
}

export interface OpeningIdentity {
  sectName: string
  masterName: string
  difficulty: DifficultyId
}

export function loadIdentity(): OpeningIdentity | null {
  try {
    const raw = localStorage.getItem(IDENTITY_STORAGE_KEY)
    if (!raw) return null
    const o = JSON.parse(raw) as Partial<OpeningIdentity>
    if (!o.sectName || !o.masterName) return null
    const difficulty =
      o.difficulty === 'hard' || o.difficulty === 'hardcore' || o.difficulty === 'standard'
        ? o.difficulty
        : 'standard'
    return {
      sectName: String(o.sectName).slice(0, 24),
      masterName: String(o.masterName).slice(0, 16),
      difficulty,
    }
  } catch {
    return null
  }
}

export function saveIdentity(id: OpeningIdentity) {
  try {
    localStorage.setItem(
      IDENTITY_STORAGE_KEY,
      JSON.stringify({
        sectName: id.sectName.slice(0, 24),
        masterName: id.masterName.slice(0, 16),
        difficulty: id.difficulty,
      }),
    )
  } catch {
    /* ignore */
  }
}

export function clearIdentity() {
  try {
    localStorage.removeItem(IDENTITY_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export interface OpeningSlide {
  id: string
  eyebrow: string
  title: string
  body: string
  tone?: 'moon' | 'jade' | 'rose' | 'amber'
}

export const openingSlides: OpeningSlide[] = [
  {
    id: 's1',
    eyebrow: '天元 3840',
    title: '先师坐化',
    body: '青岚峰灵脉骤敛。外门弟子散去过半，护法堂空置，护山阵只余残纹。残云压顶，似在逼问：此宗，还能否再起？',
    tone: 'rose',
  },
  {
    id: 's2',
    eyebrow: '继任',
    title: '掌门印落在你掌心',
    body: '你以微末修为接过掌门印。宗门账册薄如蝉翼，仓库见底，城池犹在观望。没有援军，只有这一座山、一枚印、一群不愿散尽的人。',
    tone: 'moon',
  },
  {
    id: 's3',
    eyebrow: '今日 · 卯时',
    title: '山门有客',
    body: '赤焰谷使者执赤纹令旗立于迎客松下，神色倨傲。灵田将熟、弟子心思各异、继位之争暗涌——一切从你此刻的抉择开始。',
    tone: 'amber',
  },
]

/** 开局天机消息（卷首，非中局演示） */
export function buildOpeningTianjiMessages(
  masterName: string,
  sectName: string,
): TianjiMessage[] {
  return [
    {
      id: 'op-sys',
      role: 'system',
      content: `【开局】天机卷轴初启。此局从${sectName}残破之日算起。掌门 ${masterName}，问天机、处事务、结因果——气数将随推演结算。`,
      time: '卯时',
    },
    {
      id: 'op-ev',
      role: 'event',
      content:
        '【山门急报】赤焰谷使者执赤纹令旗，立于迎客松下，神色倨傲。山门弟子已奉茶，却未敢延入内峰。使者放话：三日之内，要见掌门本人，谈矿脉「共享」。',
      time: '辰时初',
      contextTag: '赤焰谷使者',
      choices: [
        { id: 'op-c1', label: '延入侧殿，以礼相待' },
        { id: 'op-c2', label: '山门回复：本座稍后亲至' },
        { id: 'op-c3', label: '先问天机：赤焰谷此来何意？' },
      ],
    },
    {
      id: 'op-or',
      role: 'oracle',
      content:
        '残脉未绝，然外有虎狼、内有隙裂。掌门若只顾一事，恐失全局。\n\n可点选上方选项，或自经营页注入「灵田」「外交」等事务后再问。通灵后，正文与气数将写入此卷。',
      time: '辰时',
    },
  ]
}

/** @deprecated 使用 buildOpeningTianjiMessages */
export const openingTianjiMessages: TianjiMessage[] = buildOpeningTianjiMessages(
  DEFAULT_MASTER_NAME,
  DEFAULT_SECT_NAME,
)

export function buildOpeningNotifications(
  masterName: string,
  sectName: string,
) {
  return [
    {
      id: 'op-n1',
      title: '继任通告',
      body: `${masterName} 正式执掌${sectName}。各方势力已闻讯，或贺或觑。`,
      time: '卯时',
      read: false,
      category: '宗门',
    },
    {
      id: 'op-n2',
      title: '赤焰谷使者到访',
      body: '执赤纹令旗立于山门，求见掌门，言及矿脉。',
      time: '辰时初',
      read: false,
      category: '外交',
    },
    {
      id: 'op-n3',
      title: '东坡灵田将熟',
      body: '外门请示护田人手，恐有妖兽窥伺。',
      time: '昨日',
      read: false,
      category: '内政',
    },
  ]
}

export const OPENING_NOTIFICATIONS = buildOpeningNotifications(
  DEFAULT_MASTER_NAME,
  DEFAULT_SECT_NAME,
)
