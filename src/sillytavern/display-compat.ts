/**
 * 展示兼容：在 display regex 之后，把仍不适合气泡的结构折成可读文本。
 * 不做完整 ST DOM，只保证天机侧栏/推演正文能用。
 */

import { applyDisplayRegex, extractRegexScripts, stripControlTagsForDisplay } from './regex-scripts'

export interface DisplayPrepareResult {
  /** 给气泡/天机展示的纯文本（或轻量 HTML 已剥） */
  text: string
  /** 仍保留原始，供标签解析 */
  rawForParse: string
  folds: string[]
}

/**
 * @param raw 模型原文
 * @param settings 已 normalize 的预设 settings
 * @param opts.keepGameTags 为 true 时不剥 maintext/option 等（先解析再展示）
 */
export function prepareAssistantDisplay(
  raw: string,
  settings: Record<string, unknown> | null | undefined,
  opts?: { keepGameTags?: boolean },
): DisplayPrepareResult {
  const scripts = extractRegexScripts(settings || {})
  let text = applyDisplayRegex(raw, scripts)
  const folds: string[] = []

  // 常见思维/旁白折叠为摘要行（不删内容，包成可读块）
  text = text.replace(
    /<(thinking|think|think_nya~|meow)\b[^>]*>([\s\S]*?)<\/\1>/gi,
    (_m, tag: string, body: string) => {
      folds.push(String(tag))
      const inner = String(body).trim()
      if (!inner) return ''
      return `\n〔${tag}〕\n${inner}\n`
    },
  )

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
    text = stripControlTagsForDisplay(text)
  }

  return {
    text: text.trim(),
    rawForParse: raw,
    folds,
  }
}
