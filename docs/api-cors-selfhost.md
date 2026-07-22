# 可行方案：自动代理（推荐 Vercel）

## 你怎么填密匣

```text
Base URL:  http://38.244.63.197:15511/v1
API Key:   （你的 key）
模型:      （你的模型名）
```

在 **Vercel** 或 **本机 npm run dev** 上：

- 页面是 HTTPS / 本地时，前端**自动**把请求改成：`/api/llm/v1/...`
- 服务端再转发到：`http://38.244.63.197:15511/v1/...`

**你不用**改填 `/__llm/v1`，也不用自己配 CORS。

---

## 部署步骤（Vercel）

1. 打开 [vercel.com](https://vercel.com) → Import `jokememe/zm`
2. Deploy（仓库已含 `api/llm/[...path].ts` + `vercel.json`）
3. 打开 `https://xxx.vercel.app`
4. 密匣按上面填 `http://38...:15511/v1` → 保存 → 测试

可选：Vercel → Project → Settings → Environment Variables

```text
LLM_PROXY_TARGET=http://38.244.63.197:15511
```

不设则默认就是这个地址。

---

## 不要用纯静态 GitHub Pages

GitHub Pages **没有** Serverless，无法跑 `/api/llm` 反代。  
要用这个方案请用 **Vercel**（或把前端+反代自己架在服务器上）。

---

## 本机

```bash
npm run dev
```

密匣同样填 `http://38.244.63.197:15511/v1`，Vite 会代理 `/api/llm`。
