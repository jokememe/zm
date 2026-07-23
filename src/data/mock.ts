import type {
  AlchemyRecipe,
  CityState,
  Disciple,
  Faction,
  FieldPlot,
  ForgeItem,
  HeirCandidate,
  Manual,
  NavItem,
  NotificationItem,
  RelationEdge,
  ResourceMeta,
  Resources,
  Treasure,
  UrgentEvent,
  TianjiMessage,
} from '@/types/game'

export const SECT_NAME = '青岚宗'
export const SECT_MOTTO = '残云未尽，青岚可期'
export const MASTER_NAME = '沈青岚'
export const CALENDAR = {
  era: '天元历',
  year: 3847,
  season: '仲春',
  day: 16,
  hour: '辰时',
  weather: '薄雾微岚',
}

export const resources: Resources = {
  spiritStone: 1286,
  spiritGrain: 3420,
  herb: 186,
  ore: 94,
  prestige: 37,
  destiny: 12,
}

export const resourceMeta: ResourceMeta[] = [
  { key: 'spiritStone', label: '灵石', icon: 'stone' },
  { key: 'spiritGrain', label: '灵谷', icon: 'grain' },
  { key: 'herb', label: '丹材', icon: 'herb' },
  { key: 'ore', label: '矿铁', icon: 'ore' },
  { key: 'prestige', label: '声望', icon: 'prestige' },
  { key: 'destiny', label: '气运', icon: 'destiny' },
]

export const resourceDelta: Partial<Record<keyof Resources, number>> = {
  spiritStone: -42,
  spiritGrain: 18,
  herb: -6,
  prestige: 1,
}

export const navItems: NavItem[] = [
  { id: 'hall', label: '宗门大殿', icon: 'hall', group: '总览' },
  { id: 'fields', label: '灵田', icon: 'fields', group: '内政' },
  { id: 'alchemy', label: '炼丹', icon: 'alchemy', group: '内政' },
  { id: 'forge', label: '锻器', icon: 'forge', group: '内政' },
  { id: 'library', label: '藏经阁', icon: 'library', group: '内政' },
  { id: 'treasury', label: '宝库', icon: 'treasury', group: '内政' },
  { id: 'disciples', label: '弟子名册', icon: 'disciples', group: '人事', badge: 2 },
  { id: 'relations', label: '关系网', icon: 'relations', group: '人事' },
  { id: 'legacy', label: '传承继位', icon: 'legacy', group: '人事' },
  { id: 'cities', label: '城池纳贡', icon: 'cities', group: '外交' },
  { id: 'diplomacy', label: '势力外交', icon: 'diplomacy', group: '外交', badge: 1 },
  { id: 'timeline', label: '岁月流转', icon: 'timeline', group: '决策' },
  { id: 'story', label: '天机推演', icon: 'spark', group: '决策' },
]

export const hallStats = [
  { id: 'disciples', label: '在宗弟子', value: '17', sub: '外勤 3 · 闭关 2', icon: 'disciples', tone: 'moon' },
  { id: 'buildings', label: '可用建筑', value: '6/12', sub: '大殿残破待修', icon: 'hall', tone: 'amber' },
  { id: 'threat', label: '外部威胁', value: '中', sub: '赤焰谷遣使窥探', icon: 'diplomacy', tone: 'rose' },
  { id: 'morale', label: '宗门士气', value: '41%', sub: '较上月 +3%', icon: 'destiny', tone: 'jade' },
]

/** 种子待决事件（运行时拷贝到 useGameState，处理后从大殿列表移除） */
export const urgentEvents: UrgentEvent[] = [
  {
    id: 'evt-envoy',
    title: '赤焰谷使者到访',
    summary: '对方以「借道灵脉」为名，实则欲勘测本宗残留灵矿。拒绝或将激怒其长老，应允则损及根基。',
    severity: 'critical',
    source: '山门执事',
    timeLabel: '半个时辰前',
    status: 'open',
    choices: [
      {
        id: 'c1',
        label: '婉拒并赠薄礼',
        effect: '声望 -2 · 敌意暂缓',
        risk: '可能被视作软弱',
        resourceDelta: { prestige: -2 },
      },
      {
        id: 'c2',
        label: '允许外围勘查三日',
        effect: '灵石 +200 · 气运 -1',
        risk: '矿脉信息泄露',
        resourceDelta: { spiritStone: 200, destiny: -1 },
      },
      {
        id: 'c3',
        label: '请入大殿对谈（天机）',
        effect: '开启叙事交涉',
        risk: '取决于你的辞令',
        openTianji: true,
      },
    ],
  },
  {
    id: 'evt-harvest',
    title: '东坡灵田将熟',
    summary: '三亩灵谷再过两日可收。护田弟子林晚舟称有妖兽足迹，建议加派人手。',
    severity: 'warn',
    source: '灵田管事',
    timeLabel: '今晨',
    status: 'open',
    choices: [
      {
        id: 'h1',
        label: '加派两名外门弟子',
        effect: '灵谷更稳',
        risk: '无',
        resourceDelta: { spiritGrain: 40 },
      },
      {
        id: 'h2',
        label: '设简易禁制即可',
        effect: '丹材 -5 · 风险中等',
        risk: '或有损耗',
        resourceDelta: { herb: -5 },
      },
    ],
  },
  {
    id: 'evt-disciple',
    title: '弟子请命下山历练',
    summary: '内门弟子陆承渊请往青石城历练三月，愿以所得三成归宗。',
    severity: 'info',
    source: '内门值事',
    timeLabel: '昨日',
    status: 'open',
    choices: [
      {
        id: 'd1',
        label: '准奏，授护身符',
        effect: '声望微升',
        risk: '弟子安危',
        resourceDelta: { prestige: 1 },
      },
      {
        id: 'd2',
        label: '暂缓，先稳固根基',
        effect: '暂无资源变动',
        risk: '弟子或生怨气',
      },
    ],
  },
]

export function cloneUrgentEventsSeed(): UrgentEvent[] {
  return urgentEvents.map((e) => ({
    ...e,
    status: 'open' as const,
    choices: e.choices.map((c) => ({ ...c, resourceDelta: c.resourceDelta ? { ...c.resourceDelta } : undefined })),
  }))
}

export const fieldPlots: FieldPlot[] = [
  { id: 'f1', name: '东坡一号田', grade: '黄品', crop: '青穗灵谷', yieldPerSeason: 420, moisture: 78, assigned: '林晚舟', status: 'growing', seasonLeft: 2 },
  { id: 'f2', name: '东坡二号田', grade: '黄品', crop: '青穗灵谷', yieldPerSeason: 390, moisture: 65, assigned: '赵阿禾', status: 'growing', seasonLeft: 2 },
  { id: 'f3', name: '西涧药圃', grade: '玄品', crop: '寒露参苗', yieldPerSeason: 48, moisture: 88, assigned: '苏青棠', status: 'growing', seasonLeft: 5 },
  { id: 'f4', name: '北崖荒田', grade: '凡品', crop: '—', yieldPerSeason: 0, moisture: 22, assigned: null, status: 'barren', seasonLeft: 0 },
  { id: 'f5', name: '后山雾畦', grade: '玄品', crop: '月华莲子', yieldPerSeason: 12, moisture: 91, assigned: '林晚舟', status: 'harvest', seasonLeft: 0 },
  { id: 'f6', name: '山门侧田', grade: '黄品', crop: '待播', yieldPerSeason: 0, moisture: 54, assigned: null, status: 'idle', seasonLeft: 0 },
]

export function cloneFieldPlotsSeed(): FieldPlot[] {
  return fieldPlots.map((f) => ({ ...f }))
}

export const alchemyRecipes: AlchemyRecipe[] = [
  { id: 'a1', name: '聚气丹', grade: '黄品', cost: { herb: 8, spiritStone: 20 }, effect: '修炼效率 +12%，持续三日', successRate: 82, time: '两时辰', stock: 14 },
  { id: 'a2', name: '疗伤散', grade: '黄品', cost: { herb: 5, spiritStone: 10 }, effect: '外伤愈合加速，稳固经脉', successRate: 90, time: '一时辰', stock: 31 },
  { id: 'a3', name: '破境引', grade: '玄品', cost: { herb: 24, spiritStone: 80 }, effect: '冲击筑基瓶颈时略增机缘', successRate: 48, time: '半日', stock: 2 },
  { id: 'a4', name: '清心露', grade: '玄品', cost: { herb: 16, spiritStone: 45 }, effect: '压制心魔与走火，安神定志', successRate: 66, time: '四时辰', stock: 5 },
  { id: 'a5', name: '化毒丸', grade: '黄品', cost: { herb: 12, spiritStone: 30 }, effect: '解寻常毒障与瘴气', successRate: 75, time: '三时辰', stock: 8 },
]

export const forgeQueue: ForgeItem[] = [
  { id: 'g1', name: '青岚残剑·重修', type: '飞剑', grade: '玄品', progress: 64, craftsman: '韩铁山', materials: '玄铁×3 · 灵木×1', power: '锋锐 · 轻灵' },
  { id: 'g2', name: '守山符甲', type: '护甲', grade: '黄品', progress: 28, craftsman: '韩铁山', materials: '精铁×8 · 兽皮×4', power: '守御' },
  { id: 'g3', name: '聚灵盏', type: '法器', grade: '黄品', progress: 0, craftsman: null, materials: '灵石×40 · 瓷胎×1', power: '助修' },
  { id: 'g4', name: '掌门令·残', type: '法宝', grade: '地品·残', progress: 0, craftsman: null, materials: '需秘银与血契', power: '号令 · 封印' },
]

export const manuals: Manual[] = [
  { id: 'm1', name: '青岚呼吸诀', school: '本宗心法', grade: '黄品', restriction: '外门可阅', readers: 11, insight: '筑基根基稳固', sealed: false },
  { id: 'm2', name: '云纱步', school: '身法', grade: '黄品', restriction: '内门以上', readers: 4, insight: '短距闪避', sealed: false },
  { id: 'm3', name: '断流剑意残篇', school: '剑道', grade: '玄品', restriction: '掌门亲传', readers: 1, insight: '以柔克刚之剑意', sealed: false },
  { id: 'm4', name: '九重雾隐', school: '秘术', grade: '玄品', restriction: '气运不足不可启', readers: 0, insight: '隐踪避祸', sealed: true },
  { id: 'm5', name: '丹火观想法', school: '炼丹辅修', grade: '黄品', restriction: '丹房弟子', readers: 2, insight: '稳定炉火心象', sealed: false },
  { id: 'm6', name: '上古残卷·无名', school: '未知', grade: '地品·残', restriction: '封印中', readers: 0, insight: '不可辨识', sealed: true },
]

export const treasures: Treasure[] = [
  { id: 't1', name: '青岚令', type: '信物', grade: '宗门重宝', owner: '沈青岚', desc: '掌门信物，可调动外门与城池纳贡权。', bound: true },
  { id: 't2', name: '寒玉瓶', type: '储物', grade: '玄品', owner: null, desc: '内蕴寒意，宜存丹药与灵草。', bound: false },
  { id: 't3', name: '护山阵盘·残', type: '阵器', grade: '地品·残', owner: null, desc: '曾护一山之安，今仅余三成灵纹。', bound: false },
  { id: 't4', name: '流云簪', type: '饰物', grade: '黄品', owner: '苏青棠', desc: '聚微光，略助夜修。', bound: true },
  { id: 't5', name: '赤铜鼎', type: '丹器', grade: '玄品', owner: '丹房公用', desc: '可炼黄、玄品丹药。', bound: false },
]

export const disciples: Disciple[] = [
  { id: 'd1', name: '陆承渊', gender: '男', age: 19, realm: '炼气七层', aptitude: '上佳', role: '内门剑修', loyalty: 78, mood: '求进', talent: ['剑骨', '坚毅'], status: '在宗', avatarHue: 210 },
  { id: 'd2', name: '苏青棠', gender: '女', age: 17, realm: '炼气五层', aptitude: '奇才', role: '药圃管事', loyalty: 86, mood: '沉静', talent: ['药灵', '细心'], status: '在宗', avatarHue: 150, spouse: 'd1' },
  { id: 'd3', name: '林晚舟', gender: '男', age: 24, realm: '炼气九层', aptitude: '中上', role: '灵田管事', loyalty: 91, mood: '勤恳', talent: ['农道', '稳重'], status: '在宗', avatarHue: 120 },
  { id: 'd4', name: '韩铁山', gender: '男', age: 41, realm: '筑基初期', aptitude: '中等', role: '锻器长老', loyalty: 88, mood: '孤僻', talent: ['器识', '蛮力'], status: '在宗', avatarHue: 30 },
  { id: 'd5', name: '白疏影', gender: '女', age: 22, realm: '炼气八层', aptitude: '上佳', role: '藏经执事', loyalty: 72, mood: '忧郁', talent: ['悟性', '记忆'], status: '闭关', avatarHue: 260 },
  { id: 'd6', name: '赵阿禾', gender: '男', age: 16, realm: '炼气三层', aptitude: '平凡', role: '外门杂役', loyalty: 65, mood: '惶恐', talent: ['吃苦'], status: '在宗', avatarHue: 40 },
  { id: 'd7', name: '沈微', gender: '女', age: 14, realm: '炼气一层', aptitude: '上佳', role: '记名弟子', loyalty: 95, mood: '依恋', talent: ['血脉共鸣'], status: '在宗', avatarHue: 190, master: '沈青岚' },
  { id: 'd8', name: '顾长风', gender: '男', age: 28, realm: '筑基中期', aptitude: '上佳', role: '护山首座', loyalty: 70, mood: '躁动', talent: ['战意', '统御'], status: '外勤', avatarHue: 0 },
  { id: 'd9', name: '裴晚晴', gender: '女', age: 20, realm: '炼气六层', aptitude: '中上', role: '内门阵修', loyalty: 60, mood: '怨怼', talent: ['阵法'], status: '在宗', avatarHue: 300 },
  { id: 'd10', name: '周无咎', gender: '男', age: 33, realm: '筑基初期', aptitude: '中等', role: '外交执事', loyalty: 74, mood: '圆滑', talent: ['舌辩', '眼力'], status: '外勤', avatarHue: 200 },
]

export const relationEdges: RelationEdge[] = [
  { id: 'r1', from: 'd1', to: 'd2', type: '道侣', intensity: 72, note: '暗生情愫，尚未明媒正娶' },
  { id: 'r2', from: '沈青岚', to: 'd7', type: '师徒', intensity: 90, note: '掌门唯一亲传记名' },
  { id: 'r3', from: 'd8', to: 'd9', type: '仇恨', intensity: 55, note: '昔年护阵争执，互不服气' },
  { id: 'r4', from: 'd1', to: 'd8', type: '竞争', intensity: 48, note: '剑道与战力之争' },
  { id: 'r5', from: 'd4', to: 'd1', type: '师徒', intensity: 40, note: '锻器余暇点拨剑胚' },
  { id: 'r6', from: 'd3', to: 'd6', type: '师徒', intensity: 65, note: '灵田实务传帮带' },
  { id: 'r7', from: 'd5', to: 'd9', type: '结义', intensity: 58, note: '藏经阁夜谈之谊' },
  { id: 'r8', from: 'd2', to: 'd7', type: '血缘', intensity: 20, note: '远房表亲，往来尚浅' },
]

export const cities: CityState[] = [
  { id: 'c1', name: '青石城', distance: '山脚半日', influence: 62, tribute: { type: '灵谷/银两', amount: 180, period: '每季' }, attitude: '恭顺', governor: '城主张衡', notes: '依赖本宗护道，商旅愿挂青岚旗号' },
  { id: 'c2', name: '雾溪镇', distance: '西路一日', influence: 41, tribute: { type: '丹材', amount: 30, period: '每季' }, attitude: '中立', governor: '镇主柳婆', notes: '药市兴旺，可议提高丹材纳贡' },
  { id: 'c3', name: '黑水坞', distance: '北境两日', influence: 18, tribute: { type: '矿铁', amount: 10, period: '每半年' }, attitude: '犹豫', governor: '坞主成霸', notes: '近与赤焰谷私下往来' },
  { id: 'c4', name: '云渡渡口', distance: '东南一日半', influence: 35, tribute: { type: '灵石折色', amount: 50, period: '每季' }, attitude: '中立', governor: '渡司衙门', notes: '水路枢纽，可设关卡抽成' },
]

export const factions: Faction[] = [
  { id: 'fa1', name: '赤焰谷', power: '一方雄镇', relation: -28, stance: '觊觎', recent: '遣使「借道」，实勘灵矿', demand: '开放矿脉外围三日' },
  { id: 'fa2', name: '白梅观', power: '清修小派', relation: 45, stance: '友好', recent: '愿以丹方换取护山符', demand: undefined },
  { id: 'fa3', name: '青石城府', power: '凡俗官府', relation: 55, stance: '同盟', recent: '纳贡准时，求祛妖', demand: '派弟子清剿山匪' },
  { id: 'fa4', name: '玄机阁', power: '散修联盟', relation: 8, stance: '中立', recent: '有意收购秘籍残页', demand: undefined },
  { id: 'fa5', name: '血鸦帮', power: '黑道势力', relation: -40, stance: '敌对', recent: '劫了本宗下山商队', demand: '赎人赎金 300 灵石' },
]

export const heirs: HeirCandidate[] = [
  { id: 'h1', discipleId: 'd8', name: '顾长风', score: 78, strengths: ['战力', '威慑外敌', '统御经验'], risks: ['躁动难驯', '与阵修有隙'], support: 42, designated: false },
  { id: 'h2', discipleId: 'd1', name: '陆承渊', score: 71, strengths: ['剑道潜质', '人心所向', '年轻可塑'], risks: ['境界尚浅', '或恋凡情'], support: 38, designated: true },
  { id: 'h3', discipleId: 'd7', name: '沈微', score: 64, strengths: ['血脉亲近', '忠诚极高', '悟性佳'], risks: ['年幼', '未历风雨'], support: 25, designated: false },
  { id: 'h4', discipleId: 'd4', name: '韩铁山', score: 58, strengths: ['筑基已成', '技艺傍身'], risks: ['不善交际', '年龄偏大'], support: 15, designated: false },
]

export const notifications: NotificationItem[] = [
  { id: 'n1', title: '赤焰谷使者已至山门', body: '执事请掌门定夺接待规格。', time: '辰时初', read: false, category: '外交' },
  { id: 'n2', title: '后山雾畦可收获', body: '月华莲子已熟，请安排采收人手。', time: '卯时', read: false, category: '内政' },
  { id: 'n3', title: '裴晚晴请见', body: '言有关护山阵残缺之事。', time: '昨日戌时', read: true, category: '人事' },
  { id: 'n4', title: '青石城纳贡抵达', body: '本季灵谷与折色银两已入库。', time: '前日', read: true, category: '城池' },
  { id: 'n5', title: '藏经阁禁制微颤', body: '九重雾隐册页有异动，或与气运相关。', time: '三日前', read: true, category: '秘辛' },
]

export const tianjiSeed: TianjiMessage[] = [
  {
    id: 'tm1',
    role: 'system',
    content: '天机卷轴已启。此处记录宗门因果与掌门心念；日后可接入推演之智，今以预演应答示意。',
    time: '卯时',
  },
  {
    id: 'tm2',
    role: 'event',
    content: '【山门急报】赤焰谷使者执赤纹令旗，立于迎客松下，神色倨傲。山门弟子不敢怠慢，已奉茶却未敢延入内峰。',
    time: '辰时初',
    contextTag: '赤焰谷使者',
    choices: [
      { id: 'tc1', label: '延入侧殿，以礼相待' },
      { id: 'tc2', label: '山门回复，本座稍后亲至' },
    ],
  },
  {
    id: 'tm3',
    role: 'oracle',
    content: '青岚残脉未绝，然外有虎狼、内有隙裂。掌门若只顾一事，恐失全局。可试将「灵田」「外交」等事务上下文注入，再问天机。',
    time: '辰时',
  },
]

/** @deprecated 岁月卡请用 buildTimelineSeasons(year, season)；保留空导出避免误 import 崩 */
export const timelineSeasons: {
  id: string
  label: string
  events: string[]
  status: 'current' | 'next' | 'future'
}[] = []

export const hallChronicle = [
  { id: 'ch1', year: '天元 3840', text: '先师坐化，青岚宗势如残烛，外门散去过半。' },
  { id: 'ch2', year: '天元 3842', text: '你继任掌门，以残令重聚七名旧人，守住山门。' },
  { id: 'ch3', year: '天元 3845', text: '开垦东坡灵田，与青石城再立纳贡之约。' },
  { id: 'ch4', year: '天元 3847', text: '气运微回。赤焰谷闻风而至——中兴之路，由此分岔。' },
]
