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
  AlchemyRecipe,
} from '@/types/game'
import {
  resources as initialResources,
  notifications as initialNotifications,
  disciples as initialDisciples,
  heirs as initialHeirs,
  factions as initialFactions,
  cities as initialCities,
  alchemyRecipes as seedAlchemyRecipes,
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
import { seasonAtOffset } from '@/composables/timeline-seasons'
import {
  applyStocksToRecipes,
  buildGameSave,
  clearGameSaveFromStorage,
  loadGameSaveFromStorage,
  stocksFromRecipes,
  writeGameSaveToStorage,
  type GameSaveV1,
} from '@/composables/game-save'
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
import {
  clearTableMemory,
  seedOpeningTableMemory,
} from '@/composables/table-memory'

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

/** 炼丹配方库存（可写；种子来自 mock） */
function cloneAlchemySeed(): AlchemyRecipe[] {
  return seedAlchemyRecipes.map((r) => ({ ...r, cost: { ...r.cost } }))
}
const alchemyRecipes = ref<AlchemyRecipe[]>(cloneAlchemySeed())

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

const pillStockTotal = computed(() =>
  alchemyRecipes.value.reduce((s, r) => s + (r.stock || 0), 0),
)

function capturePayload() {
  return {
    sectName: sectName.value,
    masterName: masterName.value,
    difficulty: difficulty.value,
    resources: { ...resources },
    calendar: {
      era: calendar.era,
      year: calendar.year,
      season: calendar.season,
      day: calendar.day,
      hour: calendar.hour,
      weather: calendar.weather,
    },
    disciples: disciples.value,
    factions: factions.value,
    cities: cities.value,
    notifications: notifications.value,
    fieldPlots: fieldPlots.value,
    urgentEvents: urgentEvents.value,
    designatedHeirId: designatedHeirId.value,
    alchemyStocks: stocksFromRecipes(alchemyRecipes.value),
  }
}

function applySaveBlob(save: GameSaveV1) {
  sectName.value = save.sectName || sectName.value
  masterName.value = save.masterName || masterName.value
  difficulty.value = save.difficulty
  Object.assign(resources, save.resources)
  Object.assign(calendar, save.calendar)
  disciples.value = save.disciples.map((d) => ({ ...d }))
  factions.value = save.factions.map((f) => ({ ...f }))
  cities.value = save.cities.map((c) => ({ ...c }))
  notifications.value = save.notifications.map((n) => ({ ...n }))
  fieldPlots.value = save.fieldPlots.map((f) => ({ ...f }))
  urgentEvents.value = save.urgentEvents.map((e) => ({
    ...e,
    choices: (e.choices || []).map((c) => ({
      ...c,
      resourceDelta: c.resourceDelta ? { ...c.resourceDelta } : undefined,
    })),
  }))
  designatedHeirId.value = save.designatedHeirId
  alchemyRecipes.value = applyStocksToRecipes(cloneAlchemySeed(), save.alchemyStocks)
}

/** 启动时若有存档且已开局过，恢复经营态 */
function tryHydrateOnBoot() {
  if (typeof window === 'undefined') return
  if (!openingDone.value) return
  const save = loadGameSaveFromStorage()
  if (!save) return
  try {
    applySaveBlob(save)
  } catch (e) {
    console.warn('[存档] 启动恢复失败', e)
  }
}
tryHydrateOnBoot()

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
    schedulePersist()
  }

  function markAllNotificationsRead() {
    notifications.value = notifications.value.map((n) => ({ ...n, read: true }))
    schedulePersist()
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
    schedulePersist()
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
      time: '方才',
      category: '决议',
      read: true,
    }
    notifications.value = [note, ...notifications.value]
    schedulePersist()

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
    schedulePersist()
  }

  function setDesignatedHeir(id: string) {
    designatedHeirId.value = id
    schedulePersist()
  }

  /**
   * 指派弟子打理灵田：写入 live fieldPlots.assigned。
   * 闲田且有人看管时，下一季 tick 会自动复种（见 season-settle tickFields）。
   */
  function assignFieldPlot(
    plotId: string,
    discipleName: string,
  ): { ok: true; plotName: string; assigned: string } | { ok: false; error: string } {
    const name = (discipleName || '').trim()
    if (!name) return { ok: false, error: '须指定弟子名' }
    const idx = fieldPlots.value.findIndex((f) => f.id === plotId)
    if (idx < 0) return { ok: false, error: '灵田不存在' }
    const plot = fieldPlots.value[idx]
    const next = [...fieldPlots.value]
    next[idx] = { ...plot, assigned: name }
    fieldPlots.value = next
    schedulePersist()
    return { ok: true, plotName: plot.name, assigned: name }
  }

  /**
   * 炼丹：扣丹材/灵石，对应配方 stock+1。
   */
  function craftAlchemy(
    recipeId: string,
  ):
    | { ok: true; name: string; stock: number }
    | { ok: false; error: string } {
    const idx = alchemyRecipes.value.findIndex((r) => r.id === recipeId)
    if (idx < 0) return { ok: false, error: '丹方不存在' }
    const recipe = alchemyRecipes.value[idx]
    if (resources.herb < recipe.cost.herb) {
      return { ok: false, error: `丹材不足（需 ${recipe.cost.herb}）` }
    }
    if (resources.spiritStone < recipe.cost.spiritStone) {
      return { ok: false, error: `灵石不足（需 ${recipe.cost.spiritStone}）` }
    }
    adjustResource({
      herb: -recipe.cost.herb,
      spiritStone: -recipe.cost.spiritStone,
    })
    const stock = recipe.stock + 1
    const next = [...alchemyRecipes.value]
    next[idx] = { ...recipe, stock }
    alchemyRecipes.value = next
    schedulePersist()
    return { ok: true, name: recipe.name, stock }
  }

  let persistTimer: ReturnType<typeof setTimeout> | null = null
  function schedulePersist() {
    if (!openingDone.value) return
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = null
      persistGameSave()
    }, 200)
  }

  function persistGameSave(): boolean {
    try {
      const save = buildGameSave(capturePayload())
      return writeGameSaveToStorage(save)
    } catch (e) {
      console.warn('[存档] 写入失败', e)
      return false
    }
  }

  function hydrateFromSave(): boolean {
    const save = loadGameSaveFromStorage()
    if (!save) return false
    applySaveBlob(save)
    openingDone.value = true
    showOpening.value = false
    return true
  }

  /**
   * 推进一季：历法 + 本地汇总（灵田/纳贡/修炼/外交/维护），返回结算明细行。
   * 主 API 季报待决由 UI 在此之后调用，不在此函数内打网。
   */
  function advanceSeason(): { lines: string[]; summary: string } {
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

    const next = seasonAtOffset(calendar.year, calendar.season, 1)
    calendar.year = next.year
    calendar.season = next.season
    calendar.day = 1

    const summary = formatSeasonSettleSummary(settled.lines)
    schedulePersist()
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
    persistGameSave()
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
    alchemyRecipes.value = cloneAlchemySeed()
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
      seedOpeningTableMemory()
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
    clearTableMemory()
    clearIdentity()
    clearGameSaveFromStorage()
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
    alchemyRecipes.value = cloneAlchemySeed()
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
    alchemyRecipes,
    pillStockTotal,
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
    assignFieldPlot,
    craftAlchemy,
    persistGameSave,
    hydrateFromSave,
    advanceSeason,
    markOpeningDone,
    replayOpening,
    resetGameToOpening,
    applyOpeningConfig,
  }
}
