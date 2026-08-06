/**
 * L3 可选：LLM 召回（第三档 · 语义/推断召回）
 * ---------------------------------------------------------------------------
 * 与 keyword（规则）和 embedding（向量）并列的第三种召回：
 * - 触发闸门：仅当规则召回未命中、或查询明显在问旧事/模糊指代时才调用
 * - 输入：压缩「目录」（人物图谱 + L2 摘要 + 冷档案索引），不读全文，控 token
 * - 输出：LLM 只允许返回 JSON 引用（node / beat id），代码回源校验后注入
 * - 失败 / 超时 → 静默返回 []，调用方回退规则结果，绝不阻断推演
 */
import { extractChatCompletionText, postChatCompletion } from '@/sillytavern/api-tools'
import { normalizeBaseUrl } from '@/composables/api-cache'
import type { ApiSettings } from '@/sillytavern/types'
import type { ArchiveBeat } from '@/composables/memory-archive'
import type { MemoryGraphState } from '@/composables/memory-graph'
import type { MemoryBank } from '@/composables/memory-lore'

export interface LlmRecallPick {
  /** 图谱节点名（回源校验用） */
  node?: string
  /** 冷档案 beat id（回源校验用） */
  beat?: string
  /** 召回原因（仅供展示） */
  reason?: string
}

export interface LlmRecallResult {
  ok: boolean
  picks: LlmRecallPick[]
  /** 回源校验通过的人物名 */
  nodes: string[]
  /** 回源校验通过的旧事条目 */
  beats: ArchiveBeat[]
  /** 失败原因（ok=false 时有值） */
  reason?: string
  /** LLM 原始输出（诊断用） */
  content?: string
}

/** 像在问旧事/模糊指代的话头：命中即更愿意多花一次调用 */
const FUZZY_HINTS = [
  '年前',
  '当年',
  '那年',
  '之前',
  '旧事',
  '那次',
  '后来',
  '曾经',
  '恩怨',
  '旧怨',
  '约定',
  '结盟',
  '结仇',
  '往事',
  '从前',
  '昔日',
  '当初',
  '还记得',
]

/**
 * 触发闸门：默认不调用，省成本。
 * - 规则召回 0 命中 → 值得让 LLM 语义补选
 * - 命中 < 3 且查询带旧事/模糊话头 → 值得补选
 */
export function shouldTriggerLlmRecall(
  query: string,
  keyword: { nodeCount: number; flashbackCount: number },
): boolean {
  const q = String(query || '').trim()
  if (!q) return false
  if (keyword.nodeCount === 0) return true
  const hasFuzzy = FUZZY_HINTS.some((h) => q.includes(h))
  return keyword.nodeCount < 3 && hasFuzzy
}

/** 压缩记忆目录：人物图谱 + L2 摘要 + 冷档案索引，供 LLM 选择 */
export function buildRecallCatalog(opts: {
  graph: MemoryGraphState
  bank?: MemoryBank
  archive?: ArchiveBeat[]
  maxChars?: number
}): string {
  const maxChars = Math.max(400, opts.maxChars ?? 1800)
  const lines: string[] = []
  const nodes = [...opts.graph.nodes].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  if (nodes.length) {
    lines.push('## 人物图谱目录')
    for (const n of nodes.slice(0, 40)) {
      const attrs = [n.attrs?.['身份'], n.attrs?.['性格']].filter(Boolean).join(' · ')
      const beats = (n.beats || [])
        .slice(0, 3)
        .map((b) => b.text)
        .join('；')
      lines.push(`- ${n.name}${attrs ? `〔${attrs}〕` : ''}${beats ? ` 近事：${beats}` : ''}`)
    }
  }
  const bank = opts.bank
  if (bank) {
    if (bank.long?.length) {
      lines.push('## 长线大事')
      for (const t of bank.long.slice(-8)) lines.push(`- ${t}`)
    }
    if (bank.mid) {
      lines.push('## 中期脉络')
      lines.push(`- ${bank.mid.slice(0, 400)}`)
    }
  }
  const archive = opts.archive || []
  if (archive.length) {
    lines.push('## 旧事档案索引')
    const recent = [...archive].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 60)
    for (const b of recent) {
      lines.push(
        `- [${b.id}] ${b.nodeName}：${b.text.slice(0, 40)}${b.year ? `（${b.year}年${b.season || ''}）` : ''}`,
      )
    }
  }
  let text = lines.join('\n')
  if (text.length > maxChars) text = text.slice(0, maxChars - 1) + '…'
  return text
}

const SYSTEM_PROMPT = `你是宗门叙事的记忆检索员。根据「查询」与「记忆目录」，选出最相关的人物或旧事条目。
只允许返回 JSON 数组，不要解释、不要代码块、不要其它文字：
[{"node":"人物名","reason":"为什么相关"}]
命中旧事条目时用：
[{"beat":"条目ID","reason":"为什么相关"}]
要求：
- node 必须来自「人物图谱目录」中的人物名
- beat 必须来自「旧事档案索引」中的 [ID]
- 最多 4 条；没有相关条目就返回 []`

/** 解析 LLM 输出：优先 JSON 数组；失败再按行式「名称|原因」兜底 */
export function parseLlmRecallOutput(content: string): LlmRecallPick[] {
  const raw = String(content || '').trim()
  if (!raw) return []
  const text = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim()
  // 模型可能输出「无相关/没有匹配」等散文：直接视为空，避免污染成假条目
  if (/没有|无相关|不存在|未找到|无法|nothing|no relevant/i.test(text)) return []
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start >= 0 && end > start) {
    try {
      const arr = JSON.parse(text.slice(start, end + 1))
      if (Array.isArray(arr)) {
        const picks: LlmRecallPick[] = []
        for (const x of arr) {
          if (!x || typeof x !== 'object') continue
          const o = x as Record<string, unknown>
          const node = typeof o.node === 'string' ? o.node.trim() : ''
          const beat = typeof o.beat === 'string' ? o.beat.trim() : ''
          const reason = typeof o.reason === 'string' ? o.reason.trim() : ''
          if (!node && !beat) continue
          picks.push({ node: node || undefined, beat: beat || undefined, reason: reason || undefined })
          if (picks.length >= 6) break
        }
        return picks
      }
    } catch {
      /* fall through to line parser */
    }
  }
  const out: LlmRecallPick[] = []
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim().replace(/^[-•*]\s*/, '')
    if (!t) continue
    const [a, ...rest] = t.split(/[|｜]/).map((s) => s.trim())
    if (!a) continue
    const reason = rest.join(' | ')
    const looksLikeBeat = a.startsWith('b_') || a.startsWith('s_') || /^[A-Za-z0-9_-]{6,}$/.test(a)
    out.push(looksLikeBeat ? { beat: a, reason } : { node: a, reason })
    if (out.length >= 6) break
  }
  return out
}

/** 回源校验：只保留图谱中真实存在的人物 / 冷档案中真实存在的条目，防幻觉 */
export function validateLlmRecallPicks(
  picks: LlmRecallPick[],
  graph: MemoryGraphState,
  archive: ArchiveBeat[],
): { nodes: string[]; beats: ArchiveBeat[] } {
  const norm = (s: string) => String(s || '').trim().toLowerCase().replace(/\s+/g, '')
  const nodeNames = new Set(graph.nodes.map((n) => norm(n.name)))
  const archiveById = new Map(archive.map((b) => [b.id, b]))
  const nodes: string[] = []
  const seenN = new Set<string>()
  const beats: ArchiveBeat[] = []
  const seenB = new Set<string>()
  for (const p of picks) {
    if (p.node) {
      const k = norm(p.node)
      if (nodeNames.has(k) && !seenN.has(k)) {
        seenN.add(k)
        const real = graph.nodes.find((n) => norm(n.name) === k)
        if (real) nodes.push(real.name)
      }
    }
    if (p.beat) {
      const b = archiveById.get(p.beat)
      if (b && !seenB.has(b.id)) {
        seenB.add(b.id)
        beats.push(b)
      }
    }
  }
  return { nodes, beats }
}

/** 格式化 LLM 召回注入块（全部来自图谱/档案原文） */
export function formatLlmRecallBlock(
  nodes: string[],
  beats: ArchiveBeat[],
  graph: MemoryGraphState,
  maxChars = 900,
): string {
  const lines: string[] = ['## LLM 召回', '（按查询语义补选，原文来自图谱/档案）']
  for (const name of nodes) {
    const n = graph.nodes.find((x) => x.name === name)
    if (!n) continue
    lines.push(`### ${n.name}`)
    const attrs = Object.entries(n.attrs || {})
      .filter(([k, v]) => v && k !== '人际关系' && k !== '纪要')
      .slice(0, 4)
      .map(([k, v]) => `- ${k}：${v}`)
    if (attrs.length) lines.push(...attrs)
    for (const b of (n.beats || []).slice(0, 3)) lines.push(`- 近事：${b.text}`)
  }
  for (const b of beats) {
    lines.push(
      `- 旧事〔${b.nodeName}〕：${b.text}${b.year ? `（${b.year}年${b.season || ''}）` : ''}`,
    )
  }
  let text = lines.join('\n')
  if (text.length > maxChars) text = text.slice(0, maxChars - 1) + '…'
  return text
}

/**
 * 完整 LLM 召回：目录 → 调用 → 解析 → 回源校验。
 * 任何失败返回 { ok: false, reason }，由调用方静默回退。
 */
export async function runLlmRecall(opts: {
  api: ApiSettings
  query: string
  graph: MemoryGraphState
  archive?: ArchiveBeat[]
  bank?: MemoryBank
  maxCatalogChars?: number
  maxTokens?: number
  timeoutMs?: number
}): Promise<LlmRecallResult> {
  const q = String(opts.query || '').trim()
  if (!q) return { ok: false, picks: [], nodes: [], beats: [], reason: '空查询' }
  const base = normalizeBaseUrl(opts.api.baseUrl || '')
  const apiKey = (opts.api.apiKey || '').trim()
  const model = (opts.api.model || '').trim()
  if (!base || !apiKey || !model) {
    return { ok: false, picks: [], nodes: [], beats: [], reason: '主 API 未配置' }
  }
  const catalog = buildRecallCatalog({
    graph: opts.graph,
    bank: opts.bank,
    archive: opts.archive,
    maxChars: opts.maxCatalogChars,
  })
  try {
    const completion = await postChatCompletion({
      baseUrl: base,
      apiKey,
      body: {
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `查询：${q}\n\n记忆目录：\n${catalog}` },
        ],
        stream: false,
        temperature: 0,
        max_tokens: opts.maxTokens ?? 240,
      },
      timeoutMs: opts.timeoutMs ?? 20000,
      bearerOnly: true,
    })
    if (!completion.ok) {
      return { ok: false, picks: [], nodes: [], beats: [], reason: `LLM 召回接口 ${completion.error}` }
    }
    const content = extractChatCompletionText(completion.data).text
    const picks = parseLlmRecallOutput(content)
    const { nodes, beats } = validateLlmRecallPicks(picks, opts.graph, opts.archive || [])
    return { ok: true, picks, nodes, beats, content }
  } catch (e) {
    return {
      ok: false,
      picks: [],
      nodes: [],
      beats: [],
      reason: e instanceof Error ? e.message : String(e),
    }
  }
}
