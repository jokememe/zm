# 叙事记忆图谱（方案 C · beta）

## 目标

完整闭环：正文写入 → 节点/边图谱 → 弟子页可见 → 回合前规则选取注入主 API。  
默认**不**依赖纪要 LLM 召回 API。

## 数据模型

- 存储键：`zongmen-memory-graph-v1`（`MEMORY_GRAPH_STORAGE_KEY`）
- 节点 `kind`：`character` | `event` | `item` | `place` | `other`
- 边 `type`：师徒 / 道侣 / 结义 / 仇恨 / 竞争 / 血缘 / 约定 / 人际 / 其他
- 节点可带 `attrs` 与 `beats`（近事）
- 与经营 `relationEdges` **分离**（玩法关系 vs 叙事关系）

## 写入

1. 主 API / 记忆追溯输出 `<Memory>` → `applyAssistantMemoryTags` → 表格记忆  
2. `saveTableMemory` → `notifyTableMemoryWritten` → `syncMemoryGraphFromTableMemory`  
3. 投影来源：
   - `character_profile` → 角色节点 + 人际边  
   - `item_tracking` → 物品节点 + 持有边  
   - `world_setting` → 地点/其它节点  
   - `plot_journal` → 事件节点 + 涉及角色/地点边（最近约 40 条）

## 展示

弟子详情弹窗「叙事记忆」：属性、关系边、近事；注入天机附带图谱短摘要。

## 选取注入

- `selectMemoryGraphForTurn`：点名名册/档案名 + 一跳邻接，字符预算截断  
- `formatTableMemoryInjection`：图谱块 + 实体表 + 索引；（可选）纪要全文  
- `runPreTurnRecall`：默认只跑图谱；`recallEnabled === true` 才走旧纪要选码  

## 生命周期

- 除名：`removeMemoryGraphNodeByName`  
- 开局重置：`clearMemoryGraph`  
- 全量备份：含 `MEMORY_GRAPH_STORAGE_KEY`  

## 可选高级（密匣可开）

- `memoryRecallMode`：`keyword`（默认）| `embedding` | `both`
- embedding：主 API `/embeddings` + IndexedDB 向量；失败静默降级关键词

## 非目标（本期）

- 力导向可视化画布  
- 大总结压缩流水线  
