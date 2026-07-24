/**
 * 展示兼容：在 display regex 之后，把仍不适合气泡的结构折成可读文本。
 * 不做完整 ST DOM，只保证天机侧栏/推演正文能用。
 *
 * 典型故障：社区预设强制输出大量 XML/HTML 标签（thinking/option/Memory/meow…），
 * 若只剥外壳或 keepGameTags，气泡会「爆标签」导致正文不可读。
 */

import { applyDisplayRegex, extractRegexScripts, stripControlTagsForDisplay } from './regex-scripts'

export interface DisplayPrepareResult {
  /** 给气泡/天机展示的纯文本（或轻量 HTML 已剥） */
  text: string
  /** 仍保留原始，供标签解析 */
  rawForParse: string
  folds: string[]
  /** 是否从 maintext（或等价正文标签）抽出 */
  fromMaintext: boolean
}

/** 整块删除（含内容）——控制/旁路/记忆，不应出现在正文 */
const BLOCK_STRIP_TAGS = [
  'thinking',
  'think',
  'think_nya~',
  'meow',
  'option',
  'vars',
  'var',
  'Memory',
  'GaigaiMemory',
  'tableEdit',
  'background',
  'comment',
  'status',
  'StatusBlock',
  'StatusPlaceHolderImpl',
  'r\\d+', // 部分预设 <r0>…</r0>
] as const

/** 仅剥外壳、保留内文 */
const SHELL_STRIP_TAGS = [
  'maintext',
  'sum',
  'content',
  'text',
  'story',
  'output',
  'response',
  'message',
  'answer',
  'reply',
  'narration',
  'plot',
] as const

/** 正文优先标签（按优先级） */
const MAIN_CANDIDATES = ['maintext', 'content', 'story', 'text', 'output', 'response', 'narration', 'plot'] as const

function collapseWs(text: string): string {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 抽出完整闭合标签内文；tag 可为正则片段 */
export function extractTagInner(raw: string, tag: string): string {
  try {
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i')
    const m = String(raw || '').match(re)
    return m?.[1]?.trim() || ''
  } catch {
    return ''
  }
}

/**
 * 流式未闭合时：取最后一个开标签后的内容（仅用于展示）。
 */
export function extractOpenTagTail(raw: string, tag: string): string {
  try {
    const re = new RegExp(`<${tag}\\b[^>]*>`, 'gi')
    let lastIdx = -1
    let m: RegExpExecArray | null
    while ((m = re.exec(String(raw || ''))) !== null) {
      lastIdx = m.index + m[0].length
    }
    if (lastIdx < 0) return ''
    const close = new RegExp(`</${tag}\\s*>`, 'i')
    const rest = String(raw).slice(lastIdx)
    if (close.test(rest)) return '' // 已闭合则走 extractTagInner
    // 去掉其后可能出现的其它开标签碎片
    return rest.replace(/<[^>]*$/u, '').trim()
  } catch {
    return ''
  }
}

/** 优先 maintext，其次常见正文标签；支持流式未闭合 */
export function extractDisplayMaintext(raw: string): string {
  const s = String(raw || '')
  for (const tag of MAIN_CANDIDATES) {
    const full = extractTagInner(s, tag)
    if (full) return full
  }
  for (const tag of MAIN_CANDIDATES) {
    const tail = extractOpenTagTail(s, tag)
    if (tail) return tail
  }
  return ''
}

/** 去掉控制块与外壳；无 maintext 时的兜底净化 */
export function stripControlBlocksForDisplay(text: string): string {
  let t = String(text || '')

  // 1) 整块删除（含未闭合：从开标签删到文末，避免 thinking 半截刷屏）
  for (const tag of BLOCK_STRIP_TAGS) {
    try {
      const closed = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}\\s*>`, 'gi')
      t = t.replace(closed, '')
      // 未闭合开标签 → 删到文末
      const openTail = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*$`, 'i')
      t = t.replace(openTail, '')
      // 残留闭合
      const closeOnly = new RegExp(`</${tag}\\s*>`, 'gi')
      t = t.replace(closeOnly, '')
    } catch {
      /* skip bad tag pattern */
    }
  }

  // 2) 剥外壳保留内文
  for (const tag of SHELL_STRIP_TAGS) {
    try {
      const re = new RegExp(`</?${tag}\\b[^>]*>`, 'gi')
      t = t.replace(re, '')
    } catch {
      /* skip */
    }
  }

  // 3) 基础壳 + 常见 ST 壳
  t = stripControlTagsForDisplay(t)

  // 4) 残留「短名 XML 标签」：<Foo> / </Foo> / <Foo bar="x">（长度受限，避免误伤比较运算符）
  //    仅剥标签本身，保留中间正文
  t = t.replace(/<\/?[A-Za-z\u4e00-\u9fff][\w\u4e00-\u9fff:.-]{0,40}(?:\s[^<>]{0,120})?>/g, '')

  // 5) markdown 代码围栏里的整页 HTML 残骸
  t = t.replace(/```(?:html|xml|svg)?\s*[\s\S]*?```/gi, '')

  // 6) 流式末尾未完成的半截标签 `<main…` / `<think…`
  t = t.replace(/<[^>\n]{0,64}$/u, '')

  return collapseWs(t)
}

/**
 * 展示用正文：display regex → 抽 maintext → 剥控制块。
 * 解析/结算仍应使用原始 raw，勿把本函数结果当 vars 源。
 */
export function sanitizeAssistantForDisplay(
  raw: string,
  settings?: Record<string, unknown> | null,
  opts?: { includeSum?: boolean },
): string {
  const scripts = extractRegexScripts(settings || {})
  let text = applyDisplayRegex(String(raw || ''), scripts)

  const main = extractDisplayMaintext(text) || extractDisplayMaintext(String(raw || ''))
  if (main) {
    let out = collapseWs(main)
    // main 内若仍嵌套控制块，再剥一层
    out = stripControlBlocksForDisplay(out)
    if (opts?.includeSum !== false) {
      const sum =
        extractTagInner(text, 'sum') ||
        extractTagInner(String(raw || ''), 'sum')
      if (sum && !out.includes(sum.slice(0, Math.min(20, sum.length)))) {
        out = `${out}\n\n〔小结〕${collapseWs(sum)}`
      }
    }
    return out
  }

  // 思维/旁白整块去掉（无 maintext 时；天机有独立思绪区）
  text = text.replace(
    /<(thinking|think|think_nya~|meow)\b[^>]*>[\s\S]*?<\/\1>/gi,
    '',
  )

  // 整页 HTML 垃圾
  if (/<html[\s>]|<body[\s>]|<div class=/i.test(text) && text.length > 800) {
    text = text
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  }

  return stripControlBlocksForDisplay(text)
}

/**
 * @param raw 模型原文
 * @param settings 已 normalize 的预设 settings
 * @param opts.keepGameTags 为 true 时不剥 maintext/option 等（先解析再展示）——
 *   仅影响中间态；最终气泡请用 sanitizeAssistantForDisplay
 */
export function prepareAssistantDisplay(
  raw: string,
  settings: Record<string, unknown> | null | undefined,
  opts?: { keepGameTags?: boolean },
): DisplayPrepareResult {
  const scripts = extractRegexScripts(settings || {})
  let text = applyDisplayRegex(raw, scripts)
  const folds: string[] = []
  let fromMaintext = false

  // 优先：能抽出正文则直接干净返回
  const main = extractDisplayMaintext(text) || extractDisplayMaintext(raw)
  if (main && !opts?.keepGameTags) {
    fromMaintext = true
    const cleaned = stripControlBlocksForDisplay(main)
    return {
      text: cleaned,
      rawForParse: raw,
      folds: ['maintext'],
      fromMaintext: true,
    }
  }

  // 常见思维/旁白折叠为摘要行（不删内容，包成可读块）—— keepGameTags 时留给解析
  if (!opts?.keepGameTags) {
    text = text.replace(
      /<(thinking|think|think_nya~|meow)\b[^>]*>([\s\S]*?)<\/\1>/gi,
      (_m, tag: string, body: string) => {
        folds.push(String(tag))
        const inner = String(body).trim()
        if (!inner) return ''
        return `\n〔${tag}〕\n${inner}\n`
      },
    )
  }

  // 整页 HTML 垃圾：去掉 script/style，压平标签
  if (/<html[\s>]|<body[\s>]|<div class=/i.test(text) && text.length > 800) {
    folds.push('html-collapse')
    text = text
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  if (!opts?.keepGameTags) {
    text = stripControlBlocksForDisplay(text)
  }

  return {
    text: collapseWs(text),
    rawForParse: raw,
    folds,
    fromMaintext,
  }
}
