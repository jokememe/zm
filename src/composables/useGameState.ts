import { computed, reactive, ref } from 'vue'
import type {
  Resources,
  ViewId,
  NotificationItem,
  Disciple,
  Faction,
  CityState,
  UrgentEvent,
  FieldPlot,
} from '@/types/game'
import {
  resources as initialResources,
  notifications as initialNotifications,
  disciples as initialDisciples,
  heirs as initialHeirs,
  factions as initialFactions,
  cities as initialCities,
  CALENDAR,
  SECT_NAME as DEFAULT_SECT,
  MASTER_NAME as DEFAULT_MASTER,
  cloneUrgentEventsSeed,
  cloneFieldPlotsSeed,
} from '@/data/mock'
import {
  settleSeasonTick,
  formatSeasonSettleSummary,
} from '@/composables/season-settle'
import {
  OPENING_STORAGE_KEY,
  OPENING_RESOURCES,
  OPENING_CALENDAR,
  buildOpeningNotifications,
  getDifficulty,
  pickDisciplesForDifficulty,
  loadIdentity,
  saveIdentity,
  clearIdentity,
  DEFAULT_SECT_NAME,
  DEFAULT_MASTER_NAME,
  type DifficultyId,
  type OpeningIdentity,
} from '@/data/opening'
import { clearMemoryBank, seedOpeningMemory } from '@/composables/memory-lore'

const currentView = ref<ViewId>('hall')
const navCollapsed = ref(false)
const tianjiCollapsed = ref(false)
const tianjiFocus = ref(false)

/** 窄屏 / 竖屏：导航与天机改抽屉 */
const COMPACT_MQ = '(max-width: 900px), ((orientation: portrait) and (max-width: 1100px))'
const isCompact = ref(false)
const navDrawerOpen = ref(false)

function evaluateCompact() {
  if (typeof window === 'undefined') return
  const next = window.matchMedia(COMPACT_MQ).matches
  const was = isCompact.value
  isCompact.value = next
  if (next && !was) {
    navDrawerOpen.value = false
    tianjiCollapsed.value = true
    tianjiFocus.value = false
  }
  if (!next && was) {
    navDrawerOpen.value = false
  }
}

/** 是否已看完/跳过开场（localStorage） */
function readOpeningDone(): boolean {
  try {
    return localStorage.getItem(OPENING_STORAGE_KEY) === 'done'
  } catch {
    return false
  }
}

const savedIdentity = typeof window !== 'undefined' ? loadIdentity() : null

const openingDone = ref(readOpeningDone())
/** 正在展示开场叠层 */
const showOpening = ref(!openingDone.value)

const sectName = ref(savedIdentity?.sectName || DEFAULT_SECT)
const masterName = ref(savedIdentity?.masterName || DEFAULT_MASTER)
const difficulty = ref<DifficultyId>(savedIdentity?.difficulty || 'standard')

const resources = reactive<Resources>({
  ...(openingDone.value
    ? initialResources
    : { ...getDifficulty(difficulty.value).resources }),
})

const notifications = ref<NotificationItem[]>(
  openingDone.value
    ? [...initialNotifications]
    : (buildOpeningNotifications(masterName.value, sectName.value) as NotificationItem[]),
)

/** 大殿「紧急与待决」：运行时状态，处理后 status=resolved 并从列表隐藏 */
const urgentEvents = ref<UrgentEvent[]>(cloneUrgentEventsSeed())

/** 灵田：季节结算会推进生长/收获 */
const fieldPlots = ref<FieldPlot[]>(cloneFieldPlotsSeed())

const disciples = ref<Disciple[]>(
  openingDone.value
    ? initialDisciples.map((d) => ({ ...d }))
    : pickDisciplesForDifficulty(difficulty.value),
)
const factions = ref<Faction[]>(initialFactions.map((f) => ({ ...f })))
const cities = ref<CityState[]>(initialCities.map((c) => ({ ...c })))
const designatedHeirId = ref(initialHeirs.find((h) => h.designated)?.id ?? 'h2')

const calendar = reactive({
  ...(openingDone.value ? CALENDAR : OPENING_CALENDAR),
})

const unreadCount = computed(() => notifications.value.filter((n) => !n.read).length)

const difficultyLabel = computed(() => getDifficulty(difficulty.value).label)

let compactMql: MediaQueryList | null = null
let compactListener: (() => void) | null = null
let compactBound = false

function bindCompactListener() {
  if (compactBound || typeof window === 'undefined') return
  compactBound = true
  evaluateCompact()
  compactMql = window.matchMedia(COMPACT_MQ)
  compactListener = () => evaluateCompact()
  compactMql.addEventListener('change', compactListener)
}

export function useGameState() {
  // 注意：game-bridge 等会在 setup 之外调用 useGameState()
  // 禁止在此使用 onMounted（生产环境会直接抛错，表现为部分页面打不开）
  if (typeof window !== 'undefined') {
    bindCompactListener()
  }

  function setView(id: ViewId) {
    currentView.value = id
    tianjiFocus.value = false
    if (isCompact.value) {
      navDrawerOpen.value = false
    }
  }

  function toggleNav() {
    if (isCompact.value) {
      navDrawerOpen.value = !navDrawerOpen.value
      if (navDrawerOpen.value) {
        tianjiCollapsed.value = true
        tianjiFocus.value = false
      }
      return
    }
    navCollapsed.value = !navCollapsed.value
  }

  function closeNavDrawer() {
    navDrawerOpen.value = false
  }

  function toggleTianji() {
    if (isCompact.value) {
      const opening = tianjiCollapsed.value
      tianjiCollapsed.value = !tianjiCollapsed.value
      if (opening) {
        navDrawerOpen.value = false
        tianjiFocus.value = true
      } else {
        tianjiFocus.value = false
      }
      return
    }
    tianjiCollapsed.value = !tianjiCollapsed.value
    if (tianjiCollapsed.value) tianjiFocus.value = false
  }

  function focusTianji() {
    tianjiCollapsed.value = false
    tianjiFocus.value = true
    if (isCompact.value) {
      navDrawerOpen.value = false
    }
  }

  function closeTianjiSheet() {
    tianjiCollapsed.value = true
    tianjiFocus.value = false
  }

  function markNotificationRead(id: string) {
    notifications.value = notifications.value.map((n) =>
      n.id === id ? { ...n, read: true } : n,
    )
  }

  function markAllNotificationsRead() {
    notifications.value = notifications.value.map((n) => ({ ...n, read: true }))
  }

  /** 仍待处理的紧急/待决（大殿列表） */
  const openUrgentEvents = computed(() =>
    urgentEvents.value.filter((e) => (e.status ?? 'open') === 'open'),
  )

  /**
   * 处理一条待决：应用选项资源变化，标记 resolved，大殿不再显示。
   * @returns 选项文案与是否转天机，供 UI toast / 注入
   */
  /**
   * 岁月流转等节点追加待决；去重标题，open 总数不超过 maxOpen（默认 5）。
   * 返回实际写入条数。
   */
  function appendUrgentEvents(
    incoming: UrgentEvent[],
    opts?: { maxOpen?: number },
  ): number {
    const maxOpen = opts?.maxOpen ?? 5
    if (!incoming.length) return 0
    const open = urgentEvents.value.filter((e) => (e.status ?? 'open') === 'open')
    const openTitles = new Set(open.map((e) => e.title.trim()))
    const room = Math.max(0, maxOpen - open.length)
    if (room <= 0) return 0

    const toAdd: UrgentEvent[] = []
    for (const raw of incoming) {
      if (toAdd.length >= room) break
      const title = (raw.title || '').trim()
      if (!title || openTitles.has(title)) continue
      openTitles.add(title)
      toAdd.push({
        ...raw,
        status: 'open',
        choices: (raw.choices || []).map((c) => ({
          ...c,
          resourceDelta: c.resourceDelta ? { ...c.resourceDelta } : undefined,
        })),
      })
    }
    if (!toAdd.length) return 0
    urgentEvents.value = [...toAdd, ...urgentEvents.value]
    return toAdd.length
  }

  function resolveUrgentEvent(
    eventId: string,
    choiceId: string,
  ): { ok: true; label: string; effect: string; openTianji: boolean } | { ok: false; error: string } {
    const idx = urgentEvents.value.findIndex((e) => e.id === eventId)
    if (idx < 0) return { ok: false, error: '事件不存在' }
    const ev = urgentEvents.value[idx]
    if ((ev.status ?? 'open') === 'resolved') {
      return { ok: false, error: '事件已处理' }
    }
    const choice = ev.choices.find((c) => c.id === choiceId)
    if (!choice) return { ok: false, error: '选项不存在' }

    if (choice.resourceDelta) {
      adjustResource(choice.resourceDelta)
    }

    const next = [...urgentEvents.value]
    next[idx] = {
      ...ev,
      status: 'resolved',
      resolvedChoiceId: choiceId,
      resolvedLabel: choice.label,
    }
    urgentEvents.value = next

    // 决策记入通知（已读，作履历）
    const note: NotificationItem = {
      id: `n-evt-${eventId}-${Date.now()}`,
      title: `已决：${ev.title}`,
      body: `${choice.label}（${choice.effect}）`,
      timeLabel: '方才',
      category: '决议',
      read: true,
    }
    notifications.value = [note, ...notifications.value]

    return {
      ok: true,
      label: choice.label,
      effect: choice.effect,
      openTianji: !!choice.openTianji,
    }
  }

  function adjustResource(partial: Partial<Resources>) {
    for (const [k, v] of Object.entries(partial)) {
      const key = k as keyof Resources
      if (typeof v === 'number') {
        resources[key] = Math.max(0, resources[key] + v)
      }
    }
  }

  function setDesignatedHeir(id: string) {
    designatedHeirId.value = id
  }

  /**
   * 推进一季：历法 + 本地汇总（灵田/纳贡/修炼/外交/维护），返回结算明细行。
   * 主 API 季报待决由 UI 在此之后调用，不在此函数内打网。
   */
  function advanceSeason(): { lines: string[]; summary: string } {
    const order = [
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
    ]
    // 用推进前的季节做半年贡判断，再切历法
    const seasonBefore = calendar.season
    const settled = settleSeasonTick({
      fields: fieldPlots.value,
      cities: cities.value,
      disciples: disciples.value,
      factions: factions.value,
      resources: { ...resources },
      season: seasonBefore,
    })

    fieldPlots.value = settled.fields
    disciples.value = settled.disciples
    factions.value = settled.factions
    if (settled.resourcesDelta) {
      adjustResource(settled.resourcesDelta)
    }

    const idx = order.indexOf(calendar.season)
    if (idx === order.length - 1 || idx === -1) {
      calendar.year += 1
      calendar.season = '孟春'
    } else {
      calendar.season = order[idx + 1]
    }
    calendar.day = 1

    const summary = formatSeasonSettleSummary(settled.lines)
    return { lines: settled.lines, summary }
  }

  function markOpeningDone() {
    openingDone.value = true
    showOpening.value = false
    try {
      localStorage.setItem(OPENING_STORAGE_KEY, 'done')
    } catch {
      /* ignore */
    }
    saveIdentity({
      sectName: sectName.value,
      masterName: masterName.value,
      difficulty: difficulty.value,
    })
  }

  /** 仅重看开场（不重置资源） */
  function replayOpening() {
    showOpening.value = true
  }

  /**
   * 应用开局配置：宗门名、掌门名、难度 → 资源 / 弟子 / 通知
   */
  function applyOpeningConfig(cfg: OpeningIdentity) {
    const name = (cfg.sectName || DEFAULT_SECT_NAME).trim().slice(0, 24) || DEFAULT_SECT_NAME
    const master =
      (cfg.masterName || DEFAULT_MASTER_NAME).trim().slice(0, 16) || DEFAULT_MASTER_NAME
    const diff: DifficultyId =
      cfg.difficulty === 'hard' || cfg.difficulty === 'hardcore' || cfg.difficulty === 'standard'
        ? cfg.difficulty
        : 'standard'

    sectName.value = name
    masterName.value = master
    difficulty.value = diff

    const opt = getDifficulty(diff)
    Object.assign(resources, opt.resources)
    Object.assign(calendar, OPENING_CALENDAR)
    disciples.value = pickDisciplesForDifficulty(diff)
    factions.value = initialFactions.map((f) => ({ ...f }))
    cities.value = initialCities.map((c) => ({ ...c }))
    notifications.value = buildOpeningNotifications(master, name) as NotificationItem[]
    urgentEvents.value = cloneUrgentEventsSeed()
    fieldPlots.value = cloneFieldPlotsSeed()
    designatedHeirId.value = initialHeirs.find((h) => h.designated)?.id ?? 'h2'

    // 困难/硬核：继承人须在现有弟子中
    const discIds = new Set(disciples.value.map((d) => d.id))
    const heirOk = initialHeirs.find((h) => discIds.has(h.discipleId) && h.designated)
    if (heirOk) designatedHeirId.value = heirOk.id
    else {
      const any = initialHeirs.find((h) => discIds.has(h.discipleId))
      if (any) designatedHeirId.value = any.id
    }

    // 弟子 master 字段同步掌门名
    disciples.value = disciples.value.map((d) =>
      d.master === DEFAULT_MASTER || d.master === '沈青岚'
        ? { ...d, master: master }
        : d,
    )

    try {
      seedOpeningMemory({
        sectName: name,
        masterName: master,
        difficulty: diff,
        difficultyLabel: opt.label,
      })
    } catch (e) {
      console.warn('[开局] 记忆初始化失败', e)
    }

    try {
      saveIdentity({ sectName: name, masterName: master, difficulty: diff })
    } catch {
      /* ignore */
    }
  }

  /**
   * 从头开局：资源/历法/通知回到开场状态。
   * 天机会话由 useTianji.startOpeningRun 一并重置。
   */
  function resetGameToOpening() {
    clearMemoryBank()
    clearIdentity()
    sectName.value = DEFAULT_SECT_NAME
    masterName.value = DEFAULT_MASTER_NAME
    difficulty.value = 'standard'
    Object.assign(resources, OPENING_RESOURCES)
    Object.assign(calendar, OPENING_CALENDAR)
    notifications.value = buildOpeningNotifications(
      masterName.value,
      sectName.value,
    ) as NotificationItem[]
    urgentEvents.value = cloneUrgentEventsSeed()
    fieldPlots.value = cloneFieldPlotsSeed()
    disciples.value = pickDisciplesForDifficulty('standard')
    factions.value = initialFactions.map((f) => ({ ...f }))
    cities.value = initialCities.map((c) => ({ ...c }))
    designatedHeirId.value = initialHeirs.find((h) => h.designated)?.id ?? 'h2'
    currentView.value = 'hall'
    tianjiCollapsed.value = isCompact.value
    tianjiFocus.value = !isCompact.value
    navDrawerOpen.value = false
    openingDone.value = false
    showOpening.value = true
    try {
      localStorage.removeItem(OPENING_STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }

  // 首次调用时也同步一次（SSR 无 window 则跳过）
  if (typeof window !== 'undefined' && !compactBound) {
    evaluateCompact()
  }

  return {
    currentView,
    navCollapsed,
    tianjiCollapsed,
    tianjiFocus,
    isCompact,
    navDrawerOpen,
    resources,
    notifications,
    urgentEvents,
    openUrgentEvents,
    fieldPlots,
    disciples,
    factions,
    cities,
    designatedHeirId,
    calendar,
    unreadCount,
    openingDone,
    showOpening,
    sectName,
    masterName,
    difficulty,
    difficultyLabel,
    setView,
    toggleNav,
    closeNavDrawer,
    toggleTianji,
    focusTianji,
    closeTianjiSheet,
    markNotificationRead,
    markAllNotificationsRead,
    resolveUrgentEvent,
    appendUrgentEvents,
    adjustResource,
    setDesignatedHeir,
    advanceSeason,
    markOpeningDone,
    replayOpening,
    resetGameToOpening,
    applyOpeningConfig,
  }
}
