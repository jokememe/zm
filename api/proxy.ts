/**
 * 通用 API 代理 —— Vercel Serverless Function
 * 浏览器请求 /api/proxy?target=<encodedURL>，服务端转发到目标 API。
 * 支持 GET / POST，透传 headers 和 body，解决任意域名 CORS 问题。
 */

const ALLOWED_METHODS = ['GET', 'POST', 'OPTIONS']

export default async function handler(req: any, res: any) {
  // CORS preflight（同源其实不需要，但保险）
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', '*')

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  if (!ALLOWED_METHODS.includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const target = req.query?.target
  if (!target || typeof target !== 'string') {
    return res.status(400).json({ error: '缺少 target 参数' })
  }

  // 安全校验：只允许 http/https
  let targetUrl: URL
  try {
    targetUrl = new URL(target)
    if (!['http:', 'https:'].includes(targetUrl.protocol)) {
      return res.status(400).json({ error: '仅支持 http/https' })
    }
  } catch {
    return res.status(400).json({ error: 'target 不是合法 URL' })
  }

  // 透传请求头（过滤 host 等 hop-by-hop）
  const forwardHeaders: Record<string, string> = {}
  const skip = new Set(['host', 'connection', 'transfer-encoding', 'keep-alive'])
  for (const [k, v] of Object.entries(req.headers)) {
    if (!skip.has(k.toLowerCase()) && typeof v === 'string') {
      forwardHeaders[k] = v
    }
  }

  try {
    const fetchOpts: RequestInit = {
      method: req.method,
      headers: forwardHeaders,
    }
    if (req.method === 'POST' && req.body) {
      fetchOpts.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
      if (!forwardHeaders['content-type']) {
        forwardHeaders['content-type'] = 'application/json'
      }
    }

    const upstream = await fetch(targetUrl.toString(), fetchOpts)
    const text = await upstream.text()

    res.status(upstream.status)
    const ct = upstream.headers.get('content-type')
    if (ct) res.setHeader('Content-Type', ct)
    res.send(text)
  } catch (e: any) {
    res.status(502).json({ error: `代理请求失败: ${e?.message || e}` })
  }
}
