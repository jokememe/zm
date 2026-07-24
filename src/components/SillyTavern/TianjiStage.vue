<script setup lang="ts">
import { computed, ref } from 'vue'
import { useTianji } from '@/composables/useTianji'
import SettingsModal from './SettingsModal.vue'
import LorebookModal from './LorebookModal.vue'
import PresetModal from './PresetModal.vue'
import VariablePanel from './VariablePanel.vue'
import MemoryModal from './MemoryModal.vue'
import './st-shared.css'

const {
  ready,
  typing,
  settling,
  llmReady,
  statusLabel,
  contextInjected,
  contextDetail,
  lastError,
  lastSettlement,
  lastSettlementKind,
  displayMain,
  displayOptions,
  displaySum,
  displayThinking,
  settings,
  sessionVariables,
  messages,
  sendPlayer,
  chooseQuick,
  regenerateLast,
  deleteMessagesFrom,
  editAndResend,
  canRegenerate,
  clearContext,
  showSettings,
  showLorebooks,
  showPresets,
  showVariables,
  showMemory,
  updateSettings,
  reloadStMeta,
} = useTianji()

const input = ref('')
const showLog = ref(false)
const showQiEmbed = ref(false)
const editingId = ref<string | null>(null)
const editDraft = ref('')

/** 推演中或局面分析中，禁止连发 */
const busy = computed(() => typing.value || settling.value)

function startEdit(msg: { id: string; content: string }) {
  editingId.value = msg.id
  editDraft.value = msg.content
}

async function confirmEdit() {
  if (!editingId.value || !editDraft.value.trim() || busy.value) return
  const id = editingId.value
  const text = editDraft.value
  editingId.value = null
  editDraft.value = ''
  await editAndResend(id, text)
}

function cancelEdit() {
  editingId.value = null
  editDraft.value = ''
}

const lastPlayerId = computed(() => {
  for (let i = messages.value.length - 1; i >= 0; i--) {
    if (messages.value[i].role === 'player') return messages.value[i].id
  }
  return null
})
const lastOracleId = computed(() => {
  for (let i = messages.value.length - 1; i >= 0; i--) {
    if (messages.value[i].role === 'oracle') return messages.value[i].id
  }
  return null
})

async function submit() {
  const t = input.value.trim()
  if (!t || busy.value) return
  input.value = ''
  await sendPlayer(t)
}

async function onReroll() {
  if (busy.value || !canRegenerate.value) return
  await regenerateLast()
}

async function onDeleteFrom(id: string) {
  if (busy.value) return
  if (!confirm('删除此条及之后全部推演？气数将回滚到此条之前。')) return
  await deleteMessagesFrom(id)
}

async function onSettingsClose() {
  showSettings.value = false
  await reloadStMeta()
}
</script>

<template>
  <div class="stage">
    <header class="stage__toolbar">
      <div class="stage__status">
        <span class="stage__dot" :class="{ on: llmReady }" />
        <span>{{ statusLabel }}</span>
        <span
          v-if="settling || lastSettlement"
          class="stage__settle"
          :class="{
            'stage__settle--ok': lastSettlementKind === 'ok',
            'stage__settle--fail': lastSettlementKind === 'fail',
            'stage__settle--info': lastSettlementKind === 'info' || settling,
          }"
        >
          <template v-if="settling">局面分析中…</template>
          <template v-else>局面：{{ lastSettlement }}</template>
        </span>
      </div>
      <div class="stage__actions">
        <button
          type="button"
          class="btn btn-soft btn-sm"
          :disabled="busy || !canRegenerate"
          title="回滚上一轮并重新推演"
          @click="onReroll"
        >
          ↻ 重 roll
        </button>
        <button type="button" class="btn btn-ghost btn-sm" @click="showQiEmbed = !showQiEmbed">
          气数簿
        </button>
        <button type="button" class="btn btn-ghost btn-sm" @click="showVariables = true">
          全表
        </button>
        <button type="button" class="btn btn-ghost btn-sm" @click="showMemory = true">
          记忆
        </button>
        <button type="button" class="btn btn-ghost btn-sm" @click="showLorebooks = true">
          典籍
        </button>
        <button type="button" class="btn btn-ghost btn-sm" @click="showPresets = true">心法</button>
        <button type="button" class="btn btn-ghost btn-sm" @click="showSettings = true">密匣</button>
        <button type="button" class="btn btn-soft btn-sm" @click="showLog = !showLog">
          {{ showLog ? '正文' : '卷宗' }}
        </button>
      </div>
    </header>

    <div v-if="!ready" class="stage__loading">天机展开中…</div>

    <template v-else>
      <div v-if="contextInjected" class="stage__chip">
        <span>事务：{{ contextInjected }}{{ contextDetail ? ` · ${contextDetail}` : '' }}</span>
        <button type="button" class="btn btn-ghost btn-sm" @click="clearContext">清除</button>
      </div>
      <p v-if="lastError" class="stage__error">{{ lastError }}</p>
      <p
        v-if="settling"
        class="stage__hint stage__hint--settle"
      >
        【自动局面分析】进行中…
      </p>

      <VariablePanel v-if="showQiEmbed" embedded />

      <!-- 正文推演 -->
      <div v-if="!showLog" class="stage__body">
        <details v-if="displayThinking && settings?.thinkingDisplay !== 'hide'" class="stage__think">
          <summary>天机思绪</summary>
          <pre>{{ displayThinking }}</pre>
        </details>

        <article class="stage__main">
          <p v-if="displayMain" class="stage__text">{{ displayMain }}</p>
          <p v-else-if="typing" class="stage__hint">推演中…</p>
          <p v-else class="stage__hint">
            自经营页注入事务，或在此直接发问。通灵后正文与选项会出现在此；气数由回合结束局面分析写入，勿依赖
            &lt;vars&gt;。
          </p>
        </article>

        <div v-if="displayOptions.length" class="stage__opts">
          <button
            v-for="(opt, i) in displayOptions"
            :key="i"
            type="button"
            class="stage__opt"
            :disabled="typing"
            @click="chooseQuick(opt)"
          >
            {{ opt }}
          </button>
        </div>

        <details v-if="displaySum" class="stage__sum">
          <summary>本回合小结</summary>
          <p>{{ displaySum }}</p>
        </details>

        <div class="stage__turn-ops">
          <button
            type="button"
            class="btn btn-soft btn-sm"
            :disabled="typing || !canRegenerate"
            @click="onReroll"
          >
            ↻ 重 roll 本回合
          </button>
          <button
            v-if="lastOracleId"
            type="button"
            class="btn btn-ghost btn-sm"
            :disabled="typing"
            @click="onDeleteFrom(lastOracleId)"
          >
            删除本回合天机
          </button>
          <button
            v-if="lastPlayerId"
            type="button"
            class="btn btn-ghost btn-sm"
            :disabled="typing"
            @click="onDeleteFrom(lastPlayerId)"
          >
            删除本回合发言
          </button>
        </div>

        <div class="stage__qi-mini">
          <span v-for="k in ['灵石', '灵谷', '声望', '气运']" :key="k">
            {{ k }} {{ sessionVariables[k] ?? '—' }}
          </span>
        </div>
      </div>

      <!-- 卷宗流水 -->
      <div v-else class="stage__log scroll-y">
        <article
          v-for="m in messages"
          :key="m.id"
          class="stage__msg"
          :class="`role-${m.role}`"
        >
          <header>
            <span>{{
              m.role === 'player'
                ? '掌门'
                : m.role === 'oracle'
                  ? '天机'
                  : m.role === 'event'
                    ? '事件'
                    : '系统'
            }}</span>
            <span class="stage__msg-tools">
              <time>{{ m.time }}</time>
              <button
                v-if="m.role === 'player'"
                type="button"
                class="stage__msg-btn"
                :disabled="typing"
                @click="startEdit(m)"
              >
                编辑
              </button>
              <button
                v-if="m.id === lastPlayerId || m.id === lastOracleId"
                type="button"
                class="stage__msg-btn"
                :disabled="typing || !canRegenerate"
                @click="onReroll"
              >
                重 roll
              </button>
              <button
                type="button"
                class="stage__msg-btn stage__msg-btn--danger"
                :disabled="typing"
                @click="onDeleteFrom(m.id)"
              >
                删至此
              </button>
            </span>
          </header>
          <div v-if="editingId === m.id" class="stage__edit-box">
            <textarea v-model="editDraft" rows="3" class="stage__edit-input" />
            <div class="stage__edit-actions">
              <button type="button" class="btn btn-primary btn-sm" :disabled="typing || !editDraft.trim()" @click="confirmEdit">
                重新推演
              </button>
              <button type="button" class="btn btn-ghost btn-sm" @click="cancelEdit">取消</button>
            </div>
          </div>
          <p v-else>{{ m.content }}</p>
          <div v-if="m.choices?.length" class="stage__opts">
            <button
              v-for="c in m.choices"
              :key="c.id"
              type="button"
              class="btn btn-soft btn-sm"
              :disabled="typing"
              @click="chooseQuick(c.label, m.id)"
            >
              {{ c.label }}
            </button>
          </div>
        </article>
        <div v-if="typing" class="stage__hint">推演中…</div>
        <div v-else-if="settling" class="stage__hint stage__hint--settle">
          【自动局面分析】进行中…
        </div>
      </div>

      <form class="stage__compose" @submit.prevent="submit">
        <textarea
          v-model="input"
          rows="2"
          :disabled="busy"
          :placeholder="
            llmReady ? '向天机批示或自定义行动…' : '未通灵：本地示意。请在密匣填写密钥'
          "
          @keydown.enter.exact.prevent="submit"
        />
        <button type="submit" class="btn btn-primary" :disabled="busy || !input.trim()">
          {{ busy ? '…' : '推演' }}
        </button>
      </form>
    </template>

    <SettingsModal
      v-if="showSettings && settings"
      :settings="settings"
      :update-settings="updateSettings"
      @close="onSettingsClose"
      @reloaded="onSettingsClose"
    />
    <LorebookModal v-if="showLorebooks" @close="((showLorebooks = false), reloadStMeta())" />
    <PresetModal v-if="showPresets" @close="((showPresets = false), reloadStMeta())" />
    <VariablePanel v-if="showVariables" @close="showVariables = false" />
    <MemoryModal v-if="showMemory" @close="showMemory = false" />
  </div>
</template>

<style scoped>
.stage {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-height: min(70vh, 720px);
}

.stage__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem;
  padding: 0.55rem 0.75rem;
  border-radius: var(--radius-md);
  background: var(--bg-panel);
  border: 1px solid var(--border-subtle);
}

.stage__status {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.82rem;
  color: var(--ink-secondary);
}

.stage__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ink-faint);
}

.stage__dot.on {
  background: var(--jade);
  box-shadow: 0 0 0 3px var(--jade-soft);
}

.stage__settle {
  color: var(--jade);
  font-size: 0.75rem;
  max-width: 42vw;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stage__settle--ok {
  color: var(--jade);
}
.stage__settle--fail {
  color: #c44;
}
.stage__settle--info {
  color: #478;
}
.stage__hint--settle {
  margin: 0 0 0.5rem;
  color: #478;
}

.stage__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.stage__chip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.45rem 0.75rem;
  border-radius: var(--radius-full);
  background: var(--violet-soft);
  color: var(--violet);
  font-size: 0.82rem;
}

.stage__error {
  margin: 0;
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-sm);
  background: var(--rose-soft);
  color: var(--rose);
  font-size: 0.85rem;
}

.stage__loading,
.stage__hint {
  color: var(--ink-muted);
  font-size: 0.9rem;
  text-align: center;
  padding: 1.5rem 0.5rem;
}

.stage__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.stage__main {
  flex: 1;
  padding: 1.15rem 1.25rem;
  border-radius: var(--radius-lg);
  background: rgba(252, 253, 255, 0.88);
  border: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-sm);
  min-height: 200px;
}

.stage__text {
  margin: 0;
  font-size: 1rem;
  line-height: 1.75;
  color: var(--ink-primary);
  white-space: pre-wrap;
  font-family: var(--font-display);
}

.stage__think,
.stage__sum {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 0.5rem 0.75rem;
  background: var(--bg-soft);
  font-size: 0.85rem;
  color: var(--ink-secondary);
}

.stage__think pre {
  margin: 0.5rem 0 0;
  white-space: pre-wrap;
  font-family: inherit;
  font-size: 0.82rem;
}

.stage__opts {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.stage__opt {
  appearance: none;
  text-align: left;
  padding: 0.7rem 1rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-medium);
  background: var(--bg-elevated);
  color: var(--ink-primary);
  font-size: 0.9rem;
  cursor: pointer;
  font-family: inherit;
  transition: border-color var(--dur-fast), box-shadow var(--dur-fast), background var(--dur-fast);
}

.stage__opt:hover:not(:disabled) {
  border-color: var(--border-moon);
  box-shadow: var(--shadow-glow);
  background: rgba(91, 141, 239, 0.06);
}

.stage__opt:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.stage__turn-ops {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.stage__qi-mini {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  font-size: 0.78rem;
  color: var(--ink-muted);
}

.stage__msg-tools {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.stage__msg-btn {
  appearance: none;
  border: none;
  background: transparent;
  color: var(--moon-deep);
  font-size: 0.68rem;
  cursor: pointer;
  font-family: inherit;
  padding: 0;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.stage__msg-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.stage__msg-btn--danger {
  color: var(--rose);
}

.stage__log {
  flex: 1;
  max-height: 52vh;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  padding-right: 0.25rem;
}

.stage__msg {
  padding: 0.65rem 0.85rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
}

.stage__msg header {
  display: flex;
  justify-content: space-between;
  font-size: 0.72rem;
  color: var(--ink-muted);
  margin-bottom: 0.35rem;
}

.stage__msg p {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.55;
  white-space: pre-wrap;
}

.stage__edit-box {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.stage__edit-input {
  width: 100%;
  border: 1px solid var(--border-moon);
  border-radius: var(--radius-sm);
  background: var(--bg-soft);
  padding: 0.5rem 0.65rem;
  font-family: inherit;
  font-size: 0.88rem;
  resize: vertical;
}

.stage__edit-input:focus {
  outline: none;
  box-shadow: 0 0 0 3px var(--moon-glow);
}

.stage__edit-actions {
  display: flex;
  gap: 0.4rem;
}

.stage__msg.role-player {
  border-color: var(--border-moon);
}

.stage__msg.role-oracle {
  background: rgba(91, 141, 239, 0.05);
}

.stage__compose {
  display: flex;
  gap: 0.55rem;
  align-items: flex-end;
}

.stage__compose textarea {
  flex: 1;
  border: 1px solid var(--border-medium);
  border-radius: var(--radius-md);
  background: var(--bg-soft);
  padding: 0.65rem 0.85rem;
  font-family: inherit;
  font-size: 0.9rem;
  resize: vertical;
  min-height: 56px;
}

.stage__compose textarea:focus {
  outline: none;
  border-color: var(--border-moon);
  box-shadow: 0 0 0 3px var(--moon-glow);
}
</style>
