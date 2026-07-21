/**
 * SillyTavern regex_scripts — prompt 管线与 display 管线分离。
 * placement: 1 = USER, 2 = AI_OUTPUT（与 ST 一致）
 */

export interface RegexScript {
  id?: string
  scriptName?: string
  findRegex?: string
  replaceString?: string
  trimStrings?: string[]
  placement?: number[]
  disabled?: boolean
  markdownOnly?: boolean
  promptOnly?: boolean
  runOnEdit?: boolean
  substituteRegex?: number | boolean
  minDepth?: number | null
  maxDepth?: number | null
  [key: string]: unknown
}

export type RegexPipe = 'prompt' | 'display'

const PLACEMENT_USER = 1
const PLACEMENT_AI = 2

/** 从 settings 各处抽出脚本，归一到单一数组 */
export function extractRegexScripts(settings: Record<string, unknown> | null | undefined): RegexScript[] {
  if (!settings || typeof settings !== 'object') return []
  const bag: unknown[] = []

  const top = settings.regex_scripts
  if (Array.isArray(top)) bag.push(...top)

  const ext = settings.extensions as Record<string, unknown> | undefined
  if (ext && Array.isArray(ext.regex_scripts)) bag.push(...ext.regex_scripts)

  // SPreset / 部分导出把脚本挂在 bindings
  const bindings = (ext?.regex_binding ?? ext?.regexBindings) as unknown
  if (Array.isArray(bindings)) bag.push(...bindings)

  const out: RegexScript[] = []
  const seen = new Set<string>()
  for (const item of bag) {
    if (!item || typeof item !== 'object') continue
    const s = item as RegexScript
    const key = String(s.id ?? s.scriptName ?? s.findRegex ?? JSON.stringify(s).slice(0, 80))
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ ...s })
  }
  return out
}

function matchesPipe(script: RegexScript, pipe: RegexPipe): boolean {
  if (script.disabled) return false
  const md = !!script.markdownOnly
  const po = !!script.promptOnly
  if (pipe === 'display') {
    // 展示：markdownOnly，或两者皆未标（部分旧脚本）
    if (po && !md) return false
    return md || (!md && !po)
  }
  // prompt：promptOnly，或两者皆未标；绝不用纯 markdownOnly
  if (md && !po) return false
  return po || (!md && !po)
}

function matchesPlacement(script: RegexScript, placement: number): boolean {
  const p = script.placement
  if (!Array.isArray(p) || p.length === 0) {
    // 默认：display 偏 AI，prompt 两边都可
    return true
  }
  return p.includes(placement)
}

function compileFind(findRegex: string): RegExp | null {
  if (!findRegex) return null
  try {
    // ST 允许 /pattern/flags 或裸 pattern
    const m = findRegex.match(/^\/([\s\S]*)\/([a-z]*)$/i)
    if (m) return new RegExp(m[1], m[2] || 'g')
    return new RegExp(findRegex, 'g')
  } catch {
    return null
  }
}

export interface ApplyRegexResult {
  text: string
  applied: string[]
  errors: string[]
}

/**
 * 按管线应用正则。
 * @param placement 1=user 2=ai
 */
export function applyRegexScriptsDetailed(
  text: string,
  scripts: RegexScript[],
  pipe: RegexPipe,
  placement: number = pipe === 'display' ? PLACEMENT_AI : PLACEMENT_USER,
): ApplyRegexResult {
  let out = text
  const applied: string[] = []
  const errors: string[] = []

  for (const script of scripts) {
    if (!matchesPipe(script, pipe)) continue
    if (!matchesPlacement(script, placement)) continue
    const find = script.findRegex
    if (!find) continue
    const re = compileFind(find)
    if (!re) {
      errors.push(script.scriptName || find)
      continue
    }
    const replace = script.replaceString ?? ''
    try {
      // 保证全局替换可重复
      const flags = re.flags.includes('g') ? re.flags : re.flags + 'g'
      const gre = new RegExp(re.source, flags)
      const next = out.replace(gre, replace)
      if (next !== out) {
        applied.push(script.scriptName || script.id || find.slice(0, 24))
        out = next
      }
    } catch (e) {
      errors.push(`${script.scriptName || 'script'}: ${(e as Error).message}`)
    }
  }

  return { text: out, applied, errors }
}

export function applyPromptRegex(
  text: string,
  scripts: RegexScript[],
  isUser: boolean,
): string {
  return applyRegexScriptsDetailed(
    text,
    scripts,
    'prompt',
    isUser ? PLACEMENT_USER : PLACEMENT_AI,
  ).text
}

export function applyDisplayRegex(text: string, scripts: RegexScript[]): string {
  return applyRegexScriptsDetailed(text, scripts, 'display', PLACEMENT_AI).text
}

/** 展示层：剥掉仍漏出的游戏/ST 控制标签外壳（保留内容可选） */
export function stripControlTagsForDisplay(text: string): string {
  return text
    .replace(/<\/?(?:thinking|think|maintext|option|sum|vars)\b[^>]*>/gi, '')
    .replace(/<\/?(?:meow|think_nya~|background)\b[^>]*>/gi, '')
    .trim()
}
