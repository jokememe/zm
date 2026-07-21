<script setup lang="ts">
import { useSillytavern } from '@/composables/useSillytavern'
import './st-shared.css'

const emit = defineEmits<{ close: [] }>()

const {
  chats,
  activeChatId,
  createChat,
  loadChat,
  deleteChat,
  showToast,
} = useSillytavern()

async function handleCreate() {
  const name = prompt('对话名称（可留空）') || undefined
  await createChat(name)
  showToast('已创建对话')
}

async function handleDelete(id: string) {
  if (!confirm('确定删除该对话？')) return
  await deleteChat(id)
  showToast('已删除')
}

function select(id: string) {
  loadChat(id)
  emit('close')
}
</script>

<template>
  <div class="st-overlay" @click.self="emit('close')">
    <div class="st-modal" role="dialog" aria-modal="true">
      <header class="st-modal__header">
        <h2 class="st-modal__title">
          聊天记录
          <span v-if="chats.length" class="st-badge">{{ chats.length }}</span>
        </h2>
        <button type="button" class="st-btn st-btn--ghost" @click="emit('close')">关闭</button>
      </header>

      <div class="st-modal__body">
        <div class="st-row" style="margin-bottom: 0.75rem">
          <button type="button" class="st-btn st-btn--primary" @click="handleCreate">新建对话</button>
        </div>
        <p v-if="!chats.length" class="st-empty">暂无聊天，点击上方新建</p>
        <ul v-else class="st-list">
          <li
            v-for="chat in chats"
            :key="chat.id"
            class="st-list-item"
            :class="{ 'is-active': activeChatId === chat.id }"
          >
            <button type="button" class="st-chat-select" @click="select(chat.id)">
              <strong>{{ chat.name }}</strong>
              <span class="st-hint">
                {{ chat.messages.length }} 条 ·
                {{ new Date(chat.updatedAt).toLocaleString() }}
              </span>
            </button>
            <button
              type="button"
              class="st-btn st-btn--sm st-btn--danger"
              @click="handleDelete(chat.id)"
            >
              删除
            </button>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.st-chat-select {
  appearance: none;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  flex: 1;
  min-width: 0;
  color: inherit;
  font: inherit;
  padding: 0;
}
</style>
