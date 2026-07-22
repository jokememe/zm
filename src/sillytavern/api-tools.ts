/**
 * OpenAI 兼容接口：部署环境通过 /api/proxy 服务端代理转发，任意域名可用。
 * 本地开发（localhost / HTTP）直连。
 */

export interface ApiCallTarget {
  baseUrl: string
  apiKey: string
  model?: string
}

/** 部署环境（HTTPS）走 Vercel Serverless 代理，本地直连 */
function proxify(url: string): string {
  try {
    if (typeof location !== 'undefined' && location.protocol === 'https:') {
      return `/api/proxy?target=${encodeURIComponent(url)}`
    }
  } catch { /* ignore */ }
  return url
}

const FALLBACK_MODELS = ['gpt-4o-mini', 'deepseek-chat', 'qwen-plus', 'gpt-3.5-turbo']

const COMMON_MODELS_BY_HOST: { match: string; models: string[] }[] = [
  { match: 'deepseek', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { match: 'moonshot', models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'kimi-latest'] },
  { match: 'qwen', models: ['qwen-turbo', 'qwen-plus', 'qwen-max'] },
  { match: 'openai', models: ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'] },
  { match: 'siliconflow', models: ['deepseek-ai/DeepSeek-V3'] },
  { match: 'localhost', models: ['local-model'] },
  { match: '127.0.0.1', models: ['local-model'] },
]

export function getFallbackModels(baseUrl: string): string[] {
  const url = baseUrl.toLowerCase()
  for (const { match, models } of COMMON_MODELS_BY_HOST) {
    if (url.includes(match)) return models
  }
  return FALLBACK_MODELS
}

/** 规范化：去掉末尾 /、误贴的 chat/completions 或 models */
export function normalizeApiBaseUrl(url: string): string {
  let u = (url || '').trim()
  u = u.replace(/\/chat\/completions\/?$/i, '')
  u = u.replace(/\/models\/?$/i, '')
  u = u.replace(/\/+$/, '')
  return u
}

/** @deprecated 兼容旧调用 */
export function normalizeBaseUrl(url: string): string {
  return normalizeApiBaseUrl(url)
}

/**
 * 直连可行性提示（仅提示，不改写请求）
 */
export function diagnoseBrowserApiBlock(baseUrl: string): {
  blocked: boolean
  reason: 'empty' | 'mixed-content' | 'ok'
  message: string
} {
  const raw = (baseUrl || '').trim()
  if (!raw) {
    return { blocked: true, reason: 'empty', message: '请填写 Base URL' }
  }

  // 走代理后 HTTP 目标也可用（服务端发请求无混合内容限制）
  return { blocked: false, reason: 'ok', message: '' }
}

function candidateBases(baseUrl: string): string[] {
  const base = normalizeApiBaseUrl(baseUrl)
  if (!base) return []
  if (base.startsWith('/')) return [base]
  const list = [base]
  if (!/\/v\d+$/i.test(base)) list.push(`${base}/v1`)
  if (/\/v\d+$/i.test(base)) list.push(base.replace(/\/v\d+$/i, ''))
  return [...new Set(list.filter(Boolean))]
}

function extractModelIds(data: unknown): string[] {
  if (!data) return []
  const out: string[] = []
  const push = (x: unknown) => {
    if (typeof x === 'string' && x.trim()) out.push(x.trim())
    else if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>
      const id = o.id ?? o.name ?? o.model
      if (typeof id === 'string' && id.trim()) out.push(id.trim())
    }
  }
  if (Array.isArray(data)) {
    data.forEach(push)
    return [...new Set(out)].sort()
  }
  if (typeof data === 'object') {
    const o = data as Record<string, unknown>
    if (Array.isArray(o.data)) o.data.forEach(push)
    if (Array.isArray(o.models)) o.models.forEach(push)
  }
  return [...new Set(out)].sort((a, b) => a.localeCompare(b))
}

type AuthStyle = 'bearer' | 'api-key' | 'x-api-key' | 'none'

function authHeaders(style: AuthStyle, key: string): Record<string, string> {
  if (!key || style === 'none') return {}
  if (style === 'bearer') return { Authorization: `Bearer ${key}` }
  if (style === 'api-key') return { 'api-key': key }
  if (style === 'x-api-key') return { 'x-api-key': key }
  return {}
}

async function tryFetchModelsOnce(
  modelsUrl: string,
  headers: Record<string, string>,
): Promise<{ models: string[]; status: number; bodySnippet?: string }> {
  const res = await fetch(proxify(modelsUrl), {
    method: 'GET',
    headers: { Accept: 'application/json', ...headers },
  })
  const text = await res.text().catch(() => '')
  if (!res.ok) {
    return { models: [], status: res.status, bodySnippet: text.slice(0, 280) }
  }
  try {
    return { models: extractModelIds(text ? JSON.parse(text) : null), status: res.status }
  } catch {
    return { models: [], status: res.status, bodySnippet: text.slice(0, 280) }
  }
}

export async function fetchModels(
  target: ApiCallTarget,
): Promise<{
  models: string[]
  source: 'remote' | 'fallback'
  error?: string
  tried?: string[]
}> {
  const diag = diagnoseBrowserApiBlock(target.baseUrl)
  if (diag.blocked && diag.reason === 'mixed-content') {
    return {
      models: getFallbackModels(target.baseUrl),
      source: 'fallback',
      error: diag.message,
    }
  }

  const key = target.apiKey?.trim() || ''
  const bases = candidateBases(target.baseUrl)
  if (!bases.length) {
    return { models: [], source: 'fallback', error: '请填写 API 基础 URL' }
  }

  const styles: AuthStyle[] = key ? ['bearer', 'api-key', 'x-api-key'] : ['none']
  const tried: string[] = []
  const errors: string[] = []

  for (const base of bases) {
    const modelsUrl = `${base}/models`
    for (const style of styles) {
      tried.push(`${modelsUrl} [${style}]`)
      try {
        const { models, status, bodySnippet } = await tryFetchModelsOnce(
          modelsUrl,
          authHeaders(style, key),
        )
        if (models.length > 0) return { models, source: 'remote', tried }
        errors.push(
          `${modelsUrl} → HTTP ${status}${bodySnippet ? `: ${bodySnippet}` : ''}`,
        )
      } catch (e) {
        const msg = (e as Error)?.message || String(e)
        if (/Failed to fetch|NetworkError|Load failed|CORS/i.test(msg)) {
          errors.push(
            `${modelsUrl} → 网络/CORS 失败。请确认 API 是 HTTPS，且响应头含 Access-Control-Allow-Origin。`,
          )
        } else {
          errors.push(`${modelsUrl} → ${msg}`)
        }
      }
    }
  }

  return {
    models: getFallbackModels(bases[0] || ''),
    source: 'fallback',
    error: errors.slice(0, 4).join('\n') || '拉取失败',
    tried,
  }
}

export async function postChatCompletion(options: {
  baseUrl: string
  apiKey: string
  body: Record<string, unknown>
}): Promise<{ ok: true; data: unknown; usedUrl: string } | { ok: false; error: string; status?: number }> {
  const diag = diagnoseBrowserApiBlock(options.baseUrl)
  if (diag.blocked && diag.reason === 'mixed-content') {
    return { ok: false, error: diag.message }
  }

  const key = options.apiKey.trim()
  if (!key) return { ok: false, error: '请填写 API Key' }

  const bases = candidateBases(options.baseUrl)
  if (!bases.length) return { ok: false, error: '请填写 Base URL' }

  const headerVariants: Record<string, string>[] = [
    {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${key}`,
    },
    {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'api-key': key,
    },
    {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-api-key': key,
    },
  ]

  const errors: string[] = []
  for (const base of bases) {
    const url = `${base}/chat/completions`
    for (const headers of headerVariants) {
      try {
        const res = await fetch(proxify(url), {
          method: 'POST',
          headers,
          body: JSON.stringify(options.body),
        })
        if (res.ok) {
          const data = await res.json()
          return { ok: true, data, usedUrl: url }
        }
        const text = await res.text().catch(() => '')
        errors.push(`${url} HTTP ${res.status}: ${text.slice(0, 160)}`)
        if (res.status !== 401 && res.status !== 403) break
      } catch (e) {
        const msg = (e as Error)?.message ?? String(e)
        if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
          errors.push(
            `${url} 失败（多为 CORS 或混合内容）。API 需 HTTPS + Access-Control-Allow-Origin。`,
          )
        } else {
          errors.push(`${url}: ${msg}`)
        }
        break
      }
    }
  }

  return { ok: false, error: errors[0] || '请求失败' }
}

/**
 * 流式 chat completion（SSE）。
 * onChunk 每收到一段 delta 文本就回调一次，用于逐字显示。
 * 返回完整拼接文本。
 */
export async function postChatCompletionStream(options: {
  baseUrl: string
  apiKey: string
  body: Record<string, unknown>
  onChunk: (delta: string, accumulated: string) => void
}): Promise<{ ok: true; text: string; usedUrl: string } | { ok: false; error: string }> {
  const key = options.apiKey.trim()
  if (!key) return { ok: false, error: '请填写 API Key' }

  const bases = candidateBases(options.baseUrl)
  if (!bases.length) return { ok: false, error: '请填写 Base URL' }

  const base = bases[0]
  const url = `${base}/chat/completions`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    Authorization: `Bearer ${key}`,
  }

  try {
    const res = await fetch(proxify(url), {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...options.body, stream: true }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` }
    }

    const reader = res.body?.getReader()
    if (!reader) {
      // 无 body（不应该发生），降级读全文
      const text = await res.text().catch(() => '')
      return { ok: false, error: `无流式 body: ${text.slice(0, 120)}` }
    }

    const decoder = new TextDecoder()
    let accumulated = ''
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // SSE 按行分割
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (payload === '[DONE]') continue
        try {
          const json = JSON.parse(payload)
          const delta: string = json.choices?.[0]?.delta?.content ?? ''
          if (delta) {
            accumulated += delta
            options.onChunk(delta, accumulated)
          }
        } catch {
          // 非 JSON 行，跳过
        }
      }
    }

    return { ok: true, text: accumulated, usedUrl: url }
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e)
    return { ok: false, error: `流式请求失败: ${msg}` }
  }
}

export async function testConnection(
  target: ApiCallTarget,
): Promise<{
  ok: boolean
  status?: number
  errorBody?: string
  error?: string
  usedUrl?: string
}> {
  const model = target.model?.trim()
  if (!model) {
    return { ok: false, error: '请填写模型名' }
  }
  const result = await postChatCompletion({
    baseUrl: target.baseUrl,
    apiKey: target.apiKey,
    body: {
      model,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 5,
      stream: false,
    },
  })
  if (result.ok) return { ok: true, usedUrl: result.usedUrl }
  return { ok: false, error: result.error, errorBody: result.error }
}
