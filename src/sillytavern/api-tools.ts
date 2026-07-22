/**
 * API helpers for OpenAI-compatible endpoints.
 * HTTPS 页 + HTTP 中转 → 固定走 /api/chat、/api/models（Vercel Serverless / Vite 代理）
 */

export interface ApiCallTarget {
  baseUrl: string
  apiKey: string
  model?: string
}

const COMMON_MODELS_BY_HOST: { match: string; models: string[] }[] = [
  { match: 'deepseek', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { match: 'moonshot', models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'kimi-latest'] },
  { match: 'kimi', models: ['moonshot-v1-8k', 'kimi-latest'] },
  { match: 'dashscope', models: ['qwen-turbo', 'qwen-plus', 'qwen-max'] },
  { match: 'qwen', models: ['qwen-turbo', 'qwen-plus', 'qwen-max'] },
  { match: 'siliconflow', models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-7B-Instruct'] },
  { match: 'openrouter', models: ['openai/gpt-4o-mini'] },
  { match: 'openai', models: ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'] },
  { match: 'localhost', models: ['local-model'] },
  { match: '127.0.0.1', models: ['local-model'] },
]

const FALLBACK_MODELS = ['gpt-4o-mini', 'deepseek-chat', 'qwen-plus']

export function getFallbackModels(baseUrl: string): string[] {
  const url = baseUrl.toLowerCase()
  for (const { match, models } of COMMON_MODELS_BY_HOST) {
    if (url.includes(match)) return models
  }
  return FALLBACK_MODELS
}

export function normalizeApiBaseUrl(url: string): string {
  let u = (url || '').trim()
  u = u.replace(/\/chat\/completions\/?$/i, '')
  u = u.replace(/\/models\/?$/i, '')
  u = u.replace(/\/+$/, '')
  return u
}

/** 是否应走服务端代理（HTTPS 页请求 HTTP API，或用户已填相对代理路径） */
export function shouldUseServerProxy(userBaseUrl: string): boolean {
  const raw = (userBaseUrl || '').trim()
  if (!raw) return false
  if (raw.startsWith('/') && !raw.startsWith('//')) return true
  let pageHttps = false
  try {
    pageHttps = typeof location !== 'undefined' && location.protocol === 'https:'
  } catch {
    pageHttps = false
  }
  return pageHttps && /^http:\/\//i.test(raw)
}

/**
 * 浏览器安全基址（仅用于展示/兼容旧逻辑）。
 * 实际请求在 proxy 模式下走固定 /api/chat、/api/models。
 */
export function toBrowserSafeApiBase(userBaseUrl: string): {
  fetchBase: string
  proxied: boolean
  original: string
} {
  const original = normalizeApiBaseUrl(userBaseUrl)
  if (!original) return { fetchBase: '', proxied: false, original: '' }
  if (shouldUseServerProxy(original) || original.startsWith('/api/')) {
    return { fetchBase: '/api', proxied: true, original }
  }
  return { fetchBase: original, proxied: false, original }
}

export function diagnoseBrowserApiBlock(baseUrl: string): {
  blocked: boolean
  reason: 'empty' | 'ok' | 'will-proxy'
  message: string
} {
  const raw = (baseUrl || '').trim()
  if (!raw) {
    return { blocked: true, reason: 'empty', message: '请填写 Base URL' }
  }
  if (shouldUseServerProxy(raw)) {
    return {
      blocked: false,
      reason: 'will-proxy',
      message: [
        '【已自动启用同源代理】',
        `你填写：${normalizeApiBaseUrl(raw)}`,
        '实际请求：POST /api/chat 、 GET /api/models',
        '由 Vercel 服务端转发到你的 HTTP 中转（默认 38.244.63.197:15511）。',
        '请直接保存并测试。',
      ].join('\n'),
    }
  }
  return { blocked: false, reason: 'ok', message: '' }
}

function candidateBases(baseUrl: string): string[] {
  const base = normalizeApiBaseUrl(baseUrl)
  if (!base || base.startsWith('/')) return base ? [base] : []
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
  const res = await fetch(modelsUrl, {
    method: 'GET',
    headers: { Accept: 'application/json', ...headers },
  })
  const text = await res.text().catch(() => '')
  if (!res.ok) {
    return { models: [], status: res.status, bodySnippet: text.slice(0, 240) }
  }
  try {
    const data = text ? JSON.parse(text) : null
    return { models: extractModelIds(data), status: res.status }
  } catch {
    return { models: [], status: res.status, bodySnippet: text.slice(0, 240) }
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
  const key = target.apiKey?.trim() || ''
  const styles: AuthStyle[] = key ? ['bearer', 'api-key', 'x-api-key'] : ['none']
  const tried: string[] = []
  const errors: string[] = []

  // ★ 代理模式：固定 GET /api/models
  if (shouldUseServerProxy(target.baseUrl)) {
    for (const style of styles) {
      const url = '/api/models'
      tried.push(`${url} [${style}]`)
      try {
        const { models, status, bodySnippet } = await tryFetchModelsOnce(
          url,
          authHeaders(style, key),
        )
        if (models.length > 0) return { models, source: 'remote', tried }
        errors.push(
          `${url} → HTTP ${status}${bodySnippet ? `: ${bodySnippet}` : ''}`,
        )
      } catch (e) {
        errors.push(`${url} → ${(e as Error).message || e}`)
      }
    }
    return {
      models: getFallbackModels(target.baseUrl),
      source: 'fallback',
      error: errors.slice(0, 3).join('\n') || '拉取失败',
      tried,
    }
  }

  const bases = candidateBases(target.baseUrl)
  if (!bases.length) {
    return { models: [], source: 'fallback', error: '请填写 API 基础 URL' }
  }

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
        if (status)
          errors.push(
            `${modelsUrl} → HTTP ${status}${bodySnippet ? `: ${bodySnippet}` : ''}`,
          )
      } catch (e) {
        const msg = (e as Error)?.message || String(e)
        errors.push(`${modelsUrl} → ${msg}`)
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
  const key = options.apiKey.trim()
  if (!key) return { ok: false, error: '请填写 API Key' }

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

  // ★ 代理模式：固定 POST /api/chat
  if (shouldUseServerProxy(options.baseUrl)) {
    const url = '/api/chat'
    const errors: string[] = []
    for (const headers of headerVariants) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(options.body),
        })
        const text = await res.text()
        if (res.ok) {
          try {
            return { ok: true, data: JSON.parse(text), usedUrl: url }
          } catch {
            return { ok: false, error: `${url} 返回非 JSON`, status: res.status }
          }
        }
        errors.push(`${url} HTTP ${res.status}: ${text.slice(0, 200)}`)
        if (res.status !== 401 && res.status !== 403) break
      } catch (e) {
        errors.push(`${url}: ${(e as Error).message || e}`)
      }
    }
    return { ok: false, error: errors[0] || '代理请求失败' }
  }

  const bases = candidateBases(options.baseUrl)
  if (!bases.length) return { ok: false, error: '请填写 Base URL' }

  const errors: string[] = []
  for (const base of bases) {
    const url = `${base}/chat/completions`
    for (const headers of headerVariants) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(options.body),
        })
        if (res.ok) {
          const data = await res.json()
          return { ok: true, data, usedUrl: url }
        }
        const text = await res.text().catch(() => '')
        errors.push(`${url} HTTP ${res.status}: ${text.slice(0, 120)}`)
        if (res.status !== 401 && res.status !== 403) break
      } catch (e) {
        const msg = (e as Error)?.message ?? String(e)
        errors.push(`${url}: ${msg}`)
        break
      }
    }
  }
  return { ok: false, error: errors[0] || '请求失败' }
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
    return { ok: false, error: '请填写模型名（可先「拉取模型」后点选）' }
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

  if (result.ok) {
    return { ok: true, usedUrl: result.usedUrl }
  }
  return { ok: false, error: result.error, errorBody: result.error }
}
