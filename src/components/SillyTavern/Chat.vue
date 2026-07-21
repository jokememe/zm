<script setup lang="ts">
import { ref } from 'vue'
import { USER_ROLE } from '@/sillytavern'
import { useSillytavern } from '@/composables/useSillytavern'
import VariablePanel from './VariablePanel.vue'
import './st-shared.css'

const {
  activeChat,
  isSending,
  settings,
  sendMessage,
  sendGameMessage,
  editMessage,
  deleteMessagesFrom,
  branchFromMessage,
} = useSillytavern()

const input = ref('')
const editingId = ref<string | null>(null)
const editDraft = ref('')

async function handleSend() {
  const text = input.value.trim()
  if (!text || isSending.value) return
  input.value = ''
  if (settings.value?.uiMode === 'game') {
    await sendGameMessage(text)
  } else {
    await sendMessage(text)
  }
}

function startEdit(msg: { id: string; content: string }) {
  editingId.value = msg.id
  editDraft.value = msg.content
}

async function confirmEdit() {
  if (!editingId.value || !editDraft.value.trim()) return
  await editMessage(editingId.value, editDraft.value)
  editingId.value = null
  editDraft.value = ''
}
</script>

<template>
  <div class="st-chat">
    <div v-if="!activeChat" class="st-empty">选择一个聊天或创建新对话</div>
    <template v-else>
      <VariablePanel />
      <div class="st-messages">
        <div
          v-for="msg in activeChat.messages"
          :key="msg.id"
          class="st-message"
          :class="msg.role"
        >
          <div v-if="editingId === msg.id" class="st-row">
            <input v-model="editDraft" class="st-input" />
            <button type="button" class="st-btn st-btn--primary st-btn--sm" @click="confirmEdit">
              重新生成
            </button>
            <button type="button" class="st-btn st-btn--sm" @click="editingId = null">取消</button>
          </div>
          <template v-else>
            <div class="st-bubble">
              <div class="st-bubble__role">{{ msg.role === 'user' ? '你' : 'AI' }}</div>
              <div class="st-bubble__content">{{ msg.content }}</div>
              <div v-if="msg.parsed?.maintext" class="st-bubble__parsed">
                <p>{{ msg.parsed.maintext }}</p>
                <ul v-if="msg.parsed.options?.length">
                  <li v-for="(opt, i) in msg.parsed.options" :key="i">{{ opt }}</li>
                </ul>
              </div>
            </div>
            <div class="st-msg-actions">
              <button
                v-if="msg.role === USER_ROLE"
                type="button"
                class="st-btn st-btn--sm"
                @click="startEdit(msg)"
              >
                编辑并重新生成
              </button>
              <button type="button" class="st-btn st-btn--sm" @click="deleteMessagesFrom(msg.id)">
                删除后续
              </button>
              <button type="button" class="st-btn st-btn--sm" @click="branchFromMessage(msg.id)">
                从此分支
              </button>
            </div>
          </template>
        </div>
      </div>
      <div class="st-input-bar">
        <input
          v-model="input"
          class="st-input"
          :disabled="isSending"
          placeholder="输入消息..."
          @keydown.enter.exact.prevent="handleSend"
        />
        <button
          type="button"
          class="st-btn st-btn--primary"
          :disabled="isSending || !input.trim()"
          @click="handleSend"
        >
          {{ isSending ? '发送中...' : '发送' }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.st-chat {
  display: flex;
  flex-direction: column;
  min-height: 320px;
  max-height: 70vh;
}

.st-messages {
  flex: 1;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  padding: 0.25rem 0 0.75rem;
}

.st-message.user .st-bubble {
  margin-left: 12%;
  background: var(--moon-glow);
  border-color: var(--border-moon);
}

.st-message.assistant .st-bubble {
  margin-right: 8%;
}

.st-bubble {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 0.55rem 0.75rem;
  background: var(--bg-elevated);
  white-space: pre-wrap;
  word-break: break-word;
}

.st-bubble__role {
  font-size: 0.72rem;
  color: var(--ink-muted);
  margin-bottom: 0.25rem;
}

.st-bubble__content {
  font-size: 0.9rem;
  line-height: 1.55;
}

.st-bubble__parsed {
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px dashed var(--border-subtle);
  font-size: 0.85rem;
  color: var(--ink-secondary);
}

.st-msg-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin-top: 0.3rem;
  opacity: 0.85;
}

.st-input-bar {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
  padding-top: 0.5rem;
  border-top: 1px solid var(--border-subtle);
}

.st-input-bar .st-input {
  flex: 1;
}
</style>
