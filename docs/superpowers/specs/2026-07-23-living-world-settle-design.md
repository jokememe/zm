# 活局面结算设计（2026-07-23）

## 问题

推演叙事与左侧经营 UI 基本脱节：

- 仅 6 项资源可通过主模型 `<vars>` 写回。
- 弟子、城池、势力、灵田等多为 `mock` 静态数据，或不在可写状态内。
- `<sum>` 只进世界书记忆，不驱动名册/外交等页面。

结果：对话里「招收弟子 / 改关系 / 破局」等不会同步到局面，世界「不活」。

## 目标

1. **统一可写局面**：关键实体进入 `useGameState`，各页与系统世界书「实况」读同一真相源。
2. **结算与叙事解耦**：主 API 只负责剧情；局面变更只经 **settle 补丁 + 本地校验** 写入。
3. **尽量不出错**：结构化 ops、对照快照、schema 硬闸、失败不脏写、支持删楼回滚。
4. **可控 token**：次 API 专职 settle；无次 API 时是否用主 API 再结算，由用户选项决定。

## 非目标（本期不做）

- 从自然语言无结构硬抽全量世界（无 settle 任务时的纯 NLP）。
- 灵田逐格、丹方库存、关系网边、时间线完整模拟（第二期挂同一 ops 协议）。
- 多人联机权威服。
- 强制所有用户配置次 API。

## 角色分工

| 角色 | 职责 | 禁止 |
|------|------|------|
| 主 API `story` | `maintext` / `option` / `sum`（及展示用标签） | 不作为局面写入口；`<vars>` 默认不应用 |
| 次 API `settle`（优先） | 根据本回剧情 + 局面快照输出 `WorldDelta` JSON | 不写长文 |
| 主 API `settle`（可选回退） | 次 API 未启用且用户打开「主 API 结算」时，同一 settle 任务 | 同上 |
| 本地引擎 | 校验、应用、快照、世界书刷新、回滚 | 不执行未通过校验的字段 |

**结算权威 = settle 产出的补丁 + `validateWorldDelta`。**  
主模型叙事标签中的 `<vars>` 默认忽略（可保留解析代码，但 `apply` 路径关闭），避免双源冲突。

## 密匣选项（token 与正确率）

新增设置字段（建议挂在 API / 气数相关区），逻辑三态：

| 值 | 行为 |
|----|------|
| `off` | **不跑 settle**。本回局面不变更。最省 token。系统可轻提示「局面结算已关闭」。 |
| `secondary_only` | **仅次 API**。次 API 未启用或失败 → 不写局面，并提示配置/检查次 API。正确率优先、不浪费主模型 token。 |
| `secondary_then_primary`（默认推荐） | 次 API 启用则走次；否则（或次失败且允许回退时）用 **主 API 再调一次 settle**。无次 API 也能活，但多一轮主模型费用。 |

说明：

- 用户明确要求：在 2a（无次 API 用主 API settle）之外 **必须给选项**，避免强制双调用浪费 token。
- `secondary_only` 满足「尽量不出错 + 不白烧主模型」。
- `off` 满足纯聊天/测 API 场景。
- UI 文案示例：
  - 局面结算：关闭 / 仅次通灵 / 次通灵优先，否则主通灵
  - 副文：结算使用短 JSON，建议单独配置较稳的次模型；关闭可节省每次推演的额外调用。

与现有 `createApiRouter` 对齐：`task === 'story' | 'settle'`；`settle` 在次启用时 `targetFor → secondary`，失败策略由上表约束（`secondary_only` 不回退主；`secondary_then_primary` 可回退）。

## 一回合数据流

```
用户发言
  → story（主 API）：叙事标签
  → UI 展示 maintext / options / sum
  → 若 settlementMode === off：结束（仅记忆若仍由 sum 写入，见下）
  → 组装 settle 输入：
       当前局面快照（资源 + 实体摘要/id 表）
       + 本回 user 文本
       + maintext / sum
       + 允许的 ops 与枚举说明（短 schema 说明）
  → settle（次 API 或主 API，视模式）
  → validateWorldDelta
       失败 → 将错误摘要塞回，重试 settle 至多 1 次
       仍失败 → 不应用，系统条「本回局面未变更：…」
  → applyWorldDelta → useGameState
  → 本条 assistant 持久化 stateAfter 快照
  → 刷新系统世界书 live-snapshot（+ 既有记忆条目）
  → 可选系统条「【局面结算】…」摘要
```

记忆：`<sum>` → 短/中/长期记忆逻辑保持；与局面写入独立。sum 失败不影响已成功 apply 的 delta（反之亦然）。

## 局面状态（第一期）

迁入 / 保留在 `useGameState`（或由其持有的单一 `WorldState`）：

| 域 | 内容 | 来源迁移 |
|----|------|----------|
| resources | 六资源 | 已有 |
| calendar / identity | 年季日、宗门、掌门、难度 | 已有（settle 第一期默认只读，除非显式 op） |
| disciples | 名册 | 已有 ref，补全 CRUD |
| factions | 外交势力 | 从 mock 迁入 reactive |
| cities | 城池 | 从 mock 迁入 reactive |
| notifications | 可选 push | 已有，支持 settle 追加 |

第二期再迁：灵田、丹方、关系边、继承人细节等，仍用同一 `ops` 协议扩展。

各 View：改为读 `useGameState`，禁止直接把 mock 当运行时真相（mock 仅作初始种子）。

## WorldDelta 协议

### 形状（概念）

```json
{
  "resources": { "灵石": -30, "声望": 1 },
  "ops": [
    {
      "op": "disciple.add",
      "name": "张三",
      "gender": "男",
      "realm": "炼气一层",
      "role": "外门弟子",
      "status": "在宗"
    },
    {
      "op": "disciple.update",
      "id": "d1",
      "patch": { "loyalty": 80, "status": "外勤" }
    },
    {
      "op": "faction.update",
      "id": "fa1",
      "patch": { "relation": 40, "stance": "敌对", "recent": "矿脉谈判破裂" }
    },
    {
      "op": "city.update",
      "id": "c1",
      "patch": { "attitude": "犹豫", "influence": 55 }
    },
    {
      "op": "notify.push",
      "title": "新弟子入宗",
      "body": "张三拜入外门。"
    }
  ],
  "summary": "收张三入门，与赤焰谷关系恶化"
}
```

- `resources`：键用中文气数名，值绝对数或相对串（与现有 `resolveNumericValue` 一致）。
- `ops`：有序数组；本地按序应用。
- 禁止 settle 输出整本名册替换（降低幻觉与误删）。

### 第一期允许的 op

| op | 校验要点 |
|----|----------|
| `disciple.add` | name 必填；枚举 gender/status；默认 aptitude/loyalty/mood/avatarHue；生成稳定 id |
| `disciple.update` | id 或 name 命中唯一；patch 仅白名单字段 |
| `disciple.remove` | 必须命中；或改为 status=叛离等软删除（推荐软：`status` 更新） |
| `faction.update` | id 或 name 命中；relation 数值钳制；stance 枚举 |
| `city.update` | id 或 name 命中；attitude 枚举；influence 钳制 |
| `notify.push` | title 必填；body 可选；生成 id |

单回上限（防爆）：例如 `ops.length ≤ 12`，`disciple.add ≤ 3`。超限截断或整包失败（实现选 **整包失败更安全** 时在校验说明里写死一种：**超限 → 校验失败并重试说明**）。

### 解析

- 期望 settle 纯 JSON（可包在 \`\`\`json 中，本地剥除）。
- 非法 JSON → 校验失败。
- 未知 op / 未知 patch 键 → 丢弃该键或整条 op 失败；推荐 **未知 op → 该条跳过并记 warning，关键资源仍可应用** 与 **严格模式整包失败** 二选一。  
  **本期采用：严格模式——任一 op 非法则整包不应用**（符合「尽量不出错」；重试时把错误列表回灌）。

## 本地校验与应用

1. `parseSettlePayload(text) → WorldDelta | error`
2. `validateWorldDelta(delta, snapshot) → { ok, errors, warnings }`
   - 资源键白名单
   - 实体引用解析（id 优先，name 唯一匹配；重名 → error）
   - 枚举与数值范围
   - 每回 op 数量上限
3. `applyWorldDelta(delta)` 仅在 ok 时调用；写 `useGameState`；返回人类可读 lines（结算条）
4. `snapshotWorldState()` / `restoreWorldState(snap)` 供删楼、重 roll（扩展现有 `variablesAfter` 为完整局面或并行 `stateAfter`）

回滚：截断会话时恢复保留消息末条的 `stateAfter`；无则回退到 `snapshotGameVariables` + 实体种子策略（开局态），与现有资源回滚行为一致并增强。

## Settle 提示词要点（实现时固化模板）

输入固定块：

- 【当前局面】紧凑列表（资源一行；弟子 id+名+境界+状态；势力 id+名+relation+stance；城池 id+名+attitude）
- 【本回玩家】
- 【本回剧情 maintext】
- 【本回 sum】
- 【规则】只输出 JSON；只记录正文已发生或明确承诺且应立即生效的变更；禁止虚构未出场人物进名册除非正文写明收徒/入宗；无变更时 `{"resources":{},"ops":[],"summary":"无局面变更"}`

温度：建议 ≤ 0.3；`max_tokens` 宜小（如 800–1500）。

## 系统世界书

`buildLiveLoreContent` 扩展：

- 继续资源 + 弟子摘要
- 增加势力/城池一行摘要
- 结算约定改为：说明由系统 settle 写入，**勿在 story 中依赖 `<vars>` 改档**（可写「气数与名册以实况条目为准」）

每回 `callLlm` 前仍 `syncSystemLore`；apply 后再刷一次。

## 与现有代码衔接

| 现有 | 变更 |
|------|------|
| `applyVariablesToGame` | 保留为资源应用内核；由 `applyWorldDelta` 调用 |
| `settleVariables` in useTianji | 改为「仅在 settle 成功后」走资源 + ops；story 后触发 `runSettle` |
| `DEFAULT_FORMAT_PROMPT` | story 侧弱化/移除对 `<vars>` 必填暗示；强调 sum + 正文事实清晰 |
| `api-router` | 真正从 useTianji 调用 `task: 'settle'` |
| mock 导出 | 作 initial seed；运行时 state 在 useGameState |
| 开局 / 重置 | 种子写入 disciples/factions/cities |

## 错误与 UX

- settle 关闭：不打断叙事；可选首次提示。
- settle 失败（校验/网络）：叙事保留；系统条说明未改局面；不部分应用。
- 成功：系统条简短列出变更；名册/外交/城池页即时刷新。
- 气数簿 UI：展示当前局面资源；手改仍只碰资源白名单（或后续只读，本期保持资源可手改并写回 state）。

## 测试要点

- 纯资源相对/绝对应用
- disciple.add 后名册与 live lore 一致
- 非法 id update → 不应用
- 超限 ops → 不应用
- settlementMode=off 无第二请求
- secondary_only 无次 API → 无 apply
- secondary_then_primary 无次 API → 主 API settle 一次
- 删楼恢复 stateAfter
- 开局难度种子势力/城池不丢

## 分阶段实现建议

1. **状态地基**：factions/cities 入 useGameState；Views 改读活状态；snapshot/restore。
2. **Delta 引擎**：类型、parse、validate、apply、单测或脚本测。
3. **Settle 管线**：useTianji 接线 + 密匣三态 + router。
4. **Prompt / 世界书文案** + 结算系统条。
5. **回归**：删楼、重 roll、开局重置、无 API 本地假回复（本地假回复默认不 settle，或固定空 delta）。

## 决策记录

- 用户选方案 A（统一状态 + 结构化结算）。
- 结算权威：只信 settle + 本地校验；主 story 不改状态。
- 无次 API：支持主 API settle（2a），但必须提供密匣选项以免强制浪费 token（`off` / `secondary_only` / `secondary_then_primary`）。
- 严格校验：非法 op → 整包不应用 + 最多重试 1 次。
