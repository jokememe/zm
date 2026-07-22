# 通用方案：任意域名都能用模型

## 原则

网页只做一件事：**直连你在密匣填的 Base URL**。  
不绑 Vercel、不绑 GitHub Pages、不搞特殊代理路径。

要「换什么域名打开游戏都能用」，必须让 **API 本身**满足浏览器规则：

| 页面 | API | 结果 |
|------|-----|------|
| `https://任意域名` | `https://你的API/v1` + **CORS 放行** | ✅ |
| `https://任意域名` | `http://IP:端口/v1` | ❌ 浏览器禁止（混合内容） |
| `https://任意域名` | `https://...` 但无 CORS | ❌ 跨域拦截 |

---

## 你要做的（中转 / New API 一侧）

### 1. 给中转加 HTTPS 域名

例如用 nginx / Caddy / Cloudflare：

```text
https://llm.example.com  →  http://127.0.0.1:15511
```

以后密匣只填：

```text
https://llm.example.com/v1
```

### 2. 开启 CORS（任意网页域名）

nginx 示例：

```nginx
server {
  listen 443 ssl;
  server_name llm.example.com;

  # ssl_certificate ...;

  location / {
    proxy_pass http://127.0.0.1:15511;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;

    # 关键：允许任意网站前端调用
    add_header Access-Control-Allow-Origin * always;
    add_header Access-Control-Allow-Headers * always;
    add_header Access-Control-Allow-Methods 'GET, POST, OPTIONS' always;

    if ($request_method = OPTIONS) {
      return 204;
    }
  }
}
```

New API 面板若有「跨域 / CORS」开关，也打开。

### 3. 游戏密匣

```text
Base URL:  https://llm.example.com/v1
API Key:   你的 key
模型:      你的模型 id
```

然后无论游戏挂在：

- `https://xxx.vercel.app`
- `https://xxx.github.io/zm/`
- `https://你自己的域名`

都一样用。

---

## 本项目代码侧

- **只直连**，不自动改写成 `/api/xxx`
- 不依赖部署平台
- 用户只配置密匣三个字段

可选的 `api/chat.js` 等文件可忽略；通用方案不依赖它们。
