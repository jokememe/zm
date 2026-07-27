# 记忆系统清理方案：移除填表、图谱独立

> 日期：2026-07-27
> 状态：**方案评审中（未执行）**
> 目标：把"填表记忆系统（yuzuki 风格 table-memory）"整体移除，让"角色记忆图谱 + 三期记忆"成为唯一防失忆路径，消除两套系统互投影造成的杂糅。

---

## 一、诊断结论（为什么是一坨）

当前"记忆"相关有 **5 套概念交织**，其中 3 套有效、2 套是死链路：

| 模块 | 作用 | 是否真正喂给 AI | 去留 |
|------|------|----------------|------|
| `memory-lore`（short/mid/long） | 三期记忆 | ✅ 世界书 `MEM_SHORT/MID/LONG_ID` 注入 | **保留** |
| `memory-graph` | 角色叙事图谱（节点+边+近事+冷档案闪回） | ✅ 世界书 `MEM_GRAPH_ID` 注入 | **保留（解耦）** |
| `memory-embed` | 语义向量召回 | ✅ `semanticHits` 补进图谱块 | **保留** |
| `memory-archive` | 冷档案全量 beats | ✅ 被图谱闪回引用 | **保留** |
| `table-memory` (+14 个子文件) | yuzuki 风格填表 | ❌ **死链路** | **移除** |

### 填表已是死链路的关键证据

1. `src/composables/system-lorebook.ts` 的 `buildSystemEntries`：
   - `tableMemoryEnabled` 参数**被接收但从未使用**；
   - `LEGACY_TABLE_ENTRY_IDS = {'table-world-state','table-memory-recall'}` 被**显式剔除，不再注入**；
   - 实际写入世界书的只有：live 快照、三期记忆、角色图谱 `selectMemoryGraphForTurn`。
2. `formatWorldStateInjection` / `formatTableMemoryInjection` 仍会计算，但**结果不再进入任何世界书 entry**（只有 UI 预览用）。
3. 填表**唯一活着**的副作用：`bindAfterTableMemoryWrite → syncMemoryGraphFromTableMemory → projectCharacterProfilesToGraph`，把角色档案/物品/世界设定/纪要表**投影进同一个叙事图谱**——这就是"什么填表都杂糅在记忆图谱里"的直接原因。

### 之前的半成品

`table-memory-sync.test.ts` / `table-memory-hooks.test.ts` 里已写明断言：
> "记忆 UI 入口是角色图谱，不再挂表格 MemoryModal"
> "TianjiPanel 记忆入口跳角色记忆图谱，不挂表格 MemoryModal"

说明**上一轮已经把 UI 入口换掉了，但底层填表代码（14 个文件 + 投影逻辑）没删**，形成"前端看不到了、后端还在跑还在污染图谱"的夹生状态。

---

## 二、清理后的目标架构

```
推演 → 系统世界书（constant 常驻）
  ├─ 局面快照（live）
  ├─ 短期 / 中期 / 长期记忆（memory-lore）
  └─ 角色记忆图谱（memory-graph）
        ├─ 热层：节点 + 边 + 近事 beats（<memory> 标签生长）
        └─ 冷层：memory-archive 全量 + memory-embed 语义闪回
```

- 图谱**只由 `<memory>` 标签生长**（`ingestMemoryTag`），不再从任何表格投影。
- 移除"从表格刷新"按钮及其全部依赖。
- 填表相关 UI（MemoryModal、设置开关）整体移除。

---

## 三、移除清单（先归档到 `_deprecated/`，确认无碍后再删）

### 3.1 删除的文件（归档后删除）
- `src/composables/table-memory.ts`
- `src/composables/table-memory-settings.ts`
- `src/composables/table-memory-sync.ts`
- `src/composables/table-memory-trace.ts`
- `src/composables/table-memory-recall.ts`
- `src/composables/table-memory-prompts.ts`
- `src/composables/table-memory-pipeline.ts`
- `src/composables/table-memory-merge.ts`
- `src/composables/table-memory-scheduler.ts`
- 及对应测试：`table-memory*.test.ts`（7 个）
- `src/components/SillyTavern/MemoryModal.vue`
- 测试引用：`src/composables/memory-graph.test.ts` 中 `projectCharacterProfilesToGraph` 相关用例需重写（见 3.3）

### 3.2 解耦 `memory-graph.ts`（保留文件，但剥离填表）
- 删除模块顶部的 `bindAfterTableMemoryWrite(... syncMemoryGraphFromTableMemory ...)`。
- 删除 `import` 自 `table-memory` 的全部符号（`bindAfterTableMemoryWrite`/`cleanColumnName`/`loadTableMemory`/`normalizeName` 等；注意 `normalizeName` 图谱自己也有定义，需确认无重复后保留本地版）。
- 删除 `projectCharacterProfilesToGraph`（约 140 行，纯填表投影）。
- 删除 `syncMemoryGraphFromTableMemory` / `ensureMemoryGraphHydrated` 中的"表格存在则全量投影"兜底分支：
  - 新语义：`ensureMemoryGraphHydrated()` 在无节点时**保持空图**（不再偷偷读表格补种）；
  - 旧存档（节点在、近事 0）的"再投影一次种档案字段"逻辑移除。
- 保留：`ingestMemoryTag` / `getMemoryGraphSlice` / `selectMemoryGraphForTurn` / `formatNodeBlock` / 持久化 / `removeMemoryGraphNodeByName` 等。

### 3.3 调用方清理
| 文件 | 改动 |
|------|------|
| `src/composables/useTianji.ts` | 移除 `syncTableMemoryFromGame` 调用（~L678、~L1784）、`import table-memory`；《memory》标签摄入保留（`ingestMemoryTag` 属 memory-graph，不动） |
| `src/composables/useGameState.ts` | 移除 `seedOpeningTableMemory()` + `syncTableMemoryFromGame()`（~L782-783）；移除删角色时的"表格档案同名行"逻辑（~L841-856）；`resetGameToOpening` 移除 `clearTableMemory()` |
| `src/composables/world-state.ts` | 移除改名时同步表格档案块（~L133-146，含 `loadTableMemory`/`renameCharacterProfileRow`/`saveTableMemory`）——改名只走图谱 `removeMemoryGraphNodeByName` 或新增图谱改名接口 |
| `src/composables/full-backup.ts` | 移除 `loadTableMemory`、`TABLE_MEMORY_STORAGE_KEY` 备份项 |
| `src/composables/system-lorebook.ts` | `buildSystemEntries` / `ensureAndRefreshSystemLorebook` 的 `tableMemoryEnabled` 参数移除；`LEGACY_TABLE_ENTRY_IDS` 常量可删 |
| `src/data/opening.ts` | 删除 `TABLE_MEMORY_STORAGE_KEY` 常量 |
| `src/components/SillyTavern/SettingsModal.vue` | 移除填表设置区（`tableMemoryEnabled` 开关、调度设置，~L17-220、~L1179-1188）；`import table-memory-settings` 移除 |
| `src/views/MemoryGraphView.vue` | 移除"从表格刷新"按钮（`syncFromTables`，~L124-134、~L218-220）；空态文案去掉"从表格刷新"提示；`stats.extras`（物/地/事）因不再由表格投影，仅保留由 `<memory>` 显式写入的 event/item/place 节点展示 |
| `src/components/modals/ModalHost.vue` | 弟子详情内的"角色记忆"面板（~L336-388）**保留**（这是图谱功能，非填表）；仅把文案"也可在「角色记忆」从表格刷新"改掉 |

### 3.4 测试重写
- `memory-graph.test.ts`：`projectCharacterProfilesToGraph` 用例改为直接构造 `MemoryGraphState` 验证 `applyMemoryGraphPatch` / `ingestMemoryTag` / `selectMemoryGraphForTurn`。
- `table-memory-sync.test.ts`、`table-memory-hooks.test.ts`：整体随源文件移除（原断言"不再挂表格 MemoryModal"已达成，并入本方案验收）。
- 其余测试若 import 了 `table-memory*`，逐一改为只依赖 `memory-graph` / `memory-lore`。

---

## 四、执行步骤（顺序）

1. 新建 `src/_deprecated/`（或仓库根 `_deprecated/`），把 3.1 列出的文件整体移入，提交一个 "archive table-memory" commit。
2. 解耦 `memory-graph.ts`（3.2）。
3. 逐个清理调用方（3.3），每改一处确认 `import` 无悬空。
4. 重写测试（3.4）。
5. 跑 `npm run test` + `npm run build`（vue-tsc 类型检查）确认全绿。
6. 人工验证：开局 → 通灵写 `<memory>陆承渊|闭关破境` → 系统世界书 `MEM_GRAPH_ID` 出现该近事；`MemoryModal` 不再出现；设置里无填表开关。
7. 确认无回归后，删除 `src/_deprecated/` 目录，提交 "remove table-memory system"。

---

## 五、风险与回滚

- **风险 A**：`normalizeName` 在 `table-memory` 与 `memory-graph` 各有一份，解耦时需确认图谱保留的是自己的版本，避免删错。
- **风险 B**：`world-state.ts` 改名逻辑去掉表格同步后，若未来要"经营名册改名 → 图谱改名"需新增显式桥接（本方案暂用 `removeMemoryGraphNodeByName` 兜底，旧节点近事会丢；如需保留需新增 `renameMemoryGraphNode`）。
- **回滚**：因先归档到 `_deprecated/`，任何一步出错可直接从归档恢复，再 `git revert` 对应 commit。

---

## 六、验收标准

- [x] 全仓 `grep -r "table-memory" src` 零结果（除已删除的 `_deprecated/`，现已整体删除）。
- [x] `npm run test` 全绿（262 passed / 20 files）。
- [x] `npm run build` 类型检查通过（`vue-tsc` exit 0）+ `vite build` 成功（143 模块）。
- [x] 角色记忆图谱仅由 `<memory>` 标签生长（`ingestMemoryTag`），UI 无"从表格刷新"。
- [x] 系统世界书注入链只剩：live + 三期 + 图谱（含语义闪回）。
- [x] 填表设置开关、MemoryModal 从前端消失。

---

## 七、执行记录（2026-07-27 已完成）

### 实际改动清单
1. **归档并删除** `src/_deprecated/`：`table-memory.ts`(+settings/sync/trace/recall/prompts/pipeline/merge/scheduler)、7 个 `table-memory*.test.ts`、`MemoryModal.vue`。
2. **`memory-graph.ts` 解耦**：移除 `import` 自 `table-memory` 的全部符号；补本地 `normalizeName`/`cleanColumnName`；删除 `bindAfterTableMemoryWrite` 绑定；删除 `projectCharacterProfilesToGraph`、`primaryNameFromRecord`、`parseRelationField`、`PROFILE_ATTR_KEYS`、`syncMemoryGraphFromTableMemory`；`ensureMemoryGraphHydrated` 改为仅 `loadMemoryGraph()`。
3. **新建 `memory-tag.ts`**：从归档提取轻量 `hasMemoryTag`（仅检测，不写填表）。
4. **`useTianji.ts`**：移除全部 `table-memory` import；`applyAssistantMemoryTags` 摄入调用删除（图谱走 `ingestMemoryTag`）；删除 `syncTableMemoryFromGame`、`runPreTurnRecall` 守卫、`runTableMemoryPipeline` 两处调用、填表格式 hint、开局填表同步；`runManualMemoryTrace` 改为空操作（保留签名）。
5. **`useGameState.ts`**：移除填表 import；删 `seedOpeningTableMemory`/`syncTableMemoryFromGame`、除名时的填表同名行清理、`resetGameToOpening` 的 `clearTableMemory`。
6. **`world-state.ts`**：移除改名时的表格档案同步块（及 `nameBefore`）。
7. **`full-backup.ts`**：移除 `loadTableMemory` 与 `TABLE_MEMORY_STORAGE_KEY` 备份键。
8. **`system-lorebook.ts`**：移除 `tableMemoryEnabled` 参数与 `LEGACY_TABLE_ENTRY_IDS`。
9. **`data/opening.ts`**：删除 `TABLE_MEMORY_STORAGE_KEY` 常量。
10. **`SettingsModal.vue`**：移除 `table-memory-settings` import、`sched`/`patchSched`、`后台填表`开关、`后台填表·何时写表`面板、`情节纪要·自动合并`面板；保留"推演时注入·角色记忆图谱"面板（图谱召回模式）。
11. **`MemoryGraphView.vue`**：移除"从表格刷新"按钮/函数/import，更新空态文案；移除未用 `loadMemoryGraph`/`refresh`。
12. **`ModalHost.vue`**：更新弟子详情空态文案（去"从表格刷新"）。
13. **测试**：重写 `memory-graph.test.ts`（删 `projectCharacterProfilesToGraph`/`parseRelationField`/`applyAssistantMemoryTags` 用例，新增 `ingestMemoryTag` 生长路径用例）；`vitest.config.ts` + `tsconfig.app.json` 排除 `_deprecated`。

### 已知保留项（向后兼容，非功能缺陷）
- `AppSettings.tableMemoryEnabled` / `tableMemoryScheduler` / `sillytavern/types.ts` / `database.ts` 中的 schema 字段**保留未删**（旧存档兼容）。`useTianji.ts` L367 的默认值注入保留（无害）。这些字段已无任何读取方。

### 风险 B 落实说明
- 角色改名后，旧名图谱节点不再自动迁移（原 `renameCharacterProfileRow` 已随填表删除）。当前行为：改名不迁移旧节点近事，下次 `<memory>` 会建新节点；除名走 `removeMemoryGraphNodeByName` 清理。属可接受限制（方案文档已记录）。

---

## 八、二次深挖：空壳召回砍除 + 改名同步（2026-07-27 同日完成）

### 新诊断（比一审更狠）
1. **`memory-embed` 是双重死链**：写入侧复用主 `api.model`（聊天模型）打 `/embeddings` 必然 400；读取侧 `recallQuery`/`contextLabel` 无任何赋值方，`semanticRecall` 永不执行。且项目无任何 embedding 专用配置入口。→ **整体砍除**（推翻一审"保留"结论）。
2. **`api.memory` / `api.recall` 旁路通道是僵尸**：`settle-runner` 只走 primary/secondary；密匣 template 无对应面板，script 侧草稿/flush/模型拉取全为死代码；`resolveRecallApiEndpoint` 仅测试引用。→ **字段与代码一并删除**。
3. **表格记忆文案残留**：`MemoryGraphView` 详情空态、`DisciplesView`/`ModalHost` 除名确认框仍提"表格记忆/从表格刷新"。→ **清零**。
4. **改名不同步图谱**：掌门改名（密匣「掌门称谓」）只改 `userName`，与游戏态 `masterName` 分叉，图谱留旧名节点；弟子改名（world-delta）不迁移图谱节点（原风险 B）。→ **均已接通**。

### 改动清单
1. **删除**：`memory-embed.ts`、`api-cache-recall.test.ts`、`resolveRecallApiEndpoint`/`sideChannelReady`（api-cache.ts）、`memoryRecallMode` 字段与密匣"图谱召回模式"面板、`api.memory`/`api.recall` 通道（types/database/api-cache/useSillytavern/useTianji/SettingsModal 全部 merge 与草稿代码）。
2. **掌门改名**：`memory-graph.ts` 新增 `renameMemoryGraphNode`（formerName 合并，近事/属性/关系保留，边按 node.id 不断）；`useGameState.ts` 新增 `renameMaster`（masterName/弟子师承/宝物持有/关系边/图谱/身份落盘）；`useTianji.updateSettings` 检测 userName 变化自动调用；`OpeningOverlay` 开局时 userName 自动对齐掌门名。
3. **弟子改名**：`ApplyResult` 新增 `renames`；`applyWorldDeltaToSnapshot` 收集改名对；`applyValidatedDelta` 消费并调 `renameMemoryGraphNode`。
4. **文案/注释**：三处 UI 文案与各处"表格记忆"注释清零；废弃字段（`tableMemoryEnabled`/`tableMemoryScheduler`）注释标明"仅兼容旧存档，无读取方"。
5. **测试**：`memory-graph.test.ts` +2（renameMemoryGraphNode）；`world-delta.test.ts` +renames 断言。**261 测试全绿，`vue-tsc` exit 0，`vite build` 通过**。
