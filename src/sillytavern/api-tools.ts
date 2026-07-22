/**
 * API helpers for OpenAI-compatible endpoints.
 * Used by SettingsModal for connectivity testing and model discovery.
 */

export interface ApiCallTarget {
  baseUrl: string
  apiKey: string
  model?: string
}

const COMMON_MODELS_BY_HOST: { match: string; models: string[] }[] = [
  { match: 'deepseek', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { match: 'moonshot', models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k', 'kimi-latest'] },
  { match: 'kimi', models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'kimi-latest'] },
  { match: 'dashscope', models: ['qwen-turbo', 'qwen-plus', 'qwen-max'] },
  { match: 'aliyun', models: ['qwen-turbo', 'qwen-plus', 'qwen-max'] },
  { match: 'qwen', models: ['qwen-turbo', 'qwen-plus', 'qwen-max'] },
  { match: 'tongyi', models: ['qwen-turbo', 'qwen-plus', 'qwen-max'] },
  { match: 'siliconflow', models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-7B-Instruct'] },
  { match: 'openrouter', models: ['openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet'] },
  { match: 'groq', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'] },
  { match: 'openai', models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'] },
  { match: 'anthropic', models: ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest'] },
  { match: 'gemini', models: ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash'] },
  { match: 'localhost', models: ['local-model'] },
  { match: '127.0.0.1', models: ['local-model'] },
]

const FALLBACK_MODELS = ['gpt-4o-mini', 'deepseek-chat', 'qwen-plus', 'claude-3-5-sonnet-latest']

export function getFallbackModels(baseUrl: string): string[] {
  const url = baseUrl.toLowerCase()
  for (const { match, models } of COMMON_MODELS_BY_HOST) {
    if (url.includes(match)) return models
  }
  return FALLBACK_MODELS
}

/** 与 api-cache 一致：去掉尾斜杠、chat/completions 路径 */
export function normalizeApiBaseUrl(url: string): string {
  let u = (url || '').trim()
  u = u.replace(/\/chat\/completions\/?$/i, '')
  u = u.replace(/\/models\/?$/i, '')
  u = u.replace(/\/+$/, '')
  return u
}

/** 候选根路径：用户填了 /v1 或没填都尽量试到 */
function candidateBases(baseUrl: string): string[] {
  const base = normalizeApiBaseUrl(baseUrl)
  if (!base) return []
  const list = [base]
  if (!/\/v\d+$/i.test(base)) {
    list.push(`${base}/v1`)
  }
  // 去掉 /v1 再试（少数中转根路径即 API）
  if (/\/v\d+$/i.test(base)) {
    list.push(base.replace(/\/v\d+$/i, ''))
  }
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
    // OpenAI: { data: [{ id }] }
    if (Array.isArray(o.data)) o.data.forEach(push)
    // 部分中转: { models: [...] }
    if (Array.isArray(o.models)) o.models.forEach(push)
    // 嵌套: { data: { data: [...] } }
    if (o.data && typeof o.data === 'object' && !Array.isArray(o.data)) {
      const inner = o.data as Record<string, unknown>
      if (Array.isArray(inner.data)) inner.data.forEach(push)
      if (Array.isArray(inner.models)) inner.models.forEach(push)
    }
    // { object: "list", data: ... } 已覆盖
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
    headers: {
      Accept: 'application/json',
      ...headers,
    },
  })
  const text = await res.text().catch(() => '')
  if (!res.ok) {
    return { models: [], status: res.status, bodySnippet: text.slice(0, 240) }
  }
  let data: unknown
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    return { models: [], status: res.status, bodySnippet: text.slice(0, 240) }
  }
  return { models: extractModelIds(data), status: res.status }
}

/**
 * Fetch model list from an OpenAI-compatible /models endpoint.
 * Tries multiple base paths and auth headers.
 */
export async function fetchModels(
  target: ApiCallTarget,
): Promise<{
  models: string[]
  source: 'remote' | 'fallback'
  error?: string
  tried?: string[]
}> {
  const key = target.apiKey?.trim() || ''
  const bases = candidateBases(target.baseUrl)
  if (!bases.length) {
    return { models: [], source: 'fallback', error: '请填写 API 基础 URL' }
  }

  const tried: string[] = []
  const errors: string[] = []
  const styles: AuthStyle[] = key
    ? ['bearer', 'api-key', 'x-api-key']
    : ['none']

  for (const base of bases) {
    const modelsUrl = `${base}/models`
    for (const style of styles) {
      tried.push(`${modelsUrl} [${style}]`)
      try {
        const { models, status, bodySnippet } = await tryFetchModelsOnce(
          modelsUrl,
          authHeaders(style, key),
        )
        if (models.length > 0) {
          return { models, source: 'remote', tried }
        }
        if (status && status !== 200) {
          errors.push(`${modelsUrl} → HTTP ${status}${bodySnippet ? `: ${bodySnippet}` : ''}`)
        } else if (status === 200) {
          errors.push(`${modelsUrl} → 200 但未能解析模型列表`)
        }
      } catch (e) {
        const msg = (e as Error)?.message || String(e)
        // CORS / 网络
        if (/Failed to fetch|NetworkError|Load failed|CORS/i.test(msg)) {
          errors.push(
            `${modelsUrl} → 浏览器跨域或网络失败（${msg}）。可手动填写模型名，或使用允许 CORS 的中转。`,
          )
        } else {
          errors.push(`${modelsUrl} → ${msg}`)
        }
      }
    }
  }

  const fallback = getFallbackModels(bases[0])
  return {
    models: fallback,
    source: 'fallback',
    error: errors.slice(0, 4).join('\n') || '拉取失败',
    tried,
  }
}

/**
 * 发起 chat/completions：自动尝试 /v1 与多种鉴权头。
 * 供天机推演与连通测试共用。
 */
export async function postChatCompletion(options: {
  baseUrl: string
  apiKey: string
  body: Record<string, unknown>
}): Promise<{ ok: true; data: unknown; usedUrl: string } | { ok: false; error: string; status?: number }> {
  const key = options.apiKey.trim()
  const bases = candidateBases(options.baseUrl)
  if (!bases.length || !key) {
    return { ok: false, error: '请填写 URL 和 Key' }
  }

  const errors: string[] = []
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
        // 401/403 换鉴权头；其它错误可换 base
        if (res.status !== 401 && res.status !== 403) break
      } catch (e) {
        const msg = (e as Error)?.message ?? String(e)
        if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
          errors.push(`${url} 跨域/网络失败: ${msg}`)
          break
        }
        errors.push(`${url}: ${msg}`)
      }
    }
  }

  return {
    ok: false,
    error: errors[0] || '请求失败',
  }
}

/**
 * POST a tiny chat-completion request to verify connectivity.
 */
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
  return {
    ok: false,
    error: result.error,
    errorBody: result.error,
  }
}
