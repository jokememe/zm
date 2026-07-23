<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { useGameState } from '@/composables/useGameState'
import { useTianji } from '@/composables/useTianji'
import { useToast } from '@/composables/useToast'
import SettingsModal from '@/components/SillyTavern/SettingsModal.vue'
import LorebookModal from '@/components/SillyTavern/LorebookModal.vue'
import PresetModal from '@/components/SillyTavern/PresetModal.vue'
import VariablePanel from '@/components/SillyTavern/VariablePanel.vue'

const { tianjiCollapsed, toggleTianji, tianjiFocus, isCompact, closeTianjiSheet } =
  useGameState()
const {
  messages,
  typing,
  settling,
  contextInjected,
  sendPlayer,
  chooseQuick,
  regenerateLast,
  deleteMessagesFrom,
  editAndResend,
  canRegenerate,
  clearContext,
  llmReady,
  statusLabel,
  lastError,
  lastSettlement,
  lastSettlementKind,
  settings,
  showSettings,
  showLorebooks,
  showPresets,
  showVariables,
  updateSettings,
  reloadStMeta,
} = useTianji()
const toast = useToast()

/** 推演中或局面分析中，禁止连发 */
const busy = computed(() => typing.value || settling.value)

const input = ref('')
const listRef = ref<HTMLElement | null>(null)
const editingId = ref<string | null>(null)
const editDraft = ref('')

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
  toast.info('已编辑', '截断并重推演')
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

async function scrollBottom() {
  await nextTick()
  if (listRef.value) {
    listRef.value.scrollTop = listRef.value.scrollHeight
  }
}

watch(messages, () => scrollBottom(), { deep: true })
watch(typing, () => scrollBottom())
watch(settling, () => scrollBottom())
watch(tianjiFocus, (v) => {
  if (v) scrollBottom()
})

function submit() {
  if (!input.value.trim() || busy.value) return
  void sendPlayer(input.value)
  input.value = ''
}

function onChoice(label: string, parentId: string) {
  chooseQuick(label, parentId)
  toast.info('已写入天机', label)
}

async function onReroll() {
  if (busy.value || !canRegenerate.value) return
  await regenerateLast()
  toast.info('重推演', '已回滚上一轮并重新请示天机')
}

async function onDeleteFrom(id: string) {
  if (busy.value) return
  if (!confirm('删除此条及之后全部推演？气数将回滚到此条之前。')) return
  await deleteMessagesFrom(id)
  toast.info('已删楼', '会话与气数已回滚')
}

async function onSettingsClose() {
  showSettings.value = false
  await reloadStMeta()
}

async function onLoreClose() {
  showLorebooks.value = false
  await reloadStMeta()
}

async function onPresetClose() {
  showPresets.value = false
  await reloadStMeta()
}
</script>

<template>
  <aside
    id="tianji-panel"
    class="tianji"
    :class="{
      collapsed: tianjiCollapsed,
      focus: tianjiFocus,
      'is-compact': isCompact,
      'is-sheet-open': isCompact && !tianjiCollapsed,
    }"
    aria-label="天机卷轴"
  >
    <!-- 桌面：侧边收起条；紧凑：由底栏打开，不显示竖轨 -->
    <button
      v-if="tianjiCollapsed && !isCompact"
      id="btn-expand-tianji"
      type="button"
      class="tianji-rail"
      @click="toggleTianji"
    >
      <Icon name="scroll" :size="18" />
      <span>天机</span>
    </button>

    <template v-if="!tianjiCollapsed">
      <div v-if="isCompact" class="tianji__sheet-handle" aria-hidden="true" />
      <header class="tianji__head">
        <div class="tianji__title">
          <span class="tianji__mark"><Icon name="scroll" :size="16" /></span>
          <div>
            <h2>天机卷轴</h2>
            <p>{{ statusLabel }}</p>
          </div>
        </div>
        <div class="tianji__actions">
          <button
            type="button"
            class="btn btn-icon btn-ghost"
            title="重 roll 上一轮"
            aria-label="重 roll"
             :disabled="busy || !canRegenerate"
            @click="onReroll"
          >
            <Icon name="spark" :size="16" />
          </button>
          <button
            type="button"
            class="btn btn-icon btn-ghost"
            title="气数簿"
            aria-label="气数簿"
            @click="showVariables = true"
          >
            <Icon name="destiny" :size="16" />
          </button>
          <button
            type="button"
            class="btn btn-icon btn-ghost"
            title="秘闻典籍"
            aria-label="秘闻典籍"
            @click="showLorebooks = true"
          >
            <Icon name="library" :size="16" />
          </button>
          <button
            type="button"
            class="btn btn-icon btn-ghost"
            title="推演心法"
            aria-label="推演心法"
            @click="showPresets = true"
          >
            <Icon name="spark" :size="16" />
          </button>
          <button
            type="button"
            class="btn btn-icon btn-ghost"
            title="密匣"
            aria-label="密匣"
            @click="showSettings = true"
          >
            <Icon name="settings" :size="16" />
          </button>
          <button
            id="btn-collapse-tianji"
            class="btn btn-icon btn-ghost"
            type="button"
            :aria-label="isCompact ? '关闭天机' : '收起天机卷轴'"
            @click="isCompact ? closeTianjiSheet() : toggleTianji()"
          >
            <Icon :name="isCompact ? 'close' : 'chevron-right'" :size="18" />
          </button>
        </div>
      </header>

      <div v-if="contextInjected" id="tianji-context-chip" class="context-chip">
        <Icon name="link" :size="14" />
        <span>上下文：{{ contextInjected }}</span>
        <button id="btn-clear-context" type="button" class="context-chip__clear" @click="clearContext">
          <Icon name="close" :size="12" />
        </button>
      </div>

      <p v-if="lastError" class="tianji-error">{{ lastError }}</p>
      <p
        v-if="settling || lastSettlement"
        class="tianji-settle"
        :class="{
          'tianji-settle--ok': lastSettlementKind === 'ok',
          'tianji-settle--fail': lastSettlementKind === 'fail',
          'tianji-settle--info': lastSettlementKind === 'info' || settling,
        }"
      >
        <template v-if="settling">局面分析进行中…</template>
        <template v-else>局面：{{ lastSettlement }}</template>
      </p>

      <div ref="listRef" id="tianji-message-list" class="tianji__list scroll-y">
        <article
          v-for="m in messages"
          :id="`tianji-msg-${m.id}`"
          :key="m.id"
          class="msg"
          :class="`msg--${m.role}`"
        >
          <header class="msg__meta">
            <span class="msg__role">
              {{
                m.role === 'system'
                  ? '系统'
                  : m.role === 'event'
                    ? '事件'
                    : m.role === 'player'
                      ? '掌门'
                      : '天机'
              }}
            </span>
            <div class="msg__meta-right">
              <time>{{ m.time }}</time>
              <button
                type="button"
                class="msg__del"
                title="删除此条及之后"
                 :disabled="busy"
                @click="onDeleteFrom(m.id)"
              >
                删
              </button>
            </div>
          </header>
          <div v-if="editingId === m.id" class="msg__edit-box">
            <textarea v-model="editDraft" rows="3" class="msg__edit-input" />
            <div class="msg__edit-actions">
              <button type="button" class="btn btn-primary btn-sm" :disabled="busy || !editDraft.trim()" @click="confirmEdit">
                重新推演
              </button>
              <button type="button" class="btn btn-ghost btn-sm" @click="cancelEdit">取消</button>
            </div>
          </div>
          <p v-else class="msg__content">{{ m.content }}</p>
          <div v-if="m.choices?.length" class="msg__choices">
            <button
              v-for="c in m.choices"
              :id="`tianji-choice-${c.id}`"
              :key="c.id"
              type="button"
              class="btn btn-soft btn-sm"
               :disabled="busy"
              @click="onChoice(c.label, m.id)"
            >
              {{ c.label }}
            </button>
          </div>
          <div
            v-if="m.role === 'oracle' || m.role === 'player'"
            class="msg__ops"
          >
            <button
              v-if="m.role === 'player'"
              type="button"
              class="hint"
               :disabled="busy"
              @click="startEdit(m)"
            >
              ✎ 编辑
            </button>
            <button
              v-if="m.id === lastPlayerId || m.id === lastOracleId"
              type="button"
              class="hint"
               :disabled="busy || !canRegenerate"
              @click="onReroll"
            >
              ↻ 重 roll
            </button>
            <button
              type="button"
              class="hint hint--danger"
               :disabled="busy"
              @click="onDeleteFrom(m.id)"
            >
              删至此
            </button>
          </div>
        </article>

        <div v-if="typing" id="tianji-typing" class="msg msg--oracle typing">
          <span class="dot" /><span class="dot" /><span class="dot" />
        </div>
        <div v-else-if="settling" class="msg msg--system typing">
          <header class="msg__meta">
            <span class="msg__role">系统</span>
          </header>
          <p class="msg__content">【自动局面分析】进行中…</p>
        </div>
      </div>

      <form id="tianji-compose" class="tianji__compose" @submit.prevent="submit">
        <div class="compose-box">
          <textarea
            id="tianji-input"
            v-model="input"
            rows="2"
             :disabled="busy"
            :placeholder="
              llmReady
                ? '向天机询问、批示或推演……'
                : '本地推演中。通灵请点右上角密匣填写 API Key'
            "
            @keydown.enter.exact.prevent="submit"
          />
          <button
            id="btn-tianji-send"
            class="btn btn-primary btn-icon"
            type="submit"
            aria-label="发送"
             :disabled="busy || !input.trim()"
          >
            <Icon name="send" :size="16" />
          </button>
        </div>
        <div class="compose-hints">
          <button
            type="button"
            class="hint"
             :disabled="busy || !canRegenerate"
            title="回滚上一轮掌门发言与天机答复，再推演一次"
            @click="onReroll"
          >
            ↻ 重 roll
          </button>
          <button
            id="hint-ask-envoy"
            type="button"
            class="hint"
             :disabled="busy"
            @click="sendPlayer('赤焰谷使者意图如何？本宗该如何应对？')"
          >
            问使者
          </button>
          <button
            id="hint-ask-fields"
            type="button"
            class="hint"
             :disabled="busy"
            @click="sendPlayer('灵田现状如何，可否开荒？')"
          >
            问灵田
          </button>
          <button
            id="hint-ask-heir"
            type="button"
            class="hint"
             :disabled="busy"
            @click="sendPlayer('继位人选该如何权衡？')"
          >
            问继位
          </button>
        </div>
      </form>
    </template>

    <!-- 密匣：ST 能力只作配置层，不另开聊天 UI -->
    <SettingsModal
      v-if="showSettings && settings"
      :settings="settings"
      :update-settings="updateSettings"
      @close="onSettingsClose"
      @reloaded="onSettingsClose"
    />
    <LorebookModal v-if="showLorebooks" @close="onLoreClose" />
    <PresetModal v-if="showPresets" @close="onPresetClose" />
    <VariablePanel v-if="showVariables" @close="showVariables = false" />
  </aside>
</template>

<style scoped>
.tianji-settle {
  margin: 0 0.85rem 0.35rem;
  padding: 0.35rem 0.55rem;
  border-radius: var(--radius-sm);
  background: var(--jade-soft);
  color: var(--jade);
  font-size: 0.75rem;
  line-height: 1.4;
}
.tianji-settle--ok {
  background: var(--jade-soft);
  color: var(--jade);
}
.tianji-settle--fail {
  background: rgba(180, 60, 60, 0.12);
  color: #a33;
}
.tianji-settle--info {
  background: rgba(80, 120, 180, 0.12);
  color: #356;
}

.tianji {
  width: var(--tianji-width);
  height: 100%;
  display: flex;
  flex-direction: column;
  background: rgba(250, 252, 255, 0.78);
  backdrop-filter: blur(20px) saturate(1.2);
  border-left: 1px solid var(--border-subtle);
  z-index: var(--z-tianji);
  transition:
    width var(--dur-mid) var(--ease-out),
    box-shadow var(--dur-mid) var(--ease-out),
    transform var(--dur-mid) var(--ease-out);
}

.tianji.focus {
  box-shadow: -8px 0 32px var(--moon-glow);
}

.tianji.collapsed {
  width: var(--tianji-collapsed);
  background: transparent;
  border: none;
  backdrop-filter: none;
}

.tianji__sheet-handle {
  width: 40px;
  height: 4px;
  border-radius: 999px;
  background: rgba(120, 145, 180, 0.35);
  margin: 0.45rem auto 0.15rem;
  flex-shrink: 0;
}

/* 竖屏：底部抽屉，盖住主区 */
.tianji.is-compact {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  height: min(78dvh, 640px);
  max-height: calc(100dvh - 3.5rem - env(safe-area-inset-top, 0px));
  border-left: none;
  border-top: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  box-shadow: 0 -12px 40px rgba(40, 60, 100, 0.14);
  transform: translateY(110%);
  z-index: calc(var(--z-tianji) + 8);
  padding-bottom: env(safe-area-inset-bottom, 0);
}

.tianji.is-compact.is-sheet-open {
  transform: translateY(0);
}

.tianji.is-compact.collapsed {
  width: 100%;
  pointer-events: none;
}

.tianji.is-compact.focus {
  box-shadow: 0 -16px 48px var(--moon-glow);
}

.tianji-rail {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  writing-mode: vertical-rl;
  letter-spacing: 0.2em;
  color: var(--moon-deep);
  background: rgba(255, 255, 255, 0.7);
  border-left: 1px solid var(--border-subtle);
  border-radius: var(--radius-md) 0 0 var(--radius-md);
  transition: background var(--dur-fast), box-shadow var(--dur-fast);
}

.tianji-rail:hover {
  background: #fff;
  box-shadow: var(--shadow-md);
}

.tianji__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.9rem 0.9rem 0.7rem;
  border-bottom: 1px solid var(--border-subtle);
  gap: 0.35rem;
}

.tianji__title {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  min-width: 0;
}

.tianji__actions {
  display: flex;
  align-items: center;
  gap: 0.1rem;
  flex-shrink: 0;
}

.tianji__mark {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  background: linear-gradient(145deg, rgba(91, 141, 239, 0.2), rgba(180, 200, 230, 0.25));
  color: var(--moon-deep);
  border: 1px solid var(--border-moon);
}

.tianji__title h2 {
  font-size: 0.98rem;
}

.tianji__title p {
  font-size: 0.7rem;
  color: var(--ink-muted);
}

.tianji-error {
  margin: 0.5rem 0.85rem 0;
  padding: 0.4rem 0.6rem;
  font-size: 0.75rem;
  color: var(--rose);
  background: var(--rose-soft);
  border-radius: var(--radius-sm);
  line-height: 1.4;
}

.context-chip {
  margin: 0.65rem 0.85rem 0;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.6rem;
  border-radius: var(--radius-full);
  background: var(--moon-glow);
  color: var(--moon-deep);
  font-size: 0.75rem;
  border: 1px solid var(--border-moon);
  animation: slide-down var(--dur-mid) var(--ease-out);
}

.context-chip span {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.context-chip__clear {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--moon-deep);
}

.context-chip__clear:hover {
  background: rgba(255, 255, 255, 0.6);
}

.tianji__list {
  flex: 1;
  min-height: 0;
  padding: 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.msg {
  padding: 0.75rem 0.85rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  background: rgba(255, 255, 255, 0.7);
  animation: slide-up var(--dur-mid) var(--ease-out);
}

.msg--system {
  background: rgba(240, 245, 252, 0.8);
  color: var(--ink-secondary);
  font-size: 0.82rem;
}

.msg--event {
  border-color: rgba(196, 149, 74, 0.28);
  background: linear-gradient(145deg, rgba(255, 248, 235, 0.9), rgba(255, 255, 255, 0.75));
}

.msg--player {
  align-self: flex-end;
  max-width: 92%;
  background: linear-gradient(145deg, rgba(91, 141, 239, 0.18), rgba(91, 141, 239, 0.08));
  border-color: var(--border-moon);
}

.msg--oracle {
  border-color: rgba(90, 154, 150, 0.25);
  background: linear-gradient(145deg, rgba(232, 245, 243, 0.85), rgba(255, 255, 255, 0.8));
}

.msg__meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.35rem;
  font-size: 0.7rem;
  color: var(--ink-muted);
  gap: 0.35rem;
}

.msg__meta-right {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.msg__del {
  appearance: none;
  border: none;
  background: transparent;
  color: var(--ink-faint);
  font-size: 0.68rem;
  cursor: pointer;
  padding: 0 0.2rem;
  font-family: inherit;
}

.msg__del:hover:not(:disabled) {
  color: var(--rose);
}

.msg__del:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.msg__ops {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.5rem;
}

.hint--danger:hover:not(:disabled) {
  color: var(--rose);
  border-color: rgba(196, 90, 90, 0.35);
  background: var(--rose-soft);
}

.msg__role {
  font-weight: 600;
  letter-spacing: 0.06em;
}

.msg__content {
  font-size: 0.88rem;
  line-height: 1.6;
  color: var(--ink-primary);
  white-space: pre-wrap;
}

.msg__edit-box {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.msg__edit-input {
  width: 100%;
  border: 1px solid var(--border-moon);
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.9);
  padding: 0.5rem 0.65rem;
  font-family: inherit;
  font-size: 0.85rem;
  resize: vertical;
  line-height: 1.45;
}

.msg__edit-input:focus {
  outline: none;
  box-shadow: 0 0 0 3px var(--moon-glow);
}

.msg__edit-actions {
  display: flex;
  gap: 0.35rem;
}

.msg__choices {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.65rem;
}

.typing {
  display: flex;
  gap: 0.35rem;
  align-items: center;
  width: fit-content;
  padding: 0.7rem 1rem;
}

.typing .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--jade);
  animation: pulse-soft 1s ease-in-out infinite;
}

.typing .dot:nth-child(2) {
  animation-delay: 0.15s;
}
.typing .dot:nth-child(3) {
  animation-delay: 0.3s;
}

.tianji__compose {
  padding: 0.75rem 0.85rem 0.95rem;
  border-top: 1px solid var(--border-subtle);
  background: rgba(255, 255, 255, 0.45);
}

.compose-box {
  display: flex;
  gap: 0.5rem;
  align-items: flex-end;
}

.compose-box textarea {
  flex: 1;
  resize: none;
  padding: 0.65rem 0.8rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-medium);
  background: rgba(255, 255, 255, 0.85);
  min-height: 56px;
  line-height: 1.45;
  transition: border-color var(--dur-fast), box-shadow var(--dur-fast);
}

.compose-box textarea:focus {
  border-color: var(--moon);
  box-shadow: 0 0 0 3px var(--moon-glow);
}

.compose-hints {
  display: flex;
  gap: 0.4rem;
  margin-top: 0.5rem;
  flex-wrap: wrap;
}

.hint {
  font-size: 0.72rem;
  padding: 0.25rem 0.55rem;
  border-radius: var(--radius-full);
  color: var(--ink-muted);
  border: 1px solid var(--border-subtle);
  background: rgba(255, 255, 255, 0.6);
  transition: all var(--dur-fast);
}

.hint:hover:not(:disabled) {
  color: var(--moon-deep);
  border-color: var(--border-moon);
  background: var(--moon-glow);
}

.hint:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
