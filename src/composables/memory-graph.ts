/**
 * 叙事记忆图谱（方案 C + 无限记忆底座）：
 * - 热层：节点 + 边 + 每节点近况 beats（窗口）
 * - 冷层：memory-archive 全量 beats（IndexedDB + 镜像），有线索可闪回
 * 与经营 relationEdges 分离。
 */
import { MEMORY_GRAPH_STORAGE_KEY } from '@/data/opening'
import {
  appendArchiveBeats,
  clearMemoryArchive,
  formatArchiveFlashback,
  removeArchiveBeatsByNodeId,
  searchArchiveBeats,
  type ArchiveBeat,
} from '@/composables/memory-archive'

/** 热窗口：节点上保留的近事条数（更早的在冷档案） */
const HOT_BEAT_MAX = 16

// 本地姓名归一化（原来自 table-memory，解耦后自留）
function normalizeName(value: string): string {
  return String(value || '')
    .normalize('NFKC')
    .replace(/^[#*]+/, '')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase()
}

function cleanColumnName(column: string): string {
  return String(column || '')
    .trim()
    .replace(/^[#*]+/, '')
    .trim()
}

export type MemoryGraphNodeKind = 'character' | 'event' | 'item' | 'place' | 'other'

export type MemoryGraphEdgeType =
  | '师徒'
  | '道侣'
  | '结义'
  | '仇恨'
  | '竞争'
  | '血缘'
  | '约定'
  | '人际'
  | '其他'

export interface MemoryGraphBeat {
  id: string
  text: string
  at?: number
  /** 游戏历法：写入时的年 */
  year?: number
  /** 游戏历法：写入时的季 */
  season?: string
}

export interface MemoryGraphNode {
  id: string
  kind: MemoryGraphNodeKind
  name: string
  /** 展示用属性（性格、位置、身份等） */
  attrs: Record<string, string>
  beats: MemoryGraphBeat[]
  updatedAt: number
}

export interface MemoryGraphEdge {
  id: string
  from: string
  to: string
  type: MemoryGraphEdgeType
  note: string
  intensity?: number
  updatedAt: number
}

export interface MemoryGraphState {
  version: 1
  nodes: MemoryGraphNode[]
  edges: MemoryGraphEdge[]
}

export interface MemoryGraphNodePatch {
  name: string
  kind?: MemoryGraphNodeKind
  attrs?: Record<string, string>
  /** 追加近事（非替换） */
  beat?: string
  /** beat 对应的游戏历法年 */
  beatYear?: number
  /** beat 对应的游戏历法季 */
  beatSeason?: string
  /** 改名：旧名，合并到新 name */
  formerName?: string
}

export interface MemoryGraphEdgePatch {
  from: string
  to: string
  type?: MemoryGraphEdgeType | string
  note?: string
  intensity?: number
}

export interface MemoryGraphPatch {
  nodes?: MemoryGraphNodePatch[]
  edges?: MemoryGraphEdgePatch[]
}

export interface MemoryGraphSlice {
  node: MemoryGraphNode | null
  edges: Array<MemoryGraphEdge & { otherName: string; direction: 'out' | 'in' }>
  empty: boolean
}

const EDGE_TYPES = new Set<string>([
  '师徒',
  '道侣',
  '结义',
  '仇恨',
  '竞争',
  '血缘',
  '约定',
  '人际',
  '其他',
])

export function createEmptyMemoryGraph(): MemoryGraphState {
  return { version: 1, nodes: [], edges: [] }
}

function now(): number {
  return Date.now()
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`
}

export function nodeIdForName(name: string): string {
  const n = normalizeName(name)
  return n ? `n_${n}` : newId('n')
}

export function edgeIdFor(from: string, to: string, type: string): string {
  return `e_${normalizeName(from)}__${normalizeName(type)}__${normalizeName(to)}`
}

export function normalizeEdgeType(raw?: string): MemoryGraphEdgeType {
  const t = String(raw || '').trim()
  if (EDGE_TYPES.has(t)) return t as MemoryGraphEdgeType
  if (/师|徒/.test(t)) return '师徒'
  if (/侣|婚|情/.test(t)) return '道侣'
  if (/义|兄弟|结拜/.test(t)) return '结义'
  if (/仇|恨|敌/.test(t)) return '仇恨'
  if (/竞|争|对/.test(t)) return '竞争'
  if (/血|亲|父|母|兄|弟|姐|妹/.test(t)) return '血缘'
  if (/约|诺|誓/.test(t)) return '约定'
  if (t) return '人际'
  return '其他'
}

export function findNodeByName(
  g: MemoryGraphState,
  name: string,
): MemoryGraphNode | undefined {
  const key = normalizeName(name)
  if (!key) return undefined
  return g.nodes.find((n) => normalizeName(n.name) === key)
}

/** 应用补丁：节点 upsert / 改名合并 / 边 upsert */
export function applyMemoryGraphPatch(
  g: MemoryGraphState,
  patch: MemoryGraphPatch,
): MemoryGraphState {
  const next: MemoryGraphState = {
    version: 1,
    nodes: g.nodes.map((n) => ({
      ...n,
      attrs: { ...n.attrs },
      beats: [...(n.beats || [])],
    })),
    edges: g.edges.map((e) => ({ ...e })),
  }
  const ts = now()

  for (const np of patch.nodes || []) {
    const name = String(np.name || '').trim()
    if (!name) continue
    const former = String(np.formerName || '').trim()
    let node = former ? findNodeByName(next, former) : findNodeByName(next, name)
    if (!node && former) node = findNodeByName(next, name)

    if (!node) {
      node = {
        id: nodeIdForName(name),
        kind: np.kind || 'character',
        name,
        attrs: {},
        beats: [],
        updatedAt: ts,
      }
      next.nodes.push(node)
    } else {
      // 改名：更新 name，并修正边端点显示用 id 不变
      if (former && normalizeName(former) !== normalizeName(name)) {
        node.name = name
      } else if (normalizeName(node.name) !== normalizeName(name)) {
        node.name = name
      }
      if (np.kind) node.kind = np.kind
    }

    if (np.attrs) {
      for (const [k, v] of Object.entries(np.attrs)) {
        const key = cleanColumnName(k)
        const val = String(v ?? '').trim()
        if (!key || !val) continue
        node.attrs[key] = val
      }
    }
    if (np.beat && String(np.beat).trim()) {
      const text = String(np.beat).trim()
      if (!node.beats.some((b) => b.text === text)) {
        const beat = {
          id: newId('b'),
          text,
          at: ts,
          year: np.beatYear,
          season: np.beatSeason,
        }
        node.beats.unshift(beat)
        if (node.beats.length > HOT_BEAT_MAX) {
          node.beats = node.beats.slice(0, HOT_BEAT_MAX)
        }
        // 冷档案：全量保留，不因热窗口丢
        appendArchiveBeats([
          {
            id: beat.id,
            nodeId: node.id,
            nodeName: node.name,
            text: beat.text,
            at: beat.at || ts,
            year: beat.year,
            season: beat.season,
          } satisfies ArchiveBeat,
        ])
      }
    }
    node.updatedAt = ts
  }

  const ensureCharacter = (name: string): MemoryGraphNode => {
    let node = findNodeByName(next, name)
    if (node) return node
    node = {
      id: nodeIdForName(name),
      kind: 'character',
      name,
      attrs: {},
      beats: [],
      updatedAt: ts,
    }
    next.nodes.push(node)
    return node
  }

  for (const ep of patch.edges || []) {
    const fromName = String(ep.from || '').trim()
    const toName = String(ep.to || '').trim()
    if (!fromName || !toName) continue
    const fromN = ensureCharacter(fromName)
    const toN = ensureCharacter(toName)
    const type = normalizeEdgeType(ep.type)
    const id = edgeIdFor(fromN.name, toN.name, type)
    const existing = next.edges.find((e) => e.id === id)
    if (existing) {
      if (ep.note != null && String(ep.note).trim()) existing.note = String(ep.note).trim()
      if (typeof ep.intensity === 'number' && Number.isFinite(ep.intensity)) {
        existing.intensity = ep.intensity
      }
      existing.updatedAt = ts
    } else {
      next.edges.push({
        id,
        from: fromN.id,
        to: toN.id,
        type,
        note: String(ep.note || '').trim(),
        intensity:
          typeof ep.intensity === 'number' && Number.isFinite(ep.intensity)
            ? ep.intensity
            : undefined,
        updatedAt: ts,
      })
    }
  }

  return next
}

/** 弟子详情用切片 */
export function getMemoryGraphSlice(
  g: MemoryGraphState,
  name: string,
): MemoryGraphSlice {
  const node = findNodeByName(g, name) || null
  if (!node) {
    return { node: null, edges: [], empty: true }
  }
  const idByNode = new Map(g.nodes.map((n) => [n.id, n]))
  const edges = g.edges
    .filter((e) => e.from === node.id || e.to === node.id)
    .map((e) => {
      const out = e.from === node.id
      const otherId = out ? e.to : e.from
      const other = idByNode.get(otherId)
      return {
        ...e,
        otherName: other?.name || otherId,
        direction: (out ? 'out' : 'in') as 'out' | 'in',
      }
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)

  const hasAttrs = Object.keys(node.attrs || {}).length > 0
  const hasBeats = (node.beats || []).length > 0
  const empty = !hasAttrs && !hasBeats && edges.length === 0
  return { node, edges, empty }
}

/** 从 query + 名册名抽出命中的角色名 */
export function matchNamesInText(
  text: string,
  candidateNames: string[],
): string[] {
  const t = String(text || '')
  if (!t.trim()) return []
  const scored = candidateNames
    .map((name) => {
      const n = String(name || '').trim()
      if (n.length < 2) return { name: n, score: 0 }
      if (!t.includes(n)) return { name: n, score: 0 }
      return { name: n, score: n.length }
    })
    .filter((x) => x.score > 0)
  scored.sort((a, b) => b.score - a.score)
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of scored) {
    const k = normalizeName(s.name)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(s.name)
  }
  return out
}

export interface SelectGraphForTurnInput {
  graph: MemoryGraphState
  query: string
  /** 名册/已知角色名，用于点名匹配 */
  rosterNames?: string[]
  maxNodes?: number
  maxChars?: number
  /** 当前游戏年（解析「N年前」+ 旧事加权） */
  currentYear?: number
  /** 冷档案闪回条数 */
  flashbackTopK?: number
  /** 冷档案闪回字数预算 */
  flashbackMaxChars?: number
  /** 是否启用冷档案闪回（默认 true） */
  enableFlashback?: boolean
}

/**
 * 柏宝书式自动选取：
 * 1) 当前会话命中名册人名 → 直接选入
 * 2) 查询词与节点属性/近事关键词弱匹配 → 按相关度排序
 * 3) 一跳邻接扩展关联角色
 * 4) 有线索时从冷档案捞旧事闪回
 * 5) 完全无线索：取最近更新热节点
 */
export function selectMemoryGraphForTurn(input: SelectGraphForTurnInput): {
  names: string[]
  text: string
  nodeCount: number
  flashbackCount: number
} {
  const g = input.graph
  const maxNodes = Math.max(1, input.maxNodes ?? 4)
  const maxChars = Math.max(200, input.maxChars ?? 1600)
  const roster = [
    ...(input.rosterNames || []),
    ...g.nodes.map((n) => n.name),
  ]
  // 去重保序
  const rosterUniq: string[] = []
  const seenR = new Set<string>()
  for (const n of roster) {
    const k = normalizeName(n)
    if (!k || seenR.has(k)) continue
    seenR.add(k)
    rosterUniq.push(n)
  }

  let hit = matchNamesInText(input.query, rosterUniq)
  const namedHits = [...hit]

  const q = String(input.query || '').trim()

  // 属性/近事关键词弱匹配（query 片段出现在 attrs/beats）
  if (hit.length < maxNodes) {
    if (q.length >= 2) {
      const scored = g.nodes
        .map((n) => {
          let score = 0
          const hay = [
            n.name,
            ...Object.values(n.attrs || {}),
            ...(n.beats || []).map((b) => b.text),
          ].join('\n')
          const tokens = q
            .split(/[\s,，。；;、|]+/)
            .map((t) => t.trim())
            .filter((t) => t.length >= 2)
          for (const t of tokens.slice(0, 12)) {
            if (hay.includes(t)) score += t.length
          }
          return { name: n.name, score, kind: n.kind, updatedAt: n.updatedAt }
        })
        .filter((x) => x.score > 0)
      scored.sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt)
      for (const s of scored) {
        if (hit.length >= maxNodes) break
        if (!hit.includes(s.name)) hit.push(s.name)
      }
    }
  }

  const hadExplicitClue = hit.length > 0

  // 无点名：取最近更新的角色节点，再补其他类型（不触发冷库全扫）
  if (!hit.length) {
    const chars = [...g.nodes]
      .filter((n) => n.kind === 'character')
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, Math.min(2, maxNodes))
      .map((n) => n.name)
    hit = chars
    if (hit.length < maxNodes) {
      const rest = [...g.nodes]
        .filter((n) => n.kind !== 'character')
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, maxNodes - hit.length)
        .map((n) => n.name)
      hit = [...hit, ...rest]
    }
  }

  const selected = new Set<string>()
  const order: string[] = []
  const add = (name: string) => {
    const node = findNodeByName(g, name)
    if (!node) return
    const k = normalizeName(node.name)
    if (selected.has(k)) return
    if (selected.size >= maxNodes) return
    selected.add(k)
    order.push(node.name)
  }

  for (const n of hit) add(n)

  // 一跳
  for (const name of [...order]) {
    if (selected.size >= maxNodes) break
    const slice = getMemoryGraphSlice(g, name)
    for (const e of slice.edges) {
      if (selected.size >= maxNodes) break
      add(e.otherName)
    }
  }

  if (!order.length) {
    return { names: [], text: '', nodeCount: 0, flashbackCount: 0 }
  }

  const graphBudget = Math.max(
    200,
    Math.floor(maxChars * (input.enableFlashback === false ? 1 : 0.62)),
  )
  const blocks: string[] = [
    '## 叙事记忆图谱',
    '（仅作背景参考，勿复述；与经营名册关系网分离）',
  ]
  for (const name of order) {
    const slice = getMemoryGraphSlice(g, name)
    if (!slice.node) continue
    const lines = formatNodeBlock(slice)
    blocks.push(lines)
  }
  let graphText = blocks.join('\n')
  if (graphText.length > graphBudget) {
    graphText = graphText.slice(0, graphBudget - 1) + '…'
  }

  // 冷档案闪回：仅当有显式线索（点名/关键词命中）或 query 含可检索 token
  let flashbackCount = 0
  let flashText = ''
  if (input.enableFlashback !== false) {
    const clueNames =
      namedHits.length > 0
        ? namedHits
        : hadExplicitClue
          ? order
          : []
    // 先多取，再去掉热近事重复（否则 topK 全被热层占满，旧事永远闪不回）
    const wantFb = input.flashbackTopK ?? 6
    const hotTexts = new Set<string>()
    for (const name of order) {
      const n = findNodeByName(g, name)
      for (const b of n?.beats || []) hotTexts.add(b.text)
    }
    const fbHits = searchArchiveBeats({
      query: input.query,
      nodeNames: clueNames.length ? clueNames : hadExplicitClue ? order : undefined,
      currentYear: input.currentYear,
      topK: Math.max(wantFb * 4, 24),
      maxChars: input.flashbackMaxChars ?? Math.floor(maxChars * 0.38),
    })
    const unique = fbHits.filter((h) => !hotTexts.has(h.text)).slice(0, wantFb)
    flashbackCount = unique.length
    flashText = formatArchiveFlashback(
      unique,
      input.flashbackMaxChars ?? Math.max(200, maxChars - graphText.length),
    )
  }

  let text = flashText ? `${graphText}\n\n${flashText}` : graphText
  if (text.length > maxChars) {
    text = text.slice(0, maxChars - 1) + '…'
  }
  return { names: order, text, nodeCount: order.length, flashbackCount }
}

function formatNodeBlock(slice: MemoryGraphSlice): string {
  const n = slice.node!
  const kindLabel =
    n.kind === 'character'
      ? '角色'
      : n.kind === 'event'
        ? '事件'
        : n.kind === 'item'
          ? '物品'
          : n.kind === 'place'
            ? '地点'
            : '其他'
  const lines: string[] = [`### ${n.name}〔${kindLabel}〕`]
  const prefer = [
    '身份',
    '性格',
    '当前位置',
    '周围角色',
    '待办事项',
    '约定',
    '年龄',
    '性别',
    '概要',
    '编码',
    '地点',
    '物品描述',
    '持有者',
    '类型',
    '详细说明',
  ]
  const shown = new Set<string>()
  for (const k of prefer) {
    const v = n.attrs[k]
    if (v) {
      lines.push(`- ${k}：${v}`)
      shown.add(k)
    }
  }
  for (const [k, v] of Object.entries(n.attrs)) {
    if (shown.has(k) || !v) continue
    if (k === '人际关系' || k === '纪要') continue
    lines.push(`- ${k}：${v}`)
  }
  // 事件纪要正文单独截断
  if (n.attrs['纪要']) {
    lines.push(`- 纪要：${String(n.attrs['纪要']).slice(0, 120)}`)
  }
  for (const e of slice.edges.slice(0, 6)) {
    const arrow = e.direction === 'out' ? '→' : '←'
    const note = e.note ? `（${e.note}）` : ''
    lines.push(`- 关系 ${arrow} ${e.otherName}〔${e.type}〕${note}`)
  }
  for (const b of (n.beats || []).slice(0, 3)) {
    const cal =
      b.year != null ? `（${b.year}年${b.season || ''}）` : ''
    lines.push(`- 近事：${b.text}${cal}`)
  }
  return lines.join('\n')
}

// —— 持久化（localStorage 失败时仍保留内存态，测试环境可回环）——

let graphState: MemoryGraphState = createEmptyMemoryGraph()
/** 内存镜像：localStorage 不可用时仍可 load/save 回环 */
let graphMemoryMirror: string | null = null

export function loadMemoryGraph(): MemoryGraphState {
  try {
    let raw: string | null = null
    try {
      raw = localStorage.getItem(MEMORY_GRAPH_STORAGE_KEY)
    } catch {
      raw = null
    }
    if (!raw) raw = graphMemoryMirror
    if (!raw) {
      // 不强制清空内存态：若 save 已写入 graphState 但 storage 失败，保留
      if (graphState.nodes.length || graphState.edges.length) return graphState
      graphState = createEmptyMemoryGraph()
      return graphState
    }
    const o = JSON.parse(raw) as Partial<MemoryGraphState>
    graphState = normalizeGraphState(o)
    return graphState
  } catch {
    if (graphState.nodes.length || graphState.edges.length) return graphState
    graphState = createEmptyMemoryGraph()
    return graphState
  }
}

function normalizeGraphState(o: Partial<MemoryGraphState>): MemoryGraphState {
  const nodes = Array.isArray(o.nodes)
    ? o.nodes.map((n) => ({
        id: String(n?.id || nodeIdForName(String(n?.name || ''))),
        kind: (n?.kind || 'character') as MemoryGraphNodeKind,
        name: String(n?.name || '').trim() || '未名',
        attrs:
          n?.attrs && typeof n.attrs === 'object'
            ? Object.fromEntries(
                Object.entries(n.attrs).map(([k, v]) => [k, String(v ?? '')]),
              )
            : {},
        beats: Array.isArray(n?.beats)
          ? n.beats.map((b) => ({
              id: String(b?.id || newId('b')),
              text: String(b?.text || ''),
              at: typeof b?.at === 'number' ? b.at : undefined,
              year: typeof b?.year === 'number' ? b.year : undefined,
              season: b?.season != null ? String(b.season) : undefined,
            }))
          : [],
        updatedAt: Number(n?.updatedAt) || 0,
      }))
    : []
  const edges = Array.isArray(o.edges)
    ? o.edges.map((e) => ({
        id: String(e?.id || newId('e')),
        from: String(e?.from || ''),
        to: String(e?.to || ''),
        type: normalizeEdgeType(String(e?.type || '')),
        note: String(e?.note || ''),
        intensity:
          typeof e?.intensity === 'number' && Number.isFinite(e.intensity)
            ? e.intensity
            : undefined,
        updatedAt: Number(e?.updatedAt) || 0,
      }))
    : []
  return { version: 1, nodes, edges }
}

export function saveMemoryGraph(g: MemoryGraphState = graphState): void {
  graphState = g
  const payload = JSON.stringify(graphState)
  graphMemoryMirror = payload
  try {
    localStorage.setItem(MEMORY_GRAPH_STORAGE_KEY, payload)
  } catch {
    /* keep memory mirror */
  }
}

export function clearMemoryGraph(): void {
  graphState = createEmptyMemoryGraph()
  graphMemoryMirror = null
  clearMemoryArchive()
  try {
    localStorage.removeItem(MEMORY_GRAPH_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export interface IngestedBeat {
  id: string
  text: string
  nodeName: string
  year?: number
  season?: string
}

/**
 * 解析 <memory> 标签文本并写入图谱。
 * 格式：每行 "角色名|做了什么|关系变化"（后两段可省略）。
 * 也接受无竖线的「角色名：做了什么」弱格式。
 * 零额外 API 调用，纯本地解析。
 * 返回新写入的 beat 列表（供 embedding 存储）。
 */
export function ingestMemoryTag(raw: string, calendar?: { year: number; season: string }): IngestedBeat[] {
  const lines = (raw || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (!lines.length) return []

  const g = loadMemoryGraph()
  const patch: MemoryGraphPatch = { nodes: [], edges: [] }

  for (const line of lines) {
    let name = ''
    let actionPart = ''
    let relationPart = ''
    if (line.includes('|')) {
      const parts = line.split('|').map((s) => s.trim())
      name = (parts[0] || '').replace(/^\[|\]$/g, '')
      actionPart = parts[1] || ''
      relationPart = parts[2] || ''
    } else {
      const m = line.match(/^(.{2,12})[：:]\s*(.+)$/)
      if (!m) continue
      name = m[1].trim()
      actionPart = m[2].trim()
    }
    if (!name) continue

    const beat = actionPart || line
    patch.nodes!.push({
      name,
      kind: 'character',
      beat,
      beatYear: calendar?.year,
      beatSeason: calendar?.season,
    })

    // 关系变化 → edge（格式："与XX结盟" / "对XX仇恨" 等）
    if (relationPart) {
      const m = relationPart.match(/(?:与|对|向|跟)\s*(.+?)[\s：:]*(.+)$/)
      if (m) {
        patch.edges!.push({
          from: name,
          to: m[1].trim(),
          type: normalizeEdgeType(m[2].trim()),
          note: beat,
        })
      } else if (relationPart.includes('：') || relationPart.includes(':')) {
        const [to, typ] = relationPart.split(/[：:]/).map((s) => s.trim())
        if (to) {
          patch.edges!.push({
            from: name,
            to,
            type: normalizeEdgeType(typ),
            note: beat,
          })
        }
      }
    }
  }

  if (!patch.nodes!.length) return []
  const next = applyMemoryGraphPatch(g, patch)
  saveMemoryGraph(next)

  // 收集本次新写入的 beats（从 patch 节点名反查图谱中最新 beat）
  const result: IngestedBeat[] = []
  for (const np of patch.nodes!) {
    if (!np.beat) continue
    const node = findNodeByName(next, np.name)
    const b = node?.beats?.find((x) => x.text === np.beat)
    if (b) {
      result.push({ id: b.id, text: b.text, nodeName: np.name, year: b.year, season: b.season })
    }
  }
  return result
}

/**
 * P0：名册种子 — 弟子/掌门至少有角色空节点，避免侧栏永久空白。
 * 不写假近事；只保证「有人可点」。
 */
export function seedRosterNodes(
  names: Array<string | { name: string; attrs?: Record<string, string> }>,
): number {
  const g = loadMemoryGraph()
  const patch: MemoryGraphPatch = { nodes: [] }
  let added = 0
  for (const raw of names) {
    const name = typeof raw === 'string' ? raw.trim() : String(raw?.name || '').trim()
    if (!name || name.length < 2) continue
    if (findNodeByName(g, name) || patch.nodes!.some((n) => normalizeName(n.name) === normalizeName(name))) {
      continue
    }
    const attrs = typeof raw === 'string' ? undefined : raw.attrs
    patch.nodes!.push({ name, kind: 'character', attrs })
    added++
  }
  if (!added) return 0
  // 已有节点也要补 attrs（身份等），用 apply 合并
  const withMerge: MemoryGraphPatch = { nodes: [] }
  for (const raw of names) {
    const name = typeof raw === 'string' ? raw.trim() : String(raw?.name || '').trim()
    if (!name || name.length < 2) continue
    const attrs = typeof raw === 'string' ? undefined : raw.attrs
    withMerge.nodes!.push({ name, kind: 'character', attrs })
  }
  const next = applyMemoryGraphPatch(g, withMerge)
  saveMemoryGraph(next)
  return added
}

const FALLBACK_STOP = new Set([
  '掌门',
  '弟子',
  '宗门',
  '今日',
  '本座',
  '于是',
  '突然',
  '但是',
  '如果',
  '已经',
  '可以',
  '什么',
  '一个',
  '我们',
  '他们',
  '你们',
  '自己',
  '这里',
  '那里',
  '时候',
  '事情',
  '之后',
  '之前',
  '因为',
  '所以',
  '然后',
  '只是',
  '还是',
  '或者',
  '以及',
  '进行',
  '开始',
  '继续',
  '回来',
  '出去',
  '进来',
  '说道',
  '问道',
  '答道',
])

/**
 * P0：正文兜底生长 — 名册人名出现在正文/用户话时，记一条弱近事。
 * 强度低于显式 <memory>；同文去重；每回最多 maxBeats 条。
 */
export function ingestNarrativeFallback(
  text: string,
  rosterNames: string[],
  calendar?: { year: number; season: string },
  opts?: { maxBeats?: number; source?: string },
): IngestedBeat[] {
  const body = String(text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  if (body.length < 8) return []
  const roster = [...new Set((rosterNames || []).map((n) => String(n || '').trim()).filter((n) => n.length >= 2))]
  if (!roster.length) return []

  // 先确保空节点存在
  seedRosterNodes(roster)

  const hits = matchNamesInText(body, roster)
  if (!hits.length) return []

  const maxBeats = Math.max(1, opts?.maxBeats ?? 3)
  const g = loadMemoryGraph()
  const patch: MemoryGraphPatch = { nodes: [] }
  const snippet = body.slice(0, 48).replace(/\s+/g, '')
  const label = opts?.source === 'user' ? '提及' : '出场'
  let count = 0
  for (const name of hits) {
    if (count >= maxBeats) break
    if (FALLBACK_STOP.has(name)) continue
    const node = findNodeByName(g, name)
    const beat = `〔${label}〕${snippet}${body.length > 48 ? '…' : ''}`
    if (node?.beats?.some((b) => b.text === beat || (b.text.startsWith(`〔${label}〕`) && body.includes(name) && b.text.includes(snippet.slice(0, 16))))) {
      continue
    }
    patch.nodes!.push({
      name,
      kind: 'character',
      beat,
      beatYear: calendar?.year,
      beatSeason: calendar?.season,
    })
    count++
  }
  if (!patch.nodes!.length) return []
  const next = applyMemoryGraphPatch(g, patch)
  saveMemoryGraph(next)
  const result: IngestedBeat[] = []
  for (const np of patch.nodes!) {
    if (!np.beat) continue
    const node = findNodeByName(next, np.name)
    const b = node?.beats?.find((x) => x.text === np.beat)
    if (b) result.push({ id: b.id, text: b.text, nodeName: np.name, year: b.year, season: b.season })
  }
  return result
}

/**
 * 柏宝书化：从 AI 回复正文自动提取结构化实体与事件。
 * 纯规则引擎 — 零 LLM 调用，类似 BaiBai-Book 的旁侧记账。
 * 提取：物品变更 / 地点移动 / 状态变化 / 关系变更。
 */
export function ingestReplyDigest(
  text: string,
  rosterNames: string[],
  calendar?: { year: number; season: string },
): { beatCount: number; itemNodes: number; placeNodes: number; relationEdges: number } {
  const body = String(text || '')
    .replace(/<[^>]+>/g, '')
    .trim()
  if (body.length < 16) return { beatCount: 0, itemNodes: 0, placeNodes: 0, relationEdges: 0 }

  const g = loadMemoryGraph()
  // 归一化名册用于反向匹配：从物品/地点事件定位到角色
  const rosterNorm = new Set(rosterNames.map((n) => normalizeName(n)))
  const patch: MemoryGraphPatch = { nodes: [], edges: [] }
  const cal = calendar || {}
  const stats = { beatCount: 0, itemNodes: 0, placeNodes: 0, relationEdges: 0 }

  // 预处理：去空格换行，方便正则锚定
  const flat = body.replace(/\s+/g, '')

  // ── 物品 ──
  type ItemRule = { pattern: RegExp; tag: string; source?: (m: RegExpExecArray) => string | undefined }
  const itemRules: ItemRule[] = [
    { pattern: /([^，。；!\n]{2,8})(?:获得|得到|取得|拿到|拾取|收下|购入|炼成)([^，。；!\n]{1,12})/g, tag: '获得' },
    { pattern: /([^，。；!\n]{2,8})(?:失去|丢弃|遗失|交出|摧毁)([^，。；!\n]{1,12})/g, tag: '失去' },
    { pattern: /([^，。；!\n]{2,8})(?:使用|服用|吞下|运功催动)([^，。；!\n]{1,12})/g, tag: '使用' },
    // 传递：把 AA 交给 BB → BB 获得 AA，AA 转到 BB
    { pattern: /(?:把|将)([^，。；!\n]{1,12})(?:交给|送给|赠与|递给)([^，。；!\n]{2,8})/g, tag: '获得', source: (m) => m[2] },
  ]
  for (const rule of itemRules) {
    let m: RegExpExecArray | null
    while ((m = rule.pattern.exec(flat)) !== null) {
      const source = rule.source ? rule.source(m) : m[1]
      const item = rule.source ? m[1] : m[2]
      const name = source?.trim() || ''
      const itemName = item?.trim() || ''
      if (name.length < 2 || itemName.length < 2) continue
      if (FALLBACK_STOP.has(name) || FALLBACK_STOP.has(itemName)) continue
      if (!rosterNorm.has(normalizeName(name))) continue
      patch.nodes!.push({
        name: itemName,
        kind: 'item',
        attrs: { 关联角色: name, 状态: rule.tag },
      })
      patch.nodes!.push({
        name,
        kind: 'character',
        beat: `${rule.tag}${itemName}`,
        beatYear: cal.year,
        beatSeason: cal.season,
      })
      stats.itemNodes++
      stats.beatCount++
    }
  }

  // ── 地点 ──
  const placeRe = /([^，。；!\n]{2,8})(?:来到|到达|踏入|进入|抵达|前往|赶赴|离开|走出|退出)([^，。；!\n]{2,10})/g
  let pm: RegExpExecArray | null
  while ((pm = placeRe.exec(flat)) !== null) {
    const name = pm[1].trim()
    const place = pm[2].trim()
    if (name.length < 2 || place.length < 2) continue
    if (FALLBACK_STOP.has(name) || FALLBACK_STOP.has(place)) continue
    if (!rosterNorm.has(normalizeName(name))) continue
    const isArrive = flat.slice(pm.index, pm.index + 40).includes('来到') || flat.slice(pm.index, pm.index + 40).includes('进入') || flat.slice(pm.index, pm.index + 40).includes('抵达') || flat.slice(pm.index, pm.index + 40).includes('前往')
    patch.nodes!.push({
      name: place,
      kind: 'place',
      attrs: { 最近出入: name },
    })
    patch.nodes!.push({
      name,
      kind: 'character',
      beat: isArrive ? `抵达${place}` : `离开${place}`,
      beatYear: cal.year,
      beatSeason: cal.season,
    })
    stats.placeNodes++
    stats.beatCount++
  }

  // ── 状态变化 ──
  for (const name of rosterNames) {
    const idx = flat.indexOf(name)
    if (idx < 0) continue
    const ctx = flat.slice(Math.max(0, idx - 3), idx + name.length + 24)
    const statusHits: string[] = []
    if (/突破/.test(ctx)) statusHits.push('突破')
    if (/受伤|负伤|重创|被重创/.test(ctx)) statusHits.push('受伤')
    if (/中毒|中蛊|中毒了/.test(ctx)) statusHits.push('中毒')
    if (/痊愈|恢复|好转|苏醒/.test(ctx)) statusHits.push('痊愈')
    if (/突破.*境界|晋升|进境|修为大?[进增涨]/.test(ctx)) statusHits.push('修为精进')
    for (const s of statusHits) {
      patch.nodes!.push({
        name,
        kind: 'character',
        beat: s,
        beatYear: cal.year,
        beatSeason: cal.season,
      })
      stats.beatCount++
      // 更新 attrs
      if (s === '突破' || s === '修为精进') {
        patch.nodes!.push({ name, kind: 'character', attrs: { 最近状态: s } })
      }
    }
  }

  // ── 关系变更 ──
  const relPatterns: Array<{ re: RegExp; type: MemoryGraphEdgeType }> = [
    { re: /([^，。；!\n]{2,8})(?:与|和|跟)([^，。；!\n]{2,8})(?:结为|结成|成为)(?:道侣|伴侣|夫妻)/g, type: '道侣' },
    { re: /([^，。；!\n]{2,8})(?:与|和|跟)([^，。；!\n]{2,8})(?:结为|结成)(?:兄弟|姐妹|同盟|搭档)/g, type: '结义' },
    { re: /([^，。；!\n]{2,8})(?:拜|认)([^，。；!\n]{2,8})为师/g, type: '师徒' },
    { re: /([^，。；!\n]{2,8})收([^，。；!\n]{2,8})为徒/g, type: '师徒' },
    { re: /([^，。；!\n]{2,8})(?:与|和|跟)([^，。；!\n]{2,8})(?:决裂|反目|翻脸|为敌|结仇|结怨)/g, type: '仇恨' },
  ]
  for (const { re, type } of relPatterns) {
    let rm: RegExpExecArray | null
    while ((rm = re.exec(flat)) !== null) {
      const a = rm[1].trim()
      const b = rm[2].trim()
      if (a.length < 2 || b.length < 2) continue
      if (FALLBACK_STOP.has(a) || FALLBACK_STOP.has(b)) continue
      const aOk = rosterNorm.has(normalizeName(a))
      const bOk = rosterNorm.has(normalizeName(b))
      if (!aOk && !bOk) continue
      // 至少一方是名册角色
      patch.edges!.push({ from: a, to: b, type })
      // 给双方各记一条近事
      patch.nodes!.push({
        name: a,
        kind: 'character',
        beat: `${type}${b}`,
        beatYear: cal.year,
        beatSeason: cal.season,
      })
      patch.nodes!.push({
        name: b,
        kind: 'character',
        beat: `${type}${a}`,
        beatYear: cal.year,
        beatSeason: cal.season,
      })
      stats.relationEdges++
      stats.beatCount += 2
    }
  }

  if ((patch.nodes?.length || 0) > 0 || (patch.edges?.length || 0) > 0) {
    const next = applyMemoryGraphPatch(g, patch)
    saveMemoryGraph(next)
  }
  return stats
}

/**
 * 柏宝书化：热近事多层压缩。
 * 角色 beats 超过阈值时，将最旧的 beats 合并为摘要写入冷档案并从热层移除。
 * 类似 BaiBai-Book 的摘要→总结递进压缩。
 */
export function compactHotBeats(
  opts?: { hotKeep?: number; mergeThreshold?: number },
): { merged: number; characters: number } {
  const hotKeep = Math.max(4, opts?.hotKeep ?? 8)
  const mergeThreshold = Math.max(hotKeep + 4, opts?.mergeThreshold ?? 16)
  const g = loadMemoryGraph()
  let merged = 0
  let chars = 0
  const next = {
    version: 1 as const,
    nodes: g.nodes.map((n) => ({ ...n, attrs: { ...n.attrs }, beats: [...(n.beats || [])] })),
    edges: g.edges.map((e) => ({ ...e })),
  }
  for (const node of next.nodes) {
    if (node.kind !== 'character') continue
    if (node.beats.length <= mergeThreshold) continue
    chars++
    // 按时间正序（旧在前），取超出 hotKeep 的最老 beats
    const ordered = [...node.beats].reverse() // 旧→新
    const overflow = ordered.slice(0, ordered.length - hotKeep)
    if (!overflow.length) continue
    // 生成摘要：拼接旧 beats 的前 N 字
    const summary = overflow
      .map((b) => b.text)
      .join('；')
      .slice(0, 300)
    // 写入冷档案
    appendArchiveBeats(
      overflow.map((b) => ({
        id: b.id,
        nodeId: node.id,
        nodeName: node.name,
        text: b.text,
        at: b.at || Date.now(),
        year: b.year,
        season: b.season,
      })),
    )
    // 追加一条摘要 beat 到冷档案
    const summaryId = newId('s')
    appendArchiveBeats([
      {
        id: summaryId,
        nodeId: node.id,
        nodeName: node.name,
        text: `【摘要】${summary}`,
        at: Date.now(),
      },
    ])
    // 热层保留最近 hotKeep 条 + 一条"前情摘要"占位 beat
    const kept = ordered.slice(ordered.length - hotKeep).reverse()
    node.beats = [
      { id: summaryId, text: `〔前情〕${summary}`, at: Date.now() },
      ...kept,
    ]
    merged += overflow.length
    node.updatedAt = Date.now()
  }
  if (chars > 0) {
    saveMemoryGraph(next)
  }
  return { merged, characters: chars }
}

/** P1：追加/改写近事 */
export function appendNodeBeat(
  name: string,
  text: string,
  calendar?: { year: number; season: string },
): boolean {
  const t = String(text || '').trim()
  const n = String(name || '').trim()
  if (!n || !t) return false
  const g = loadMemoryGraph()
  const next = applyMemoryGraphPatch(g, {
    nodes: [
      {
        name: n,
        kind: 'character',
        beat: t,
        beatYear: calendar?.year,
        beatSeason: calendar?.season,
      },
    ],
  })
  saveMemoryGraph(next)
  return true
}

/** P1：删除某条热近事（冷档案保留历史 id 不强制删） */
export function removeNodeBeat(name: string, beatId: string): boolean {
  const g = loadMemoryGraph()
  const node = findNodeByName(g, name)
  if (!node || !beatId) return false
  const before = node.beats.length
  node.beats = (node.beats || []).filter((b) => b.id !== beatId)
  if (node.beats.length === before) return false
  node.updatedAt = now()
  saveMemoryGraph(g)
  return true
}

/** P1：设置/合并档案字段 */
export function setNodeAttr(name: string, key: string, value: string): boolean {
  const k = cleanColumnName(key)
  const n = String(name || '').trim()
  if (!n || !k) return false
  const g = loadMemoryGraph()
  const next = applyMemoryGraphPatch(g, {
    nodes: [{ name: n, kind: 'character', attrs: { [k]: String(value ?? '').trim() } }],
  })
  saveMemoryGraph(next)
  return true
}

/**
 * 改名：把旧名节点合并到新名（近事 / 属性 / 关系全部保留）。
 * 边按 node.id 关联，改名不断边；冷档案历史条目保留旧名（属当时记录，不回改）。
 * 返回是否有节点被改。
 */
export function renameMemoryGraphNode(oldName: string, newName: string): boolean {
  const from = String(oldName || '').trim()
  const to = String(newName || '').trim()
  if (!from || !to || normalizeName(from) === normalizeName(to)) return false
  const g = loadMemoryGraph()
  if (!findNodeByName(g, from)) return false
  const next = applyMemoryGraphPatch(g, {
    nodes: [{ name: to, formerName: from, kind: 'character' }],
  })
  saveMemoryGraph(next)
  return true
}

/** 按姓名移除节点及其关联边（除名时） */
export function removeMemoryGraphNodeByName(name: string): MemoryGraphState {
  const g = loadMemoryGraph()
  const node = findNodeByName(g, name)
  if (!node) return g
  removeArchiveBeatsByNodeId(node.id)
  const next: MemoryGraphState = {
    version: 1,
    nodes: g.nodes.filter((n) => n.id !== node.id),
    edges: g.edges.filter((e) => e.from !== node.id && e.to !== node.id),
  }
  saveMemoryGraph(next)
  return next
}

/**
 * 确保图谱已加载（内存态/持久化）。
 * 生长：<memory> + 正文兜底 + 名册种子；不再从经营表投影全文。
 */
export function ensureMemoryGraphHydrated(roster?: string[]): MemoryGraphState {
  const g = loadMemoryGraph()
  if (roster?.length) {
    seedRosterNodes(roster)
    return loadMemoryGraph()
  }
  return g
}

/** 弟子详情 / 注入天机用短摘要 */
export function formatMemoryGraphSliceBrief(slice: MemoryGraphSlice): string {
  if (slice.empty || !slice.node) return ''
  const parts: string[] = []
  const n = slice.node
  const idn = n.attrs['身份']
  const pos = n.attrs['当前位置']
  const trait = n.attrs['性格']
  if (idn) parts.push(idn)
  if (trait) parts.push(trait)
  if (pos) parts.push(`在${pos}`)
  if (slice.edges[0]) {
    parts.push(
      `${slice.edges[0].direction === 'out' ? '→' : '←'}${slice.edges[0].otherName}〔${slice.edges[0].type}〕`,
    )
  }
  if (n.beats?.[0]) parts.push(n.beats[0].text)
  return parts.join(' · ')
}
