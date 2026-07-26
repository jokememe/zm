/**
 * Live world snapshot / restore / apply validated delta
 */
import type { WorldDelta, WorldSnapshot, ApplyResult } from '@/types/world'
import type { Resources } from '@/types/game'
import { useGameState } from '@/composables/useGameState'
import { validateWorldDelta, applyWorldDeltaToSnapshot } from '@/composables/world-delta'
import type { Ref } from 'vue'

function unrefVal<T>(v: T | Ref<T>): T {
  if (v && typeof v === 'object' && 'value' in (v as object)) {
    return (v as Ref<T>).value
  }
  return v as T
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

export function snapshotWorldState(): WorldSnapshot {
  const gs = useGameState()
  const resources = unrefVal(gs.resources as Resources | Ref<Resources>)
  // resources is reactive object, not Ref
  const res =
    resources && typeof resources === 'object' && 'spiritStone' in (resources as object)
      ? (resources as Resources)
      : (gs.resources as Resources)

  return {
    resources: { ...res },
    calendar: {
      year: gs.calendar.year,
      season: gs.calendar.season,
      day: gs.calendar.day,
    },
    sectName: String(unrefVal(gs.sectName) ?? ''),
    masterName: String(unrefVal(gs.masterName) ?? ''),
    disciples: clone(unrefVal(gs.disciples) || []),
    factions: clone(unrefVal(gs.factions) || []),
    cities: clone(unrefVal(gs.cities) || []),
    notifications: clone(unrefVal(gs.notifications) || []),
    fieldPlots: clone(unrefVal(gs.fieldPlots) || []),
    urgentEvents: clone(unrefVal(gs.urgentEvents) || []),
    manuals: clone(unrefVal(gs.manuals) || []),
    treasures: clone(unrefVal(gs.treasures) || []),
    forgeQueue: clone(unrefVal(gs.forgeQueue) || []),
    relationEdges: clone(unrefVal(gs.relationEdges) || []),
    heirs: clone(unrefVal(gs.heirs) || []),
  }
}

export function restoreWorldState(snap: WorldSnapshot): void {
  const gs = useGameState()
  Object.assign(gs.resources, snap.resources)
  gs.calendar.year = snap.calendar.year
  gs.calendar.season = snap.calendar.season
  gs.calendar.day = snap.calendar.day
  // sect/master are refs
  const sect = gs.sectName as Ref<string> | string
  const master = gs.masterName as Ref<string> | string
  if (sect && typeof sect === 'object' && 'value' in sect) sect.value = snap.sectName
  if (master && typeof master === 'object' && 'value' in master) master.value = snap.masterName

  const setRef = <T>(r: Ref<T> | T, val: T) => {
    if (r && typeof r === 'object' && 'value' in (r as object)) {
      ;(r as Ref<T>).value = val
    }
  }
  setRef(gs.disciples as Ref<typeof snap.disciples>, clone(snap.disciples))
  setRef(gs.factions as Ref<typeof snap.factions>, clone(snap.factions))
  setRef(gs.cities as Ref<typeof snap.cities>, clone(snap.cities))
  setRef(gs.notifications as Ref<typeof snap.notifications>, clone(snap.notifications))
  // 旧 stateAfter 无 fieldPlots/urgentEvents：保留当前 live，避免误清空
  if (Array.isArray(snap.fieldPlots)) {
    setRef(gs.fieldPlots as Ref<typeof snap.fieldPlots>, clone(snap.fieldPlots))
  }
  if (Array.isArray(snap.urgentEvents)) {
    setRef(gs.urgentEvents as Ref<typeof snap.urgentEvents>, clone(snap.urgentEvents))
  }
  if (Array.isArray(snap.manuals)) {
    setRef(gs.manuals as Ref<NonNullable<typeof snap.manuals>>, clone(snap.manuals))
  }
  if (Array.isArray(snap.treasures)) {
    setRef(gs.treasures as Ref<NonNullable<typeof snap.treasures>>, clone(snap.treasures))
  }
  if (Array.isArray(snap.forgeQueue)) {
    setRef(gs.forgeQueue as Ref<NonNullable<typeof snap.forgeQueue>>, clone(snap.forgeQueue))
  }
  if (Array.isArray(snap.relationEdges)) {
    setRef(
      gs.relationEdges as Ref<NonNullable<typeof snap.relationEdges>>,
      clone(snap.relationEdges),
    )
  }
  if (Array.isArray(snap.heirs)) {
    setRef(gs.heirs as Ref<NonNullable<typeof snap.heirs>>, clone(snap.heirs))
    const des = snap.heirs.find((h) => h.designated)
    if (des) {
      setRef(gs.designatedHeirId as Ref<string>, des.id)
    }
  }
  // 删楼回滚 / disciple.add 等 apply 后立即同步最小存档（勿仅 debounce）
  try {
    if (typeof gs.persistGameSave === 'function') {
      gs.persistGameSave()
    }
  } catch {
    /* ignore */
  }
}

export function applyValidatedDelta(delta: WorldDelta): ApplyResult {
  const snap = snapshotWorldState()
  const v = validateWorldDelta(delta, snap)
  if (!v.ok || !v.delta) return { lines: [], changed: false }
  const clean = v.delta
  const hasRes = clean.resources && Object.keys(clean.resources).length > 0
  const hasOps = (clean.ops?.length ?? 0) > 0
  if (!hasRes && !hasOps) return { lines: [], changed: false }

  const { snap: next, result } = applyWorldDeltaToSnapshot(clean, snap)
  restoreWorldState(next)

  // 注：角色改名后，叙事图谱同名旧节点由 removeMemoryGraphNodeByName 在除名时清理；
  // 改名本身不自动迁移旧节点近事（已知限制，见清理方案文档风险 B）。
  return result
}
