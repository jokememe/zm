<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import ModalFrame from '@/components/ui/ModalFrame.vue'
import {
  loadTableMemory,
  saveTableMemory,
  clearTableMemory,
  clearTableRecords,
  countAllRecords,
  getTableRecordCount,
  cleanColumnName,
  addTableRecord,
  deleteTableRecord,
  setTableRecordField,
  type MemoryTableDef,
  type MemoryRecord,
  type TableMemoryState,
} from '@/composables/table-memory'
import { syncTableMemoryFromGame } from '@/composables/table-memory-sync'
import {
  formatShortMemory,
  formatMidMemory,
  formatLongMemory,
  loadMemoryBank,
} from '@/composables/memory-lore'
import { buildTableDefinitionsText, buildTraceRealtimePrompt } from '@/composables/table-memory-prompts'
import {
  buildJournalIndexText,
  formatTableMemoryInjection,
} from '@/composables/table-memory-recall'
import {
  countFineJournalRows,
  listJournalRows,
  checkAutoMergeTrigger,
  localCollapseMerge,
} from '@/composables/table-memory-merge'
import { resolveTableMemoryScheduler } from '@/composables/table-memory-settings'
import { useTianji } from '@/composables/useTianji'
import './st-shared.css'

const emit = defineEmits<{ close: [] }>()
const {
  runManualMemoryTrace,
  memoryTracing,
  lastMemoryTrace,
  lastMemoryTraceKind,
  lastRecallTrace,
  lastRecallTraceKind,
  lastRecallCodes,
  recalling,
  getTableMemorySchedulerStatus,
  settings: tianjiSettings,
} = useTianji()

const state = ref<TableMemoryState>(loadTableMemory())
const tab = ref<'tables' | 'sum' | 'inject' | 'scheme' | 'sched'>('tables')
const activeTableId = ref('character_profile')
const status = ref('')
const selectedRecordId = ref<string | null>(null)

function refresh() {
  state.value = loadTableMemory()
  loadMemoryBank()
  if (!state.value.tables.find((t) => t.id === activeTableId.value)) {
    activeTableId.value = state.value.tables[0]?.id || 'character_profile'
  }
}

onMounted(() => {
  refresh()
  // 打开时若表空，自动从经营灌底表，避免「打开是空的」
  if (countAllRecords(state.value) === 0) {
    try {
      const r = syncTableMemoryFromGame()
      state.value = r.state
      status.value = `已自动同步经营数据（${r.total} 行）`
    } catch {
      /* ignore */
    }
  }
})

const activeTable = computed(
  (): MemoryTableDef | null =>
    state.value.tables.find((t) => t.id === activeTableId.value) || null,
)

const rows = computed((): MemoryRecord[] => {
  const id = activeTableId.value
  return state.value.records[id] || []
})

const selected = computed(() =>
  rows.value.find((r) => r.id === selectedRecordId.value) || null,
)

const columnNames = computed(() =>
  (activeTable.value?.columns || []).map((c) => cleanColumnName(c)),
)

const total = computed(() => countAllRecords(state.value))

const injectionPreview = computed(() =>
  formatTableMemoryInjection({
    state: state.value,
    scheduler: resolveTableMemoryScheduler(tianjiSettings.value),
  }),
)
const indexPreview = computed(() =>
  buildJournalIndexText(state.value, {
    maxEntries: resolveTableMemoryScheduler(tianjiSettings.value).recallIndexTop,
  }),
)
const schemaPreview = computed(() => buildTableDefinitionsText(state.value))
const tracePromptPreview = computed(() => buildTraceRealtimePrompt(state.value))
const tracing = computed(() => memoryTracing.value)
const schedStatus = computed(() => {
  try {
    return getTableMemorySchedulerStatus()
  } catch {
    return null
  }
})
const journalFine = computed(() => countFineJournalRows(state.value))
const journalTotal = computed(() => listJournalRows(state.value).length)

function onLocalMerge() {
  const sch = resolveTableMemoryScheduler(tianjiSettings.value)
  const trigger = checkAutoMergeTrigger(state.value, sch)
  if (!trigger.shouldMerge && journalFine.value < 2) {
    status.value = '细纪要不足，无需合并'
    return
  }
  const mergeCount = trigger.shouldMerge
    ? trigger.mergeCount
    : Math.max(2, Math.floor(journalFine.value / 2))
  const r = localCollapseMerge(state.value, {
    startFineIndex: 0,
    endFineIndex: mergeCount,
  })
  saveTableMemory(state.value)
  refresh()
  status.value = `本地合并：删细行 ${r.removed}，加粗行 ${r.added}`
}

const sumShort = computed(() => {
  loadMemoryBank()
  return formatShortMemory()
})
const sumMid = computed(() => formatMidMemory())
const sumLong = computed(() => formatLongMemory())

function selectTable(id: string) {
  activeTableId.value = id
  selectedRecordId.value = null
  status.value = ''
}

function selectRow(id: string) {
  selectedRecordId.value = id
}

function onSyncGame() {
  const r = syncTableMemoryFromGame()
  state.value = r.state
  status.value = `已从经营同步：角色 ${r.counts.characters} · 物品 ${r.counts.items} · 设定 ${r.counts.world}（共 ${r.total} 行）`
  if (!selectedRecordId.value && rows.value[0]) {
    selectedRecordId.value = rows.value[0].id
  }
}

function onClearAll() {
  if (!confirm('清空全部表格记忆？（短中长期 <sum> 记忆不受影响）')) return
  clearTableMemory()
  state.value = loadTableMemory()
  selectedRecordId.value = null
  status.value = '表格记忆已清空'
}

async function onTraceNow() {
  status.value = '追溯任务请求中…'
  const r = await runManualMemoryTrace()
  status.value = r.message
  refresh()
}

function onClearTable() {
  const t = activeTable.value
  if (!t) return
  if (!confirm(`清空「${t.name}」全部行？`)) return
  clearTableRecords(t.id, state.value)
  saveTableMemory(state.value)
  state.value = loadTableMemory()
  selectedRecordId.value = null
  status.value = `已清空 ${t.name}`
}

/** 长文本列用 textarea（纪要/说明等） */
function isLongField(col: string): boolean {
  return /纪要|详细|描述|说明|内容|主线|支线|备注|性格|人际关系/.test(col)
}

function updateField(col: string, value: string) {
  const rec = selected.value
  const tableId = activeTableId.value
  if (!rec || !tableId) return
  setTableRecordField(tableId, rec.id, col, value, state.value)
  saveTableMemory(state.value)
  // 保持选中：重新 load 后 id 不变
  const keep = rec.id
  state.value = loadTableMemory()
  selectedRecordId.value = keep
}

function onAddRow() {
  const tableId = activeTableId.value
  if (!tableId) return
  const rec = addTableRecord(tableId, {}, state.value)
  if (!rec) {
    status.value = '无法新增行'
    return
  }
  saveTableMemory(state.value)
  state.value = loadTableMemory()
  selectedRecordId.value = rec.id
  status.value = `已新增一行（可在右侧改字段）`
}

function onDeleteRow() {
  const rec = selected.value
  const tableId = activeTableId.value
  if (!rec || !tableId) return
  const label = primaryOf(rec)
  if (!confirm(`删除「${label}」这一行？`)) return
  deleteTableRecord(tableId, rec.id, state.value)
  saveTableMemory(state.value)
  state.value = loadTableMemory()
  selectedRecordId.value = rows.value[0]?.id || null
  status.value = `已删除 ${label}`
}

function primaryOf(rec: MemoryRecord): string {
  const cols = columnNames.value
  if (!cols.length) return rec.id
  return String(rec.values[cols[0]] || rec.id)
}

function rowBrief(rec: MemoryRecord): string {
  const cols = columnNames.value.slice(1, 4)
  return cols
    .map((c) => {
      const v = String(rec.values[c] || '').trim()
      if (!v) return ''
      const short = v.length > 36 ? v.slice(0, 36) + '…' : v
      return `${c}:${short}`
    })
    .filter(Boolean)
    .join(' · ')
}
</script>

<template>
  <ModalFrame
    id="modal-table-memory"
    title="记忆锦囊"
    subtitle="表格世界状态 · 与短中长期小结并存"
    width="820px"
    @close="emit('close')"
  >
    <div class="mem">
      <div class="mem__tabs">
        <button
          type="button"
          class="mem__tab"
          :class="{ active: tab === 'tables' }"
          @click="tab = 'tables'"
        >
          表格记忆
          <small>{{ total }}</small>
        </button>
        <button
          type="button"
          class="mem__tab"
          :class="{ active: tab === 'sum' }"
          @click="tab = 'sum'"
        >
          短中长期
        </button>
        <button
          type="button"
          class="mem__tab"
          :class="{ active: tab === 'inject' }"
          @click="tab = 'inject'"
        >
          注入预览
        </button>
        <button
          type="button"
          class="mem__tab"
          :class="{ active: tab === 'scheme' }"
          @click="tab = 'scheme'"
        >
          追溯契约
        </button>
        <button
          type="button"
          class="mem__tab"
          :class="{ active: tab === 'sched' }"
          @click="tab = 'sched'"
        >
          调度/纪要
          <small>{{ journalFine }}/{{ journalTotal }}</small>
        </button>
      </div>

      <p v-if="status" class="mem__status">{{ status }}</p>
      <p
        v-if="lastMemoryTrace"
        class="mem__status"
        :class="{
          'mem__status--ok': lastMemoryTraceKind === 'ok',
          'mem__status--fail': lastMemoryTraceKind === 'fail',
        }"
      >
        最近追溯：{{ lastMemoryTrace }}
      </p>
      <p
        v-if="recalling || lastRecallTrace"
        class="mem__status"
        :class="{
          'mem__status--ok': lastRecallTraceKind === 'ok',
          'mem__status--fail': lastRecallTraceKind === 'fail',
        }"
      >
        <template v-if="recalling">发话前召回选码中…</template>
        <template v-else>
          最近召回：{{ lastRecallTrace }}
          <span v-if="lastRecallCodes?.length">
            （{{ lastRecallCodes.slice(0, 12).join(', ')
            }}{{ lastRecallCodes.length > 12 ? '…' : '' }}）
          </span>
        </template>
      </p>

      <template v-if="tab === 'tables'">
        <div class="mem__toolbar">
          <button type="button" class="btn btn-primary btn-sm" @click="onSyncGame">
            从经营同步
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            :disabled="tracing"
            @click="onTraceNow"
          >
            {{ tracing ? '流水线…' : '跑完整流水线' }}
          </button>
          <button type="button" class="btn btn-ghost btn-sm" @click="onLocalMerge">
            本地合并纪要
          </button>
          <button type="button" class="btn btn-soft btn-sm" @click="onAddRow">
            ＋ 新增行
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            :disabled="!selected"
            @click="onDeleteRow"
          >
            删除本行
          </button>
          <button type="button" class="btn btn-ghost btn-sm" @click="onClearTable">
            清空本表
          </button>
          <button type="button" class="btn btn-ghost btn-sm" @click="onClearAll">
            清空全部表
          </button>
          <span class="mem__hint">
            右侧可直接改字段（失焦保存）。纪要由记忆 API 按全文写；失败会自动重试一次。
          </span>
        </div>

        <div class="mem__body">
          <aside class="mem__tables">
            <button
              v-for="t in state.tables"
              :key="t.id"
              type="button"
              class="mem__table-btn"
              :class="{ active: t.id === activeTableId }"
              @click="selectTable(t.id)"
            >
              <span>{{ t.name }}</span>
              <small>{{ getTableRecordCount(t.id, state) }}</small>
            </button>
          </aside>

          <div class="mem__list">
            <div class="mem__list-head">
              <span>{{ activeTable?.name || '表' }} · {{ rows.length }} 行</span>
              <button type="button" class="btn btn-ghost btn-sm" @click="onAddRow">
                ＋
              </button>
            </div>
            <p v-if="!rows.length" class="mem__empty">
              本表暂无数据。可「新增行」手改，或「从经营同步」/等记忆 API 填表。
            </p>
            <button
              v-for="r in rows"
              :key="r.id"
              type="button"
              class="mem__row"
              :class="{ active: r.id === selectedRecordId }"
              @click="selectRow(r.id)"
            >
              <strong>{{ primaryOf(r) }}</strong>
              <span>{{ rowBrief(r) }}</span>
            </button>
          </div>

          <div class="mem__detail">
            <template v-if="selected && activeTable">
              <div class="mem__detail-head">
                <h4>{{ primaryOf(selected) }}</h4>
                <button
                  type="button"
                  class="btn btn-ghost btn-sm mem__danger"
                  @click="onDeleteRow"
                >
                  删除
                </button>
              </div>
              <p class="mem__edit-hint">编辑后失焦即保存到本地表格记忆</p>
              <label v-for="col in columnNames" :key="col" class="mem__field">
                <span>{{ col }}</span>
                <textarea
                  v-if="isLongField(col)"
                  class="mem__textarea"
                  :value="selected.values[col] || ''"
                  rows="6"
                  @change="
                    updateField(col, ($event.target as HTMLTextAreaElement).value)
                  "
                />
                <input
                  v-else
                  :value="selected.values[col] || ''"
                  type="text"
                  @change="
                    updateField(col, ($event.target as HTMLInputElement).value)
                  "
                />
              </label>
            </template>
            <p v-else class="mem__empty">
              选择左侧一行编辑，或点「＋ 新增行」。
            </p>
          </div>
        </div>
      </template>

      <template v-else-if="tab === 'sum'">
        <div class="mem__sum">
          <section>
            <h4>短期</h4>
            <pre>{{ sumShort }}</pre>
          </section>
          <section>
            <h4>中期</h4>
            <pre>{{ sumMid }}</pre>
          </section>
          <section>
            <h4>长期</h4>
            <pre>{{ sumLong }}</pre>
          </section>
        </div>
      </template>

      <template v-else-if="tab === 'inject'">
        <p class="mem__hint">
          注入 = 实体表 + 纪要索引 + Top-K 召回全文（对齐 shujuku，非整表硬截断）。
        </p>
        <h4 class="mem__h4">完整注入预览</h4>
        <pre class="mem__inject">{{ injectionPreview }}</pre>
        <h4 class="mem__h4">纪要索引（轻量）</h4>
        <pre class="mem__inject">{{ indexPreview }}</pre>
      </template>

      <template v-else-if="tab === 'sched'">
        <p class="mem__hint">
          此处只读当前进度。改数字请到密匣 →「显示」→「表格记忆 · 何时填表 / 纪要合并 / 索引召回」。
        </p>
        <div class="mem__sum" v-if="schedStatus">
          <section>
            <h4>楼层进度</h4>
            <pre>当前 AI 回复总层数：{{ schedStatus.totalAiFloors }}
上次成功填表停在第：{{ schedStatus.lastUpdatedAiFloor }} 层
按频率估算下次可触发：第 {{ schedStatus.nextTriggerFloor }} 层
有效尚未记入的层数：{{ schedStatus.effectiveUnrecorded }}
本轮是否应自动填表：{{ schedStatus.shouldUpdate ? '是' : '否' }}
（原因码：{{ schedStatus.reason }}）

— 当前调度参数 —
上下文读深：最近 {{ schedStatus.autoUpdateThreshold }} 条 AI 楼
填表频率：每 {{ schedStatus.autoUpdateFrequency }} 层一次（0=关自动）
每批处理：{{ schedStatus.updateBatchSize }} 层
跳过最近未定：{{ schedStatus.skipUpdateFloors }} 层
填表标记保留：{{ schedStatus.retainRecentLayers }}（0=不清理）</pre>
          </section>
          <section>
            <h4>情节纪要</h4>
            <pre>细行（未合并）：{{ journalFine }}
纪要总行：{{ journalTotal }}
细行达到 {{ schedStatus.autoMergeThreshold }} 条时触发合并
合并时留下最近细行：{{ schedStatus.autoMergeReserve }} 条
推演注入：索引最多 {{ schedStatus.recallIndexTop }} 条 · 全文召回 Top-{{ schedStatus.recallTopK }}</pre>
          </section>
        </div>
        <p v-else class="mem__empty">调度状态不可用</p>
        <h4 class="mem__h4">纪要行一览</h4>
        <pre class="mem__inject">{{
          listJournalRows(state)
            .map(
              (r) =>
                `${r.isAutoMerged ? '[AM]' : '[J]'} ${r.indexCode} | ${r.summary || r.body.slice(0, 40)}`,
            )
            .join('\n') || '(空)'
        }}</pre>
      </template>

      <template v-else>
        <p class="mem__hint">
          实体表沿 yuzuki；纪要表/合并对齐 shujuku mov5.5（客观流水 + AM 合并）。
        </p>
        <h4 class="mem__h4">数据库结构定义</h4>
        <pre class="mem__inject">{{ schemaPreview }}</pre>
        <h4 class="mem__h4">追溯提示词（摘要）</h4>
        <pre class="mem__inject">{{ tracePromptPreview }}</pre>
      </template>
    </div>

    <template #footer>
      <button type="button" class="btn btn-ghost" @click="emit('close')">关闭</button>
      <button
        type="button"
        class="btn btn-primary"
        :disabled="tracing"
        @click="onTraceNow"
      >
        {{ tracing ? '流水线…' : '跑完整流水线' }}
      </button>
    </template>
  </ModalFrame>
</template>

<style scoped>
.mem {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  min-height: 420px;
}
.mem__tabs {
  display: flex;
  gap: 0.35rem;
  flex-wrap: wrap;
}
.mem__tab {
  border: 1px solid var(--border, #3a3a42);
  background: transparent;
  color: inherit;
  border-radius: 999px;
  padding: 0.25rem 0.75rem;
  cursor: pointer;
  font-size: 0.85rem;
}
.mem__tab.active {
  background: var(--jade-soft, rgba(80, 160, 120, 0.18));
  border-color: var(--jade, #5a9);
  color: var(--jade, #5a9);
}
.mem__tab small {
  margin-left: 0.35rem;
  opacity: 0.75;
}
.mem__status {
  margin: 0;
  font-size: 0.8rem;
  color: var(--jade, #5a9);
}
.mem__status--ok {
  color: var(--jade, #3a8);
}
.mem__status--fail {
  color: #a33;
}
.mem__h4 {
  margin: 0.5rem 0 0.25rem;
  font-size: 0.85rem;
  color: var(--jade, #5a9);
}
.mem__toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: center;
}
.mem__hint {
  font-size: 0.75rem;
  opacity: 0.7;
  flex: 1 1 12rem;
}
.mem__body {
  display: grid;
  grid-template-columns: 7.5rem 1fr 1.1fr;
  gap: 0.5rem;
  min-height: 320px;
}
@media (max-width: 720px) {
  .mem__body {
    grid-template-columns: 1fr;
  }
}
.mem__tables {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.mem__table-btn {
  display: flex;
  justify-content: space-between;
  gap: 0.35rem;
  text-align: left;
  border: 1px solid transparent;
  background: rgba(255, 255, 255, 0.03);
  color: inherit;
  border-radius: 6px;
  padding: 0.4rem 0.45rem;
  cursor: pointer;
  font-size: 0.8rem;
}
.mem__table-btn.active {
  border-color: var(--jade, #5a9);
  background: var(--jade-soft, rgba(80, 160, 120, 0.12));
}
.mem__list {
  border: 1px solid var(--border, #3a3a42);
  border-radius: 8px;
  overflow: auto;
  max-height: 360px;
  padding: 0.25rem;
}
.mem__list-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.25rem 0.4rem 0.35rem;
  font-size: 0.75rem;
  opacity: 0.8;
  border-bottom: 1px solid var(--border, #3a3a42);
  margin-bottom: 0.2rem;
}
.mem__detail-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}
.mem__detail-head h4 {
  margin: 0;
}
.mem__edit-hint {
  margin: 0 0 0.5rem;
  font-size: 0.7rem;
  opacity: 0.65;
}
.mem__danger {
  color: #c66 !important;
}
.mem__textarea {
  border: 1px solid var(--border, #3a3a42);
  background: rgba(0, 0, 0, 0.2);
  color: inherit;
  border-radius: 4px;
  padding: 0.35rem 0.45rem;
  font-size: 0.82rem;
  line-height: 1.4;
  resize: vertical;
  min-height: 5.5rem;
  font-family: inherit;
}
.mem__row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  border: none;
  background: transparent;
  color: inherit;
  text-align: left;
  padding: 0.45rem 0.5rem;
  border-radius: 6px;
  cursor: pointer;
  gap: 0.15rem;
}
.mem__row:hover,
.mem__row.active {
  background: rgba(255, 255, 255, 0.06);
}
.mem__row strong {
  font-size: 0.88rem;
}
.mem__row span {
  font-size: 0.72rem;
  opacity: 0.7;
  line-height: 1.3;
}
.mem__detail {
  border: 1px solid var(--border, #3a3a42);
  border-radius: 8px;
  padding: 0.55rem 0.65rem;
  overflow: auto;
  max-height: 360px;
}
.mem__detail h4 {
  margin: 0 0 0.5rem;
  font-size: 0.95rem;
}
.mem__field {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  margin-bottom: 0.4rem;
  font-size: 0.75rem;
  opacity: 0.95;
}
.mem__field input {
  border: 1px solid var(--border, #3a3a42);
  background: rgba(0, 0, 0, 0.2);
  color: inherit;
  border-radius: 4px;
  padding: 0.3rem 0.4rem;
  font-size: 0.82rem;
}
.mem__empty {
  margin: 0.75rem;
  font-size: 0.82rem;
  opacity: 0.65;
  line-height: 1.45;
}
.mem__sum {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.mem__sum h4 {
  margin: 0 0 0.25rem;
  font-size: 0.85rem;
  color: var(--jade, #5a9);
}
.mem__sum pre,
.mem__inject {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.78rem;
  line-height: 1.45;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  padding: 0.65rem 0.75rem;
  max-height: 420px;
  overflow: auto;
}
</style>
