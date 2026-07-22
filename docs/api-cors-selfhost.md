# 为什么 GitHub Pages / Vercel 调不了 `http://IP:端口`？

## 结论

| 页面 | API | 浏览器 |
|------|-----|--------|
| `https://jokememe.github.io/...` | `http://38.x.x.x:15511/...` | **直接拦截**（混合内容 Mixed Content） |
| `https://xxx.vercel.app` 直连 | `http://38.x.x.x:15511/...` | **一样拦截**（Vercel 页也是 HTTPS） |
| `https://xxx.vercel.app` + 同源 `/__llm` 反代 | 服务端再去请求 HTTP | **可用**（浏览器只打 HTTPS 同源） |
| `https://...` | `https://...` | 还需 API 返回 CORS 头 |
| `http://你的服务器/...`（同源或已 CORS） | `http://同一台/...` | 通常可用 |

这不是模型名写错，是**浏览器安全策略**。前端代码无法「关掉」跨域/混合内容。

---

## 方案 0：Vercel 部署（推荐你这种 HTTP 中转）

仓库已含 `vercel.json`：把 `/__llm/*` 反代到 `http://38.244.63.197:15511/*`。

1. [vercel.com](https://vercel.com) 导入 GitHub 仓库 `jokememe/zm`
2. Framework 选 Vite，Output 为 `dist`（一般自动）
3. Deploy 完成后打开你的 `https://xxx.vercel.app`
4. 密匣 **Base URL 填**：

```text
/__llm/v1
```

（不要填 `http://38.244.63.197:15511/v1`）

5. 填 Key / 模型 → 保存 → 测试

换中转地址时，改 `vercel.json` 里 `destination` 的主机后重新部署。

若反代 502：检查该 IP:端口是否对公网开放、是否只允许内网。

---

## 方案 A：本机开发（最快验证）

```bash
# 可选：指定你的中转
set VITE_LLM_PROXY_TARGET=http://38.244.63.197:15511
npm run dev
```

密匣 Base URL 填：

```text
/__llm/v1
```

不要填完整 `http://38...`。请求会经 Vite 代理转发，避开混合内容。

---

## 方案 B：游戏和 API 都放你服务器（推荐长期玩）

1. 本机构建：`npm run build`
2. 把 `dist/` 拷到服务器，用任意静态服务打开（**HTTP 即可**）
3. 密匣填：`http://38.244.63.197:15511/v1`  
   若仍 CORS：在 API 或前面 nginx 加：

```nginx
add_header Access-Control-Allow-Origin *;
add_header Access-Control-Allow-Headers *;
add_header Access-Control-Allow-Methods 'GET, POST, OPTIONS';
if ($request_method = OPTIONS) { return 204; }
```

更稳：同源反代（页面和 `/v1` 同一域名端口）。

---

## 方案 C：给 API 上 HTTPS

用 Cloudflare Tunnel / Caddy / nginx+证书，把  
`http://38.244.63.197:15511` 变成 `https://你的域名/v1`，  
并配置 CORS 允许 `https://jokememe.github.io`。

之后 GitHub Pages 才能直连。

---

## 密匣怎么填

- 正确：`http://38.244.63.197:15511/v1` 或 `/__llm/v1`
- 错误：`http://38.244.63.197:15511/v1/chat/completions`（不要带 chat 路径）
