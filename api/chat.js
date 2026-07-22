/**
 * POST /api/chat → 中转 /v1/chat/completions
 * 用 CommonJS，避免 package.json "type":"module" 导致 Vercel 函数挂掉
 */
const TARGET = (process.env.LLM_PROXY_TARGET || 'http://38.244.63.197:15511').replace(
  /\/$/,
  '',
)

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, api-key, x-api-key, Accept',
  )
  res.setHeader('X-LLM-Proxy', 'chat')

  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Use POST /api/chat' }))
    return
  }

  const dest = TARGET + '/v1/chat/completions'
  try {
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }
    if (req.headers.authorization) headers.Authorization = req.headers.authorization
    if (req.headers['api-key']) headers['api-key'] = req.headers['api-key']
    if (req.headers['x-api-key']) headers['x-api-key'] = req.headers['x-api-key']

    const body =
      typeof req.body === 'string' ? req.body : JSON.stringify(req.body != null ? req.body : {})

    const upstream = await fetch(dest, { method: 'POST', headers, body })
    const text = await upstream.text()
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
    res.setHeader('X-LLM-Proxy-Upstream', dest)
    res.statusCode = upstream.status
    res.end(text)
  } catch (e) {
    res.statusCode = 502
    res.setHeader('Content-Type', 'application/json')
    res.end(
      JSON.stringify({
        error: 'proxy_failed',
        message: e && e.message ? e.message : String(e),
        upstream: dest,
      }),
    )
  }
}
