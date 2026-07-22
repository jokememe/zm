/**
 * GET /api/models → {LLM_PROXY_TARGET}/v1/models
 */
const TARGET = (process.env.LLM_PROXY_TARGET || 'http://38.244.63.197:15511').replace(
  /\/$/,
  '',
)

type Req = {
  method?: string
  headers: Record<string, string | string[] | undefined>
}

type Res = {
  status: (n: number) => Res
  setHeader: (k: string, v: string) => void
  end: (b?: string | Buffer) => void
  json: (b: unknown) => void
}

function pickHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const v = headers[name] ?? headers[name.toLowerCase()]
  return typeof v === 'string' ? v : undefined
}

export default async function handler(req: Req, res: Res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, api-key, x-api-key, Accept',
  )
  res.setHeader('X-LLM-Proxy', 'models')

  if ((req.method || '').toUpperCase() === 'OPTIONS') {
    res.status(204).end()
    return
  }
  if ((req.method || '').toUpperCase() !== 'GET') {
    res.status(405).json({ error: 'Method not allowed', use: 'GET /api/models' })
    return
  }

  const dest = `${TARGET}/v1/models`
  try {
    const headers: Record<string, string> = { Accept: 'application/json' }
    const auth = pickHeader(req.headers, 'authorization')
    if (auth) headers.Authorization = auth
    const apiKey = pickHeader(req.headers, 'api-key')
    if (apiKey) headers['api-key'] = apiKey
    const xKey = pickHeader(req.headers, 'x-api-key')
    if (xKey) headers['x-api-key'] = xKey

    const upstream = await fetch(dest, { method: 'GET', headers })
    const text = await upstream.text()
    const ct = upstream.headers.get('content-type') || 'application/json'
    res.setHeader('Content-Type', ct)
    res.setHeader('X-LLM-Proxy-Upstream', dest)
    res.status(upstream.status).end(text)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    res.status(502).json({
      error: 'LLM models proxy failed',
      message,
      upstream: dest,
    })
  }
}
