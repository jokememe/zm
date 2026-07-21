import { computed, reactive, ref } from 'vue'
import type { Resources, ViewId, NotificationItem, Disciple } from '@/types/game'
import {
  resources as initialResources,
  notifications as initialNotifications,
  disciples as initialDisciples,
  heirs as initialHeirs,
  CALENDAR,
  SECT_NAME as DEFAULT_SECT,
  MASTER_NAME as DEFAULT_MASTER,
} from '@/data/mock'
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

const disciples = ref<Disciple[]>(
  openingDone.value
    ? initialDisciples.map((d) => ({ ...d }))
    : pickDisciplesForDifficulty(difficulty.value),
)
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

  function advanceSeason() {
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
    const idx = order.indexOf(calendar.season)
    if (idx === order.length - 1 || idx === -1) {
      calendar.year += 1
      calendar.season = '孟春'
    } else {
      calendar.season = order[idx + 1]
    }
    calendar.day = 1
    adjustResource({
      spiritGrain: 180,
      spiritStone: -30,
      herb: 8,
      prestige: 1,
    })
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
    notifications.value = buildOpeningNotifications(master, name) as NotificationItem[]
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

    seedOpeningMemory({
      sectName: name,
      masterName: master,
      difficulty: diff,
      difficultyLabel: opt.label,
    })

    saveIdentity({ sectName: name, masterName: master, difficulty: diff })
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
    disciples.value = pickDisciplesForDifficulty('standard')
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
    disciples,
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
    adjustResource,
    setDesignatedHeir,
    advanceSeason,
    markOpeningDone,
    replayOpening,
    resetGameToOpening,
    applyOpeningConfig,
  }
}
