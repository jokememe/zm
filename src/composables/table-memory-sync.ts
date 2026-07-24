/**
 * 游戏经营数据 → 表格记忆同步（可被 UI / 天机 / 开局调用）
 */
import { useGameState } from '@/composables/useGameState'
import { getDifficulty } from '@/data/opening'
import {
  loadTableMemory,
  saveTableMemory,
  syncRowsFromGameSnapshot,
  formatWorldStateInjection,
  countAllRecords,
  type TableMemoryState,
} from '@/composables/table-memory'

/** 从当前游戏状态构建同步快照（宝物/锻器/秘籍等均读 live） */
export function buildGameMemorySnapshot() {
  const gs = useGameState()
  const diff = getDifficulty(gs.difficulty.value)
  const master = String(gs.masterName.value || '掌门')
  return {
    sectName: String(gs.sectName.value || '本宗'),
    masterName: master,
    difficultyLabel: diff.label,
    year: gs.calendar.year,
    season: String(gs.calendar.season || ''),
    disciples: (gs.disciples.value || []).map((d) => ({
      name: d.name,
      age: d.age,
      gender: d.gender,
      role: d.role,
      realm: d.realm,
      status: d.status,
      mood: d.mood,
      loyalty: d.loyalty,
      talent: d.talent,
      master: d.master,
      spouse: d.spouse,
    })),
    treasures: (gs.treasures.value || []).map((t) => ({
      name: t.name,
      type: t.type,
      grade: t.grade,
      owner: t.owner === '沈青岚' ? master : t.owner,
      desc: t.desc,
      bound: t.bound,
    })),
    forgeQueue: (gs.forgeQueue.value || []).map((g) => ({
      name: g.name,
      type: g.type,
      grade: g.grade,
      craftsman: g.craftsman,
      progress: g.progress,
      power: g.power,
    })),
    factions: (gs.factions.value || []).map((f) => ({
      name: f.name,
      stance: f.stance,
      relation: f.relation,
      power: f.power,
      recent: f.recent,
      demand: f.demand,
    })),
    cities: (gs.cities.value || []).map((c) => ({
      name: c.name,
      attitude: c.attitude,
      influence: c.influence,
      governor: c.governor,
      notes: c.notes,
      distance: c.distance,
    })),
  }
}

/**
 * 把经营侧名册/势力/宝物同步进表格记忆并落盘。
 * 推演前与开局后应调用，保证注入块有真实行。
 */
export function syncTableMemoryFromGame(): {
  state: TableMemoryState
  counts: { characters: number; items: number; world: number }
  total: number
  injection: string
} {
  loadTableMemory()
  const snap = buildGameMemorySnapshot()
  const counts = syncRowsFromGameSnapshot(snap)
  saveTableMemory()
  const state = loadTableMemory()
  return {
    state,
    counts,
    total: countAllRecords(state),
    injection: formatWorldStateInjection(state),
  }
}
