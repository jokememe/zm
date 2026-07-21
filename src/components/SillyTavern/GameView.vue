<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSillytavern } from '@/composables/useSillytavern'
import SettingsModal from './SettingsModal.vue'
import LorebookModal from './LorebookModal.vue'
import PresetModal from './PresetModal.vue'
import ChatModal from './ChatModal.vue'
import VariablePanel from './VariablePanel.vue'
import Chat from './Chat.vue'
import './st-shared.css'

const st = useSillytavern()
const historyOpen = ref(false)
const customInput = ref('')

const lastAssistant = computed(() =>
  [...(st.activeChat.value?.messages ?? [])]
    .reverse()
    .find((m) => m.role === 'assistant'),
)

const lorebookCount = computed(() => st.settings.value?.activeLorebookIds?.length ?? 0)
const messageCount = computed(() => st.activeChat.value?.messages?.length ?? 0)
const variableCount = computed(
  () => Object.keys(st.activeChat.value?.variables ?? {}).length,
)

const isStreaming = computed(() => st.streamState.value.isStreaming)

const display = computed(() => {
  if (isStreaming.value) {
    return {
      thinking: st.streamState.value.thinking,
      maintext: st.streamState.value.maintext,
      options: st.streamState.value.options,
      sum: st.streamState.value.sum,
    }
  }
  const a = lastAssistant.value
  return {
    thinking: a?.parsed?.thinking ?? '',
    maintext: a?.parsed?.maintext ?? a?.content ?? '',
    options: a?.parsed?.options ?? [],
    sum: a?.parsed?.sum ?? '',
  }
})

const thinkingMode = computed(() => st.settings.value?.thinkingDisplay ?? 'fold')
const isGame = computed(() => st.settings.value?.uiMode !== 'chat')

async function pickOption(text: string) {
  if (isStreaming.value || st.isSending.value) return
  await st.sendGameMessage(text)
}

async function sendCustom() {
  const text = customInput.value.trim()
  if (!text || st.isSending.value) return
  customInput.value = ''
  if (isGame.value) await st.sendGameMessage(text)
  else await st.sendMessage(text)
}

async function ensureChat() {
  if (!st.activeChat.value) {
    await st.createChat()
  }
}
</script>

<template>
  <div class="st-gameview">
    <div v-if="st.isLoading.value" class="st-empty">SillyTavern 加载中…</div>

    <template v-else>
      <div class="st-toolbar">
        <button type="button" class="st-btn" @click="historyOpen = true">
          ☰ 历史
          <span v-if="messageCount" class="st-badge">{{ messageCount }}</span>
        </button>
        <button type="button" class="st-btn" @click="st.openChatModal()">
          聊天
          <span v-if="st.chats.value.length" class="st-badge">{{ st.chats.value.length }}</span>
        </button>
        <button type="button" class="st-btn" @click="st.openSettings()">⚙ 设置</button>
        <button type="button" class="st-btn" @click="st.openLorebooks()">
          📖 世界书
          <span v-if="lorebookCount" class="st-badge">{{ lorebookCount }}</span>
        </button>
        <button type="button" class="st-btn" @click="st.openPresets()">✦ 预设</button>
        <button type="button" class="st-btn" @click="st.openVariables()">
          📊 变量
          <span v-if="variableCount" class="st-badge">{{ variableCount }}</span>
        </button>
        <button
          type="button"
          class="st-btn"
          :disabled="!lastAssistant || st.isSending.value"
          @click="st.regenerateLast()"
        >
          ↻ 重 roll
        </button>
        <button
          v-if="!st.activeChat.value"
          type="button"
          class="st-btn st-btn--primary"
          @click="ensureChat"
        >
          开始新对话
        </button>
      </div>

      <!-- Game mode presentation -->
      <template v-if="isGame && st.activeChat.value">
        <VariablePanel />

        <details
          v-if="thinkingMode === 'fold' && display.thinking"
          class="st-thinking"
        >
          <summary>思考过程</summary>
          <pre>{{ display.thinking }}</pre>
        </details>
        <pre v-else-if="thinkingMode === 'inline' && display.thinking" class="st-thinking-inline">{{
          display.thinking
        }}</pre>

        <div class="st-maintext" :class="{ 'is-streaming': isStreaming }">
          <p v-if="display.maintext">{{ display.maintext }}</p>
          <p v-else-if="isStreaming" class="st-hint">生成中…</p>
          <p v-else class="st-empty">选择选项或输入行动，开启剧情</p>
        </div>

        <div v-if="display.options.length" class="st-options">
          <button
            v-for="(opt, i) in display.options"
            :key="i"
            type="button"
            class="st-option"
            :disabled="isStreaming || st.isSending.value"
            @click="pickOption(opt)"
          >
            {{ opt }}
          </button>
        </div>

        <details v-if="display.sum" class="st-sum">
          <summary>📜 总结</summary>
          <p>{{ display.sum }}</p>
        </details>

        <div class="st-input-bar">
          <input
            v-model="customInput"
            class="st-input"
            :disabled="st.isSending.value"
            placeholder="自定义行动…"
            @keydown.enter.exact.prevent="sendCustom"
          />
          <button
            type="button"
            class="st-btn st-btn--primary"
            :disabled="st.isSending.value || !customInput.trim()"
            @click="sendCustom"
          >
            {{ st.isSending.value ? '发送中…' : '发送' }}
          </button>
          <button
            v-if="isStreaming"
            type="button"
            class="st-btn st-btn--danger"
            @click="st.abortStream()"
          >
            中止
          </button>
        </div>
      </template>

      <!-- Chat mode -->
      <Chat v-else />

      <!-- History drawer -->
      <div v-if="historyOpen" class="st-overlay" @click.self="historyOpen = false">
        <div class="st-modal" role="dialog">
          <header class="st-modal__header">
            <h2 class="st-modal__title">消息历史</h2>
            <button type="button" class="st-btn st-btn--ghost" @click="historyOpen = false">
              关闭
            </button>
          </header>
          <div class="st-modal__body">
            <p v-if="!st.activeChat.value?.messages.length" class="st-empty">暂无消息</p>
            <ul v-else class="st-list">
              <li
                v-for="(msg, idx) in st.activeChat.value.messages"
                :key="msg.id"
                class="st-list-item st-hist-item"
              >
                <div class="st-hist-body">
                  <span class="st-hint">#{{ idx + 1 }} · {{ msg.role }}</span>
                  <div class="st-hist-text">{{ msg.content.slice(0, 120) }}{{ msg.content.length > 120 ? '…' : '' }}</div>
                </div>
                <div class="st-row">
                  <button
                    type="button"
                    class="st-btn st-btn--sm"
                    @click="st.jumpToFloor(msg.id)"
                  >
                    跳到此处
                  </button>
                  <button
                    type="button"
                    class="st-btn st-btn--sm"
                    @click="st.branchFromMessage(msg.id)"
                  >
                    分支
                  </button>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <!-- Modals -->
      <SettingsModal
        v-if="st.showSettings.value && st.settings.value"
        :settings="st.settings.value"
        :update-settings="st.updateSettings"
        @close="st.showSettings.value = false"
        @reloaded="() => { st.showSettings.value = false; void st.loadAll(true) }"
      />
      <LorebookModal v-if="st.showLorebooks.value" @close="st.showLorebooks.value = false" />
      <PresetModal v-if="st.showPresets.value" @close="st.showPresets.value = false" />
      <ChatModal v-if="st.showChatModal.value" @close="st.showChatModal.value = false" />

      <!-- Variables modal shell -->
      <div
        v-if="st.showVariables.value"
        class="st-overlay"
        @click.self="st.showVariables.value = false"
      >
        <div class="st-modal" role="dialog">
          <header class="st-modal__header">
            <h2 class="st-modal__title">变量</h2>
            <button
              type="button"
              class="st-btn st-btn--ghost"
              @click="st.showVariables.value = false"
            >
              关闭
            </button>
          </header>
          <div class="st-modal__body">
            <VariablePanel />
          </div>
        </div>
      </div>

      <!-- Toast -->
      <div v-if="st.toast.value" class="st-toast" role="status">{{ st.toast.value }}</div>
    </template>
  </div>
</template>

<style scoped>
.st-gameview {
  max-width: 720px;
  margin: 0 auto;
  padding: 0.25rem 0 1.5rem;
}

.st-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-bottom: 1rem;
}

.st-maintext {
  min-height: 120px;
  padding: 1rem 1.1rem;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-panel);
  white-space: pre-wrap;
  line-height: 1.7;
  font-size: 0.95rem;
  margin-bottom: 0.85rem;
}

.st-maintext.is-streaming {
  border-color: var(--border-moon);
  box-shadow: var(--shadow-glow);
}

.st-options {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  margin-bottom: 0.85rem;
}

.st-option {
  appearance: none;
  text-align: left;
  border: 1px solid var(--border-medium);
  background: var(--bg-elevated);
  border-radius: var(--radius-sm);
  padding: 0.65rem 0.85rem;
  cursor: pointer;
  font: inherit;
  color: var(--ink-primary);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.st-option:hover:not(:disabled) {
  border-color: var(--border-moon);
  box-shadow: var(--shadow-sm);
}

.st-option:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.st-thinking,
.st-sum {
  margin-bottom: 0.75rem;
  color: var(--ink-secondary);
  font-size: 0.85rem;
}

.st-thinking pre,
.st-thinking-inline {
  white-space: pre-wrap;
  font-family: inherit;
  font-size: 0.82rem;
  color: var(--ink-muted);
  margin: 0.4rem 0 0;
}

.st-input-bar {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.st-input-bar .st-input {
  flex: 1;
}

.st-hist-item {
  align-items: flex-start;
}

.st-hist-body {
  flex: 1;
  min-width: 0;
}

.st-hist-text {
  font-size: 0.85rem;
  color: var(--ink-secondary);
  margin-top: 0.15rem;
}

.st-toast {
  position: fixed;
  bottom: 1.5rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: var(--z-toast, 200);
  background: var(--ink-primary);
  color: #fff;
  padding: 0.55rem 1rem;
  border-radius: var(--radius-full);
  font-size: 0.85rem;
  box-shadow: var(--shadow-lg);
}
</style>
