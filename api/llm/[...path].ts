/**
 * Vercel Serverless 反代：浏览器 → /api/llm/v1/... → HTTP 中转
 *
 * 环境变量（Vercel Project Settings → Environment Variables）：
 *   LLM_PROXY_TARGET=http://38.244.63.197:15511
 */
const TARGET = (process.env.LLM_PROXY_TARGET || 'http://38.244.63.197:15511').replace(
  /\/$/,
  '',
)

type VercelReq = {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
  query: Record<string, string | string[] | undefined>
  body?: unknown
}

type VercelRes = {
  status: (code: number) => VercelRes
  setHeader: (k: string, v: string) => void
  end: (body?: string | Buffer) => void
  json: (body: unknown) => void
}

export default async function handler(req: VercelReq, res: VercelRes) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, api-key, x-api-key, Accept',
  )

  if ((req.method || 'GET').toUpperCase() === 'OPTIONS') {
    res.status(204).end()
    return
  }

  const rawPath = req.query.path
  const sub =
    (Array.isArray(rawPath) ? rawPath.join('/') : rawPath || '').replace(/^\/+/, '') || ''
  const qs =
    req.url && req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''
  const dest = `${TARGET}/${sub}${qs}`

  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    }
    const h = req.headers
    if (typeof h.authorization === 'string') headers.Authorization = h.authorization
    if (typeof h['api-key'] === 'string') headers['api-key'] = h['api-key']
    if (typeof h['x-api-key'] === 'string') headers['x-api-key'] = h['x-api-key']

    const method = (req.method || 'GET').toUpperCase()
    const init: RequestInit = { method, headers }

    if (method !== 'GET' && method !== 'HEAD') {
      headers['Content-Type'] =
        typeof h['content-type'] === 'string' ? h['content-type'] : 'application/json'
      if (typeof req.body === 'string') {
        init.body = req.body
      } else if (req.body != null) {
        init.body = JSON.stringify(req.body)
      }
    }

    const upstream = await fetch(dest, init)
    const buf = Buffer.from(await upstream.arrayBuffer())
    const ct = upstream.headers.get('content-type')
    if (ct) res.setHeader('Content-Type', ct)
    res.status(upstream.status).end(buf)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    res.status(502).json({
      error: 'LLM proxy failed',
      message,
      target: TARGET,
      hint: '在 Vercel 设置 LLM_PROXY_TARGET，并确认 IP:端口对公网开放',
    })
  }
}
