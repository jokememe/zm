/**
 * 记忆摘要层（柏宝书化 · LLM 摘要记账）
 * ---------------------------------------------------------------------------
 * 把一回合的剧情正文发给一个独立小模型（如本地 Gemma / Qwen 等），
 * 提炼成结构化实体/状态变更，再写入记忆图谱。
 *
 * 与 memory-graph.ingestReplyDigest（纯正则）的关系：
 *   - 启用 LLM 摘要时，本模块替代正则记账，质量更高
 *   - LLM 调用失败 / 未配置时，调用方回退到 ingestReplyDigest
 *
 * 本模块只做「记账」，召回由 system-lorebook / memory-embed（L3）负责。
 */

import { createApiRouter } from '@/sillytavern/api-router'
import type { ApiSettings, EmbeddingApiConfig } from '@/sillytavern/types'
import { DEFAULT_MASTER_NAME } from '@/data/opening'
import {
  applyMemoryGraphPatch,
  loadMemoryGraph,
  saveMemoryGraph,
  resolveProtagonistAlias,
  getMasterTitles,
  type MemoryGraphEdgeType,
} from './memory-graph'

const FALLBACK_STOP = new Set([
  '掌门',
  '弟子',
  '宗门',
  '今日',
  '本座',
  '我们',
  '他们',
  '你们',
  '自己',
  '这里',
  '那里',
  '事情',
  '一个',
])

function normalizeName(name: string): string {
  return String(name || '')
    .replace(/[\s·•・.。，,、]/g, '')
    .toLowerCase()
    .trim()
}

export interface SummaryBeat {
  id: string
  text: string
  nodeName: string
  year?: number
  season?: string
}

export interface SummaryResult {
  beatCount: number
  beats: SummaryBeat[]
  itemNodes: number
  placeNodes: number
  relationEdges: number
}

const SYSTEM_PROMPT = `你是仙侠小说的记忆记账员。阅读一段剧情正文，提取其中发生的实体与状态变化。
每行一条，严格使用如下格式（字段间用竖线 | 分隔，不要多余解释、不要 JSON、不要代码块）：
物品|角色|动作|物品名
地点|角色|动作|地点名
状态|角色|状态
关系|角色A|关系|角色B
要求：
- 角色必须是给定名册中的名字，否则丢弃该行
- 若正文以「掌门 / 本座 / 宗主」等称呼指代男主，请使用名册中的真实名字输出（不要输出「掌门」）
- 物品的动作只能取：获得/失去/使用/传递
- 地点的动作只能取：抵达/离开
- 状态只能取：突破/受伤/中毒/痊愈/修为精进
- 关系只能取：道侣/结义/师徒/仇恨
- 没有变化就不输出任何行`

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** 解析小模型输出（竖线分隔行），返回结构化片段 + 写入图谱的 patch */
function parseSummaryLines(
  content: string,
  rosterNames: string[],
  calendar?: { year: number; season: string },
): { patch: ReturnType<typeof loadMemoryGraph> extends never ? never : any; beats: SummaryBeat[]; stats: Omit<SummaryResult, 'beats'> } {
  const rosterNorm = new Set([
    ...rosterNames.map((n) => normalizeName(n)),
    ...getMasterTitles().map((t) => normalizeName(t)),
    normalizeName(DEFAULT_MASTER_NAME),
  ])
  const patch: { nodes: any[]; edges: any[] } = { nodes: [], edges: [] }
  const beats: SummaryBeat[] = []
  const stats: Omit<SummaryResult, 'beats'> = { beatCount: 0, itemNodes: 0, placeNodes: 0, relationEdges: 0 }
  const cal: { year?: number; season?: string } = calendar || {}

  const pushBeat = (name: string, text: string) => {
    patch.nodes.push({
      name,
      kind: 'character',
      beat: text,
      beatYear: cal.year,
      beatSeason: cal.season,
    })
    beats.push({ id: newId('b'), text, nodeName: name, year: cal.year, season: cal.season })
    stats.beatCount++
  }

  const lines = content.split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(/^(物品|地点|状态|关系)\|(.+)$/)
    if (!m) continue
    const type = m[1]
    const parts = m[2].split('|').map((s) => s.trim())

    if (type === '物品' && parts.length >= 3) {
      const who = resolveProtagonistAlias(parts[0])
      const act = parts[1]
      const what = parts[2]
      if (who.length < 2 || what.length < 2) continue
      if (FALLBACK_STOP.has(who) || FALLBACK_STOP.has(what)) continue
      if (!rosterNorm.has(normalizeName(who))) continue
      patch.nodes.push({ name: what, kind: 'item', attrs: { 关联角色: who, 状态: act } })
      pushBeat(who, `${act}${what}`)
      stats.itemNodes++
    } else if (type === '地点' && parts.length >= 3) {
      const who = resolveProtagonistAlias(parts[0])
      const act = parts[1]
      const place = parts[2]
      if (who.length < 2 || place.length < 2) continue
      if (FALLBACK_STOP.has(who) || FALLBACK_STOP.has(place)) continue
      if (!rosterNorm.has(normalizeName(who))) continue
      patch.nodes.push({ name: place, kind: 'place', attrs: { 最近出入: who } })
      pushBeat(who, /抵达|到达|进入|前往|赶赴/.test(act) ? `抵达${place}` : `离开${place}`)
      stats.placeNodes++
    } else if (type === '状态' && parts.length >= 2) {
      const who = resolveProtagonistAlias(parts[0])
      const status = parts[1]
      if (who.length < 2) continue
      if (FALLBACK_STOP.has(who)) continue
      if (!rosterNorm.has(normalizeName(who))) continue
      pushBeat(who, status)
      if (status === '突破' || status === '修为精进') {
        patch.nodes.push({ name: who, kind: 'character', attrs: { 最近状态: status } })
      }
    } else if (type === '关系' && parts.length >= 3) {
      const a = resolveProtagonistAlias(parts[0])
      const rel = parts[1] as MemoryGraphEdgeType
      const b = resolveProtagonistAlias(parts[2])
      if (a.length < 2 || b.length < 2) continue
      if (FALLBACK_STOP.has(a) || FALLBACK_STOP.has(b)) continue
      const aOk = rosterNorm.has(normalizeName(a))
      const bOk = rosterNorm.has(normalizeName(b))
      if (!aOk && !bOk) continue
      patch.edges.push({ from: a, to: b, type: rel })
      pushBeat(a, `${rel}${b}`)
      pushBeat(b, `${rel}${a}`)
      stats.relationEdges++
    }
  }

  return { patch, beats, stats }
}

/**
 * 调用小模型把回合正文提炼成结构化记忆并写入图谱。
 * 任何异常都向上抛出，由调用方决定回退到正则记账。
 */
export async function summarizeTurnToBeats(opts: {
  body: string
  rosterNames: string[]
  calendar?: { year: number; season: string }
  api: ApiSettings
  summaryApi: EmbeddingApiConfig
}): Promise<SummaryResult> {
  const body = String(opts.body || '')
    .replace(/<[^>]+>/g, '')
    .trim()
  if (body.length < 16) {
    return { beatCount: 0, beats: [], itemNodes: 0, placeNodes: 0, relationEdges: 0 }
  }

  const summarySettings: ApiSettings = {
    baseUrl: opts.summaryApi.baseUrl || '',
    apiKey: opts.summaryApi.apiKey || '',
    model: opts.summaryApi.model || '',
    timeout: 20000,
  }

  const router = createApiRouter(summarySettings)
  const rosterLine = (opts.rosterNames || []).join('、')
  const userMsg = `名册角色：${rosterLine}\n\n正文：\n${body}`

  const { response } = await router.call('story', {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMsg },
    ],
    stream: false,
    temperature: 0.2,
    max_tokens: 320,
  })
  if (!response.ok) {
    throw new Error(`LLM 摘要接口 HTTP ${response.status}`)
  }
  const data = (await response.json()) as any
  const content = data?.choices?.[0]?.message?.content || ''
  if (!content.trim()) {
    return { beatCount: 0, beats: [], itemNodes: 0, placeNodes: 0, relationEdges: 0 }
  }

  const { patch, beats, stats } = parseSummaryLines(content, opts.rosterNames, opts.calendar)
  if ((patch.nodes.length || 0) > 0 || (patch.edges.length || 0) > 0) {
    const g = loadMemoryGraph()
    const next = applyMemoryGraphPatch(g, patch as any)
    saveMemoryGraph(next)
  }
  return { beats, ...stats }
}
