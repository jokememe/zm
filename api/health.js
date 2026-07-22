/** GET /api/health — 用来确认 Vercel 函数是否部署成功 */
module.exports = function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')
  res.statusCode = 200
  res.end(
    JSON.stringify({
      ok: true,
      service: 'zongmen-llm-proxy',
      target: process.env.LLM_PROXY_TARGET || 'http://38.244.63.197:15511',
      time: new Date().toISOString(),
    }),
  )
}
