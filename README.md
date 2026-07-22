# 破败宗门 · 复兴之路

修真模拟经营 **Web 前端原型**（仅前端，无后端）。右侧「天机卷轴」可注入事务上下文并本地模拟推演。

## 技术栈

- Vite 8 + Vue 3 + TypeScript
- 纯 CSS 设计系统（月白云雾美学）
- 视图按需异步加载

## 启动

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
npm run preview
```

## 部署（GitHub Actions → Pages）

本仓库已配置 `.github/workflows/deploy-pages.yml`：推送到 `main` / `master` 后自动构建 `dist` 并发布到 **GitHub Pages**。

### 一次性准备

```bash
# 1. 初始化并推送（若尚未是 git 仓库）
git init
git add .
git commit -m "chore: initial commit"
# 在 GitHub 上新建空仓库后：
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git branch -M main
git push -u origin main
```

2. 打开仓库 **Settings → Pages**
3. **Build and deployment → Source** 选 **GitHub Actions**（不要选 Deploy from a branch）
4. 打开 **Actions** 页，应能看到 `Deploy to GitHub Pages` 跑通
5. 部署成功后，Settings → Pages 里会显示站点地址，一般是：
   - 用户站：`https://<用户名>.github.io/<仓库名>/`
   - 若仓库名是 `<用户名>.github.io` 则为根域名

`vite.config.ts` 里已设 `base: './'`，子路径 Pages 可直接用。

### 模型 API（通用直连）

浏览器**直连**密匣里的 Base URL，**不绑** Vercel / Pages 特殊代理。

任意域名可用的条件（在中转服务器上配置）：

1. API 用 **HTTPS**（不要用 `http://IP:端口` 给 HTTPS 网页用）  
2. 开启 **CORS**（`Access-Control-Allow-Origin: *` 等）

密匣只填：

```text
Base URL:  https://你的中转域名/v1
API Key:   …
模型:      …
```

详见 [docs/通用API配置.md](docs/通用API配置.md)。

## 功能模块

| 模块 | 说明 |
|------|------|
| 宗门大殿 | 总览指标、紧急事件、事务捷径、简史 |
| 灵田 / 炼丹 / 锻器 | 生产经营，含具体 mock 数据与模态 |
| 藏经阁 / 宝库 | 秘籍与法宝详情 |
| 弟子名册 / 关系网 / 传承 | 人事、情仇、联姻与继位 |
| 城池纳贡 / 势力外交 | 影响力、纳贡、同盟与敌对 |
| 岁月流转 | 季节推进与结算提示 |
| 天机卷轴 | LLM 交互原型（本地模拟） |
| 通知 / Toast / 模态 | 应用内提示，不使用浏览器原生 alert |

## 设计要点

- 全中文界面（除技术文件名）
- 线性 SVG 图标，无 emoji
- 玻璃拟态、微交互动画、交错入场
- 语义化 HTML + 描述性唯一 ID，便于测试

## 目录

```
src/
  components/   布局、UI、模态
  composables/  状态、Toast、天机
  data/         Mock 数据
  styles/       设计令牌与全局样式
  types/        类型定义
  views/        业务视图
```
