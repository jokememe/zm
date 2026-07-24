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

function updateField(col: string, value: string) {
  const rec = selected.value
  if (!rec) return
  rec.values = { ...rec.values, [col]: value }
  saveTableMemory(state.value)
  state.value = loadTableMemory()
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
      return v ? `${c}:${v}` : ''
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
          <button type="button" class="btn btn-ghost btn-sm" @click="onClearTable">
            清空本表
          </button>
          <button type="button" class="btn btn-ghost btn-sm" @click="onClearAll">
            清空全部表
          </button>
          <span class="mem__hint">
            对齐 shujuku：楼层调度 → 填表 → 纪要合并(auto_merged) → 索引 Top-K 注入。次 API 只做 settle。
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
            <p v-if="!rows.length" class="mem__empty">
              本表暂无数据。点「从经营同步」写入弟子/宝物/势力，或等推演产出
              &lt;Memory&gt;。
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
              <h4>{{ primaryOf(selected) }}</h4>
              <label v-for="col in columnNames" :key="col" class="mem__field">
                <span>{{ col }}</span>
                <input
                  :value="selected.values[col] || ''"
                  type="text"
                  @change="
                    updateField(col, ($event.target as HTMLInputElement).value)
                  "
                />
              </label>
            </template>
            <p v-else class="mem__empty">选择左侧一行查看/编辑字段</p>
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
          移植自 yuzuki-Memory 的 TABLE_DEFINITIONS + traceRealtime 守则；含纪要表结构。
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
