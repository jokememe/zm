/**
 * 气数簿 ↔ 经营资源 白名单桥接
 * LLM / 手改变量只允许通过白名单改档。
 */
import { useGameState } from '@/composables/useGameState'
import type { Resources } from '@/types/game'
import { getDifficulty } from '@/data/opening'
import type { Ref } from 'vue'

/** 变量名 → 资源键（可写） */
export const RESOURCE_VAR_MAP = {
  灵石: 'spiritStone',
  灵谷: 'spiritGrain',
  丹材: 'herb',
  矿铁: 'ore',
  声望: 'prestige',
  气运: 'destiny',
} as const satisfies Record<string, keyof Resources>

export type ResourceVarName = keyof typeof RESOURCE_VAR_MAP

/** 只读注入 prompt 的字段 */
export const READONLY_VAR_KEYS = ['年', '季', '日', '宗门', '掌门', '难度'] as const

export const WRITABLE_VAR_NAMES = Object.keys(RESOURCE_VAR_MAP) as ResourceVarName[]

export function isWritableVarName(name: string): name is ResourceVarName {
  return name in RESOURCE_VAR_MAP
}

function unrefStr(v: unknown): string {
  if (v && typeof v === 'object' && 'value' in (v as Ref)) {
    return String((v as Ref).value ?? '')
  }
  return String(v ?? '')
}

/**
 * 严格十进制：仅 ±整数/小数，拒绝 1e2、0x10、Infinity、空串。
 * 全角减号 −–— 先归一成 ASCII `-`。
 */
export function parseStrictDecimal(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null
  }
  if (raw === undefined || raw === null) return null
  const s = String(raw)
    .trim()
    .replace(/^[−–—]/, '-')
  if (!s) return null
  // 禁止科学计数 / hex / 尾随杂字
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** 是否为显式相对写法（以 + / - 开头的严格小数串） */
export function isExplicitRelativeString(raw: unknown): boolean {
  if (typeof raw !== 'string' && typeof raw !== 'number') return false
  if (typeof raw === 'number') return raw < 0 // 负数当相对
  const s = String(raw)
    .trim()
    .replace(/^[−–—]/, '-')
  return /^[+-](?:\d+(?:\.\d+)?|\.\d+)$/.test(s)
}

/**
 * 气数簿 / 会话变量写入用。
 * - 负数（JSON number 或 "-10"）→ 相对变化（库存无负绝对值语义）
 * - 非负裸数字 → 绝对值
 * - 显式 "+10"/"-5" 字符串 → 相对
 * - 1e2 / 0x10 / junk → 保持 current
 */
export function resolveNumericValue(current: number, incoming: string | number): number {
  if (typeof incoming === 'number' && Number.isFinite(incoming)) {
    // 负库存无意义：负数一律按相对减（修 灵石:-10 → 夹成 0）
    if (incoming < 0) return Math.max(0, Math.round(current + incoming))
    return Math.max(0, Math.round(incoming))
  }
  const s = String(incoming ?? '')
    .trim()
    .replace(/^[−–—]/, '-')
  if (s === '') return current
  // 显式 ± 相对
  if (/^[+-](?:\d+(?:\.\d+)?|\.\d+)$/.test(s)) {
    return Math.max(0, Math.round(current + Number(s)))
  }
  // 裸正数绝对值（拒绝 1e2 / 0x10）
  const n = parseStrictDecimal(s)
  if (n === null) return current
  if (n < 0) return Math.max(0, Math.round(current + n))
  return Math.max(0, Math.round(n))
}

/**
 * 气数簿 UI 原始字符串 → 写入值。
 * 空串 / 非法数字 → undefined（跳过，勿 Number('')→0）。
 * ±N 保留相对串；裸十进制 → number。
 */
export function coerceEditorVarInput(
  raw: unknown,
): string | number | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  const s = String(raw)
    .trim()
    .replace(/^[−–—]/, '-')
  if (s === '') return undefined
  // 显式相对：+10 / -5
  if (/^[+-](?:\d+(?:\.\d+)?|\.\d+)$/.test(s)) return s
  const n = parseStrictDecimal(s)
  if (n !== null) return n
  // junk：不写入（自定义键若需要明文，调用方另处理非白名单）
  return undefined
}

/**
 * 结算 resources 专用：一律按相对变化叠加。
 * JSON 数字 -10 表示「减 10」，不是「设为 -10→夹成 0」。
 * 裸字符串 "10"/"-10" 同样按相对量处理（与 SETTLE_CONTRACT 一致）。
 * 拒绝 1e2 / 0x10 等非严格十进制，避免误加。
 */
export function resolveRelativeResourceValue(
  current: number,
  incoming: string | number,
): number {
  if (typeof incoming === 'number' && Number.isFinite(incoming)) {
    return Math.max(0, Math.round(current + incoming))
  }
  const n = parseStrictDecimal(incoming)
  if (n === null) return current
  return Math.max(0, Math.round(current + n))
}

/** 从游戏状态快照气数（含只读） */
export function snapshotGameVariables(): Record<string, string | number> {
  const gs = useGameState()
  const r = gs.resources
  const cal = gs.calendar
  const diffId = unrefStr(gs.difficulty) as 'standard' | 'hard' | 'hardcore'
  return {
    灵石: r.spiritStone,
    灵谷: r.spiritGrain,
    丹材: r.herb,
    矿铁: r.ore,
    声望: r.prestige,
    气运: r.destiny,
    年: cal.year,
    季: cal.season,
    日: cal.day,
    宗门: unrefStr(gs.sectName),
    掌门: unrefStr(gs.masterName),
    难度: getDifficulty(diffId || 'standard').label,
  }
}

export interface ApplyVarsResult {
  applied: Partial<Record<ResourceVarName, number>>
  changed: boolean
  lines: string[]
}

/**
 * 将变量白名单写回经营资源。
 * 支持绝对数值与相对字符串。
 */
export function applyVariablesToGame(
  variables: Record<string, unknown>,
): ApplyVarsResult {
  const gs = useGameState()
  const applied: Partial<Record<ResourceVarName, number>> = {}
  const lines: string[] = []
  let changed = false

  for (const name of WRITABLE_VAR_NAMES) {
    if (!(name in variables)) continue
    const key = RESOURCE_VAR_MAP[name]
    const current = gs.resources[key]
    const next = resolveNumericValue(current, variables[name] as string | number)
    if (next !== current) {
      gs.resources[key] = next
      applied[name] = next
      lines.push(`${name} ${current} → ${next}`)
      changed = true
    }
  }

  return { applied, changed, lines }
}

/** 会话变量与游戏快照合并：白名单以游戏为准（结算后），其余会话键保留 */
export function mergeSessionWithGame(
  sessionVars: Record<string, unknown> = {},
): Record<string, string | number> {
  const snap = snapshotGameVariables()
  const out: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(sessionVars)) {
    if (v === undefined || v === null) continue
    if (typeof v === 'string' || typeof v === 'number') out[k] = v
    else out[k] = String(v)
  }
  for (const [k, v] of Object.entries(snap)) {
    out[k] = v
  }
  return out
}

/** 手改气数簿：先写游戏，再返回应持久化的完整 variables */
export function commitVariablesFromEditor(
  draft: Record<string, string | number>,
  sessionVars: Record<string, unknown> = {},
): Record<string, string | number> {
  applyVariablesToGame(draft)
  const rest: Record<string, unknown> = { ...sessionVars, ...draft }
  return mergeSessionWithGame(rest)
}

function unrefList<T>(raw: unknown): T[] {
  if (raw && typeof raw === 'object' && 'value' in (raw as Ref)) {
    return ((raw as Ref<T[]>).value || []) as T[]
  }
  return (raw as T[]) || []
}

/** 系统世界书正文：局面摘要 */
export function buildLiveLoreContent(extra?: {
  contextLabel?: string | null
  contextDetail?: string | null
}): string {
  const gs = useGameState()
  const snap = snapshotGameVariables()
  const disciples = unrefList<{
    name: string
    realm: string
    role: string
    status: string
  }>(gs.disciples)
  const factions = unrefList<{
    name: string
    relation: number
    stance: string
  }>(gs.factions)
  const cities = unrefList<{
    name: string
    attitude: string
    influence: number
  }>(gs.cities)

  const discLine =
    disciples.length === 0
      ? '（无人）'
      : disciples
          .slice(0, 12)
          .map((d) => `${d.name}（${d.realm}·${d.role}·${d.status}）`)
          .join('、') + (disciples.length > 12 ? ` 等${disciples.length}人` : '')

  const factionLine =
    factions.length === 0
      ? '（无）'
      : factions
          .slice(0, 8)
          .map((f) => `${f.name}(${f.relation}/${f.stance})`)
          .join('、')

  const cityLine =
    cities.length === 0
      ? '（无）'
      : cities
          .slice(0, 8)
          .map((c) => `${c.name}(${c.attitude}·影响${c.influence})`)
          .join('、')

  const lines = [
    '【宗门当前实况 · 系统自动更新，请据此推演；与记忆条目一并常驻】',
    `宗门：${snap['宗门']}　掌门：${snap['掌门']}　难度：${snap['难度']}`,
    `历法：天元 ${snap['年']} 年 ${snap['季']} 第 ${snap['日']} 日`,
    `资源：灵石 ${snap['灵石']} · 灵谷 ${snap['灵谷']} · 丹材 ${snap['丹材']} · 矿铁 ${snap['矿铁']}`,
    `气数：声望 ${snap['声望']} · 气运 ${snap['气运']}`,
    `在册弟子（${disciples.length}）：${discLine}`,
    `势力：${factionLine}`,
    `城池：${cityLine}`,
  ]
  if (extra?.contextLabel) {
    lines.push(
      `当前事务：${extra.contextLabel}${
        extra.contextDetail ? ` — ${extra.contextDetail}` : ''
      }`,
    )
  }
  lines.push(
    '结算约定：本回结束后系统会自动分析玩家发言与正文，改写资源/名册/势力/城池。勿依赖 <vars>。',
    '记忆约定：须输出 <sum> 一句话总结；系统将写入短期记忆，并择要入中长期。',
  )
  return lines.join('\n')
}

export const SYSTEM_LOREBOOK_ID = 'zongmen-live-lore'
export const SYSTEM_LOREBOOK_NAME = '宗门实况'
