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

  // 只转发业务相关头，不泄露 cookie/origin/referer 等浏览器信息
  const forwardHeaders: Record<string, string> = {}
  const allow = ['authorization', 'api-key', 'x-api-key', 'content-type', 'accept']
  for (const key of allow) {
    const v = req.headers[key]
    if (typeof v === 'string' && v) forwardHeaders[key] = v
  }

  try {
    if (req.method === 'POST' && req.body) {
      if (!forwardHeaders['content-type']) {
        forwardHeaders['content-type'] = 'application/json'
      }
    }

    // 剧情可较长；局面分析也走此代理。默认 90s，可用 PROXY_TIMEOUT_MS 覆盖
    const proxyTimeoutMs = Math.min(
      Math.max(Number(process.env.PROXY_TIMEOUT_MS) || 90000, 15000),
      120000,
    )
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), proxyTimeoutMs)

    const fetchOpts: RequestInit = {
      method: req.method,
      headers: forwardHeaders,
      signal: controller.signal,
    }
    if (req.method === 'POST' && req.body) {
      fetchOpts.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
    }

    const upstream = await fetch(targetUrl.toString(), fetchOpts)
    clearTimeout(timer)

    const ct = upstream.headers.get('content-type') || ''

    // 流式 SSE：逐块透传，不缓冲
    if (ct.includes('text/event-stream') && upstream.body) {
      res.status(upstream.status)
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      res.flushHeaders()

      const reader = (upstream.body as ReadableStream<Uint8Array>).getReader()
      const decoder = new TextDecoder()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          res.write(decoder.decode(value, { stream: true }))
        }
      } catch {
        // 客户端断开或上游中断
      } finally {
        res.end()
      }
      return
    }

    // 非流式：缓冲后一次性返回
    const text = await upstream.text()
    res.status(upstream.status)
    if (ct) res.setHeader('Content-Type', ct)
    res.send(text)
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      return res.status(504).json({ error: '代理超时（请检查上游模型速度或 PROXY_TIMEOUT_MS）' })
    }
    res.status(502).json({ error: `代理请求失败: ${e?.message || e}` })
  }
}
