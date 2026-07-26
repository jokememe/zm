/**
 * 叙事记忆图谱（方案 C + 无限记忆底座）：
 * - 热层：节点 + 边 + 每节点近况 beats（窗口）
 * - 冷层：memory-archive 全量 beats（IndexedDB + 镜像），有线索可闪回
 * 与经营 relationEdges 分离。
 */
import { MEMORY_GRAPH_STORAGE_KEY } from '@/data/opening'
import {
  bindAfterTableMemoryWrite,
  cleanColumnName,
  loadTableMemory,
  normalizeName,
  type MemoryRecord,
  type TableMemoryState,
} from '@/composables/table-memory'
import {
  appendArchiveBeats,
  clearMemoryArchive,
  formatArchiveFlashback,
  removeArchiveBeatsByNodeId,
  searchArchiveBeats,
  type ArchiveBeat,
} from '@/composables/memory-archive'

// 表格 Memory 写入后自动投影图谱
bindAfterTableMemoryWrite((s) => {
  syncMemoryGraphFromTableMemory(s)
})

/** 热窗口：节点上保留的近事条数（更早的在冷档案） */
const HOT_BEAT_MAX = 16

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

const PROFILE_ATTR_KEYS = [
  '年龄',
  '性别',
  '身份',
  '性格',
  '当前位置',
  '周围角色',
  '生理',
  '人际关系',
  '着装',
  '待办事项',
  '约定',
] as const

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

/**
 * 解析角色档案「人际关系」字段：
 * {目标}：〔关系〕 · 〔情感〕 或 目标：关系 · 情感；分号分隔多段
 */
export function parseRelationField(text: string): Array<{
  target: string
  type: MemoryGraphEdgeType
  note: string
}> {
  const raw = String(text || '').trim()
  if (!raw) return []
  const parts = raw.split(/[；;]/).map((p) => p.trim()).filter(Boolean)
  const out: Array<{ target: string; type: MemoryGraphEdgeType; note: string }> = []
  for (const part of parts) {
    const m = part.match(/^\{?([^}：:]+)\}?\s*[:：]\s*([\s\S]*)$/)
    if (!m) continue
    const target = m[1].trim().replace(/^[〔【\[]|[〕】\]]$/g, '')
    const rest = m[2].trim()
    if (!target) continue
    const segs = rest
      .split(/[·•|｜]/)
      .map((s) => s.replace(/^[〔【\[]|[〕】\]]$/g, '').trim())
      .filter(Boolean)
    const typeHint = segs[0] || '人际'
    const note = segs.slice(1).join(' · ') || segs[0] || ''
    out.push({
      target,
      type: normalizeEdgeType(typeHint),
      note,
    })
  }
  return out
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

/**
 * 从表格记忆投影完整图谱（C）：
 * - 角色档案 → character 节点 + 人际边
 * - 物品追踪 → item 节点 + 持有边
 * - 世界设定 → place/other 节点
 * - 纪要表 → event 节点 + 点名角色边
 * 合并进 base（不抹已有 beats）。
 */
export function projectCharacterProfilesToGraph(
  tableState: TableMemoryState,
  base: MemoryGraphState = createEmptyMemoryGraph(),
): MemoryGraphState {
  const patch: MemoryGraphPatch = { nodes: [], edges: [] }

  // —— 角色 ——
  for (const rec of tableState.records?.['character_profile'] || []) {
    const name = primaryNameFromRecord(rec)
    if (!name) continue
    const attrs: Record<string, string> = {}
    for (const key of PROFILE_ATTR_KEYS) {
      if (key === '人际关系') continue
      const v = String(rec.values?.[key] ?? '').trim()
      if (v) attrs[key] = v
    }
    const former = String(rec.values?.['原名'] ?? '').trim()
    patch.nodes!.push({
      name,
      kind: 'character',
      attrs,
      formerName: former || undefined,
    })
    const rel = String(rec.values?.['人际关系'] ?? '').trim()
    for (const r of parseRelationField(rel)) {
      patch.edges!.push({
        from: name,
        to: r.target,
        type: r.type,
        note: r.note,
      })
    }
    const pact = String(rec.values?.['约定'] ?? '').trim()
    if (pact) {
      patch.nodes!.push({ name, beat: `约定：${pact}` })
    }
  }

  // —— 物品 ——
  for (const rec of tableState.records?.['item_tracking'] || []) {
    const name =
      String(rec.values?.['物品名称'] || rec.values?.['名称'] || '').trim() ||
      primaryNameFromRecord(rec)
    if (!name) continue
    const attrs: Record<string, string> = {}
    for (const key of ['物品描述', '物品位置', '持有者', '状态', '备注'] as const) {
      const v = String(rec.values?.[key] ?? '').trim()
      if (v) attrs[key] = v
    }
    patch.nodes!.push({ name, kind: 'item', attrs })
    const owner = String(rec.values?.['持有者'] ?? '').trim()
    if (owner && owner !== '无' && owner !== '库藏') {
      patch.edges!.push({
        from: owner,
        to: name,
        type: '其他',
        note: '持有',
      })
    }
  }

  // —— 世界设定（地点/组织等）——
  for (const rec of tableState.records?.['world_setting'] || []) {
    const name =
      String(rec.values?.['设定名'] || rec.values?.['名称'] || '').trim() ||
      primaryNameFromRecord(rec)
    if (!name) continue
    const type = String(rec.values?.['类型'] ?? '').trim()
    const kind: MemoryGraphNodeKind = /地点|城|山|谷|府|殿|洞|海|州|界/.test(type)
      ? 'place'
      : 'other'
    const attrs: Record<string, string> = {}
    for (const key of ['类型', '详细说明', '影响范围'] as const) {
      const v = String(rec.values?.[key] ?? '').trim()
      if (v) attrs[key] = v
    }
    patch.nodes!.push({ name, kind, attrs })
  }

  // —— 纪要 → 事件节点（最近若干，避免爆炸）——
  const journals = tableState.records?.['plot_journal'] || []
  const recentJ = journals.length > 40 ? journals.slice(journals.length - 40) : journals
  const knownNames = new Set<string>()
  for (const n of base.nodes) {
    if (n.name) knownNames.add(n.name)
  }
  for (const np of patch.nodes || []) {
    if (np.name) knownNames.add(np.name)
  }
  for (const rec of recentJ) {
    const code = String(rec.values?.['编码索引'] || '').trim()
    const summary = String(rec.values?.['概要'] || '').trim()
    const body = String(rec.values?.['纪要'] || '').trim()
    const place = String(rec.values?.['地点'] || '').trim()
    const label = summary || code || body.slice(0, 16)
    if (!label) continue
    const eventName = code ? `事件·${code}·${label.slice(0, 20)}` : `事件·${label.slice(0, 24)}`
    const attrs: Record<string, string> = {}
    if (code) attrs['编码'] = code
    if (summary) attrs['概要'] = summary
    if (place) attrs['地点'] = place
    if (body) attrs['纪要'] = body.slice(0, 200)
    patch.nodes!.push({
      name: eventName,
      kind: 'event',
      attrs,
      beat: summary || undefined,
    })
    if (place) {
      patch.nodes!.push({ name: place, kind: 'place' })
      patch.edges!.push({ from: eventName, to: place, type: '其他', note: '发生地' })
    }
    // 与已知角色名连边
    const hay = `${summary} ${body}`
    for (const cn of knownNames) {
      if (cn.length < 2) continue
      if (hay.includes(cn) && !eventName.includes(cn)) {
        patch.edges!.push({
          from: eventName,
          to: cn,
          type: '其他',
          note: '涉及',
        })
      }
    }
  }

  return applyMemoryGraphPatch(base, patch)
}

function primaryNameFromRecord(rec: MemoryRecord): string {
  const v = rec.values || {}
  return (
    String(v['角色名'] || v['名称'] || v['姓名'] || '').trim() ||
    Object.values(v)[0]?.trim() ||
    ''
  )
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
 * 规则选取（无限记忆 · 有线索可想起）：
 * 1) 点名节点 + 热层关键词 + 一跳邻接
 * 2) 有线索时从冷档案捞旧事闪回（热窗口挤掉的细节仍可回）
 * 3) 完全无线索：仅最近更新热节点，不扫十年冷库
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

  // 属性/近事关键词弱匹配（query 片段出现在 attrs/beats）
  if (hit.length < maxNodes) {
    const q = String(input.query || '').trim()
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
    // 有点名或关键词命中节点时，用这些名字 + query 搜冷库
    // 纯兜底「最近更新」不带 clueNames，search 仍可能因 token 命中返回
    const fbHits = searchArchiveBeats({
      query: input.query,
      nodeNames: clueNames.length ? clueNames : hadExplicitClue ? order : undefined,
      currentYear: input.currentYear,
      topK: input.flashbackTopK ?? 6,
      maxChars: input.flashbackMaxChars ?? Math.floor(maxChars * 0.38),
    })
    // 去掉已在热近事里完整出现的重复句
    const hotTexts = new Set<string>()
    for (const name of order) {
      const n = findNodeByName(g, name)
      for (const b of n?.beats || []) hotTexts.add(b.text)
    }
    const unique = fbHits.filter((h) => !hotTexts.has(h.text))
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
 * 零额外 API 调用，纯本地解析。
 * 返回新写入的 beat 列表（供 embedding 存储）。
 */
export function ingestMemoryTag(raw: string, calendar?: { year: number; season: string }): IngestedBeat[] {
  const lines = (raw || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && l.includes('|'))
  if (!lines.length) return []

  const g = loadMemoryGraph()
  const patch: MemoryGraphPatch = { nodes: [], edges: [] }

  for (const line of lines) {
    const [namePart, actionPart, relationPart] = line.split('|').map((s) => s.trim())
    const name = (namePart || '').replace(/^\[|\]$/g, '')
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
 * 从当前表格记忆刷新图谱并落盘。
 * 保留已有 beats（投影只合并 attrs/边；apply 不删 beats）。
 */
export function syncMemoryGraphFromTableMemory(
  tableState?: TableMemoryState,
): MemoryGraphState {
  const tables = tableState || loadTableMemory()
  const hasAny =
    (tables.records?.['character_profile'] || []).length > 0 ||
    (tables.records?.['item_tracking'] || []).length > 0 ||
    (tables.records?.['world_setting'] || []).length > 0 ||
    (tables.records?.['plot_journal'] || []).length > 0
  // 表格已空：硬清图谱，避免 clearTableMemory 后残留旧节点
  if (!hasAny) {
    clearMemoryGraph()
    return loadMemoryGraph()
  }
  const base = loadMemoryGraph()
  const next = projectCharacterProfilesToGraph(tables, base)
  saveMemoryGraph(next)
  return next
}

/** 确保图谱已从表格投影过（空图且有档案/物品/设定时） */
export function ensureMemoryGraphHydrated(): MemoryGraphState {
  const g = loadMemoryGraph()
  if (g.nodes.length > 0) return g
  const tables = loadTableMemory()
  const hasRows =
    (tables.records?.['character_profile'] || []).length > 0 ||
    (tables.records?.['item_tracking'] || []).length > 0 ||
    (tables.records?.['world_setting'] || []).length > 0 ||
    (tables.records?.['plot_journal'] || []).length > 0
  if (!hasRows) return g
  return syncMemoryGraphFromTableMemory(tables)
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
