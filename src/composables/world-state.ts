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
}

export function applyValidatedDelta(delta: WorldDelta): ApplyResult {
  const snap = snapshotWorldState()
  const v = validateWorldDelta(delta, snap)
  if (!v.ok) return { lines: [], changed: false }
  const { snap: next, result } = applyWorldDeltaToSnapshot(delta, snap)
  restoreWorldState(next)
  return result
}
