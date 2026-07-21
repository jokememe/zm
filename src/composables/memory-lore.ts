/**
 * 短 / 中 / 长期记忆 — 动态写入系统世界书（constant 常驻）
 */
import {
  MEMORY_STORAGE_KEY,
  type DifficultyId,
} from '@/data/opening'

export interface MemoryBank {
  short: string[]
  mid: string
  long: string[]
  turn: number
}

const SHORT_MAX = 5
/** 每累计这么多短期条，折叠进中期 */
const COMPRESS_EVERY = 5
const MID_MAX_CHARS = 900
const LONG_MAX = 24

const LONG_HINT =
  /大战|血战|结盟|破境|叛离|继位|陨落|灭门|婚|签|约|矿脉|开宗|闭关破境|夺|战败|惨胜|反目|师徒|道侣|纳贡|灭|亡|即位|掌门印|气运大变/

export const MEM_SHORT_ID = 'mem-short'
export const MEM_MID_ID = 'mem-mid'
export const MEM_LONG_ID = 'mem-long'

function emptyBank(): MemoryBank {
  return { short: [], mid: '', long: [], turn: 0 }
}

let bank: MemoryBank = emptyBank()

export function loadMemoryBank(): MemoryBank {
  try {
    const raw = localStorage.getItem(MEMORY_STORAGE_KEY)
    if (!raw) {
      bank = emptyBank()
      return bank
    }
    const o = JSON.parse(raw) as Partial<MemoryBank>
    bank = {
      short: Array.isArray(o.short) ? o.short.map(String).slice(-SHORT_MAX) : [],
      mid: typeof o.mid === 'string' ? o.mid : '',
      long: Array.isArray(o.long) ? o.long.map(String).slice(-LONG_MAX) : [],
      turn: typeof o.turn === 'number' ? o.turn : 0,
    }
    return bank
  } catch {
    bank = emptyBank()
    return bank
  }
}

export function getMemoryBank(): MemoryBank {
  return bank
}

export function saveMemoryBank() {
  try {
    localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(bank))
  } catch {
    /* ignore */
  }
}

export function clearMemoryBank() {
  bank = emptyBank()
  try {
    localStorage.removeItem(MEMORY_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/** 开局时写入一条长期底子 */
export function seedOpeningMemory(opts: {
  sectName: string
  masterName: string
  difficulty: DifficultyId
  difficultyLabel: string
}) {
  loadMemoryBank()
  clearMemoryBank()
  bank.long.push(
    `【开局】${opts.masterName} 继任${opts.sectName}掌门；难度：${opts.difficultyLabel}。残峰再起，赤焰谷已至山门。`,
  )
  saveMemoryBank()
}

/**
 * 每回合 LLM 返回的 <sum> 写入短期；满额折叠中期；重大事件进长期。
 */
export function recordTurnSum(sum: string, meta?: { context?: string | null }) {
  const text = sum.trim().replace(/\s+/g, ' ')
  if (!text) return bank

  loadMemoryBank()
  bank.turn += 1
  const line = meta?.context
    ? `第${bank.turn}回〔${meta.context}〕${text}`
    : `第${bank.turn}回 ${text}`

  bank.short.push(line)
  if (bank.short.length > SHORT_MAX) {
    bank.short = bank.short.slice(-SHORT_MAX)
  }

  // 每 COMPRESS_EVERY 回合，把当前短期并入中期
  if (bank.turn % COMPRESS_EVERY === 0 && bank.short.length) {
    const chunk = bank.short.join('；')
    bank.mid = [bank.mid, chunk].filter(Boolean).join('\n')
    if (bank.mid.length > MID_MAX_CHARS) {
      bank.mid = '…' + bank.mid.slice(-(MID_MAX_CHARS - 1))
    }
  }

  if (LONG_HINT.test(text)) {
    bank.long.push(line)
    if (bank.long.length > LONG_MAX) {
      bank.long = bank.long.slice(-LONG_MAX)
    }
  }

  saveMemoryBank()
  return bank
}

export function formatShortMemory(b: MemoryBank = bank): string {
  if (!b.short.length) {
    return '【短期记忆】尚无回合小结。推演后将自动记录近几回 <sum>。'
  }
  return `【短期记忆 · 近 ${b.short.length} 回】\n${b.short.map((s) => `· ${s}`).join('\n')}`
}

export function formatMidMemory(b: MemoryBank = bank): string {
  if (!b.mid.trim()) {
    return '【中期记忆】尚未形成。每满数回短期小结将折叠至此。'
  }
  return `【中期记忆 · 阶段脉络】\n${b.mid}`
}

export function formatLongMemory(b: MemoryBank = bank): string {
  if (!b.long.length) {
    return '【长期记忆】尚无大事纪要。开宗、大战、结盟、破境、叛离等将记入。'
  }
  return `【长期记忆 · 不可逆大事】\n${b.long.map((s) => `· ${s}`).join('\n')}`
}
