<script setup lang="ts">
import { ref, computed } from 'vue'
import ModalFrame from '@/components/ui/ModalFrame.vue'
import {
  importJsonFile,
  importLorebook,
  exportLorebook,
  exportToJson,
  createDefaultEntry,
  type Lorebook,
  type LorebookEntry,
  type SillyTavernLorebookExport,
} from '@/sillytavern'
import { SYSTEM_LOREBOOK_ID } from '@/composables/game-bridge'
import { useTianji } from '@/composables/useTianji'
import './st-shared.css'

const emit = defineEmits<{ close: [] }>()

const {
  lorebooks,
  activeLorebookIds,
  toggleLorebook,
  addLorebookFromDefault,
  updateLorebook,
  deleteLorebook,
} = useTianji()

const toastMsg = ref<string | null>(null)
const editing = ref<Lorebook | null>(null)
const entryDraft = ref<LorebookEntry | null>(null)

function toast(msg: string) {
  toastMsg.value = msg
  setTimeout(() => {
    toastMsg.value = null
  }, 2000)
}

const isActive = (id: string) => activeLorebookIds.value.includes(id)

async function createNew() {
  const name = prompt('典籍名称', '新秘闻')
  if (!name?.trim()) return
  await addLorebookFromDefault(name.trim())
  toast('已创建秘闻典籍')
}

async function handleImport() {
  const json = await importJsonFile<SillyTavernLorebookExport>()
  if (!json) return
  try {
    const data = importLorebook(json)
    const book: Lorebook = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    await updateLorebook(book)
    toast(`已导入：${book.name}`)
  } catch (e) {
    alert(`导入失败: ${(e as Error).message}`)
  }
}

function handleExport(book: Lorebook) {
  exportToJson(exportLorebook(book), `${book.name}.json`)
  toast('已导出')
}

async function removeBook(id: string) {
  if (id === SYSTEM_LOREBOOK_ID) {
    toast('系统实况不可删除')
    return
  }
  if (!confirm('确定删除该典籍？')) return
  await deleteLorebook(id)
  if (editing.value?.id === id) editing.value = null
  toast('已删除')
}

function openEditor(book: Lorebook) {
  editing.value = JSON.parse(JSON.stringify(book)) as Lorebook
  entryDraft.value = null
}

async function saveEditor() {
  if (!editing.value) return
  if (editing.value.id === SYSTEM_LOREBOOK_ID) {
    toast('系统实况由游戏自动维护，条目勿手改主快照')
  }
  await updateLorebook(editing.value)
  toast('已保存')
  editing.value = null
}

function addEntry() {
  if (!editing.value) return
  const entry = createDefaultEntry()
  editing.value = {
    ...editing.value,
    entries: [...editing.value.entries, entry],
  }
  entryDraft.value = entry
}

function selectEntry(entry: LorebookEntry) {
  entryDraft.value = { ...entry }
}

function applyEntryPatch(patch: Partial<LorebookEntry>) {
  if (!editing.value || !entryDraft.value) return
  const next = { ...entryDraft.value, ...patch }
  entryDraft.value = next
  editing.value = {
    ...editing.value,
    entries: editing.value.entries.map((e) => (e.id === next.id ? next : e)),
  }
}

function parseKeys(s: string) {
  return s
    .split(/[,，\n]/)
    .map((x) => x.trim())
    .filter(Boolean)
}

const sortedBooks = computed(() => {
  const list = [...lorebooks.value]
  return list.sort((a, b) => {
    if (a.id === SYSTEM_LOREBOOK_ID) return -1
    if (b.id === SYSTEM_LOREBOOK_ID) return 1
    return b.updatedAt - a.updatedAt
  })
})
</script>

<template>
  <ModalFrame
    id="modal-tianji-lore"
    :title="editing ? `编辑 · ${editing.name}` : '秘闻典籍'"
    :subtitle="editing ? '条目写入推演上下文' : '世界书 · 启用以注入天机'"
    width="860px"
    @close="editing ? (editing = null) : emit('close')"
  >
    <p v-if="toastMsg" class="tj-toast">{{ toastMsg }}</p>

    <!-- 列表 -->
    <template v-if="!editing">
      <div class="tj-row" style="margin-bottom: 0.85rem">
        <button type="button" class="btn btn-primary btn-sm" @click="createNew">新建典籍</button>
        <button type="button" class="btn btn-ghost btn-sm" @click="handleImport">导入 JSON</button>
      </div>
      <p class="tj-hint" style="margin-bottom: 0.75rem">
        「青岚实况」由资源与事务自动生成，始终启用。其它典籍可从 SillyTavern 导入。
      </p>
      <ul v-if="sortedBooks.length" class="tj-list">
        <li
          v-for="book in sortedBooks"
          :key="book.id"
          class="tj-card"
          :class="{ 'is-active': isActive(book.id) }"
        >
          <div>
            <p class="tj-card__title">
              {{ book.name }}
              <span v-if="book.id === SYSTEM_LOREBOOK_ID" class="tj-badge tj-badge--sys">系统</span>
              <span v-else-if="isActive(book.id)" class="tj-badge tj-badge--on">启用</span>
            </p>
            <p class="tj-card__meta">{{ book.entries.length }} 条 · 更新于会话库</p>
          </div>
          <div class="tj-row">
            <button
              v-if="book.id !== SYSTEM_LOREBOOK_ID"
              type="button"
              class="btn btn-soft btn-sm"
              @click="toggleLorebook(book.id)"
            >
              {{ isActive(book.id) ? '停用' : '启用' }}
            </button>
            <button type="button" class="btn btn-ghost btn-sm" @click="openEditor(book)">
              编辑
            </button>
            <button type="button" class="btn btn-ghost btn-sm" @click="handleExport(book)">
              导出
            </button>
            <button
              v-if="book.id !== SYSTEM_LOREBOOK_ID"
              type="button"
              class="btn btn-danger btn-sm"
              @click="removeBook(book.id)"
            >
              删
            </button>
          </div>
        </li>
      </ul>
      <p v-else class="tj-empty">尚无典籍，可新建或导入</p>
    </template>

    <!-- 编辑器 -->
    <template v-else>
      <div class="tj-field">
        <label>名称</label>
        <input
          class="tj-input"
          :value="editing.name"
          :disabled="editing.id === SYSTEM_LOREBOOK_ID"
          @input="editing = { ...editing, name: ($event.target as HTMLInputElement).value }"
        />
      </div>
      <div class="tj-split">
        <div class="tj-split__side">
          <div class="tj-row" style="margin-bottom: 0.5rem">
            <button type="button" class="btn btn-soft btn-sm" @click="addEntry">+ 条目</button>
          </div>
          <button
            v-for="e in editing.entries"
            :key="e.id"
            type="button"
            class="tj-entry-btn"
            :class="{ 'is-active': entryDraft?.id === e.id }"
            @click="selectEntry(e)"
          >
            {{ e.comment || e.keys[0] || e.id.slice(0, 8) }}
            <span v-if="e.constant" class="tj-badge">常驻</span>
          </button>
        </div>
        <div class="tj-split__main">
          <template v-if="entryDraft">
            <div class="tj-field">
              <label>备注</label>
              <input
                class="tj-input"
                :value="entryDraft.comment"
                @input="applyEntryPatch({ comment: ($event.target as HTMLInputElement).value })"
              />
            </div>
            <div class="tj-field">
              <label>关键词（逗号分隔）</label>
              <input
                class="tj-input"
                :value="entryDraft.keys.join(', ')"
                @input="
                  applyEntryPatch({ keys: parseKeys(($event.target as HTMLInputElement).value) })
                "
              />
            </div>
            <div class="tj-field">
              <label>内容</label>
              <textarea
                class="tj-textarea"
                rows="8"
                :value="entryDraft.content"
                @input="
                  applyEntryPatch({ content: ($event.target as HTMLTextAreaElement).value })
                "
              />
            </div>
            <label class="tj-check">
              <input
                type="checkbox"
                :checked="entryDraft.constant"
                @change="
                  applyEntryPatch({ constant: ($event.target as HTMLInputElement).checked })
                "
              />
              常驻注入（不依赖关键词）
            </label>
          </template>
          <p v-else class="tj-empty">选择或新增条目</p>
        </div>
      </div>
    </template>

    <template #footer>
      <template v-if="editing">
        <button type="button" class="btn btn-ghost" @click="editing = null">返回列表</button>
        <button type="button" class="btn btn-primary" @click="saveEditor">保存典籍</button>
      </template>
      <button v-else type="button" class="btn btn-primary" @click="emit('close')">关闭</button>
    </template>
  </ModalFrame>
</template>

<style scoped>
.tj-toast {
  margin: 0 0 0.75rem;
  padding: 0.45rem 0.75rem;
  border-radius: var(--radius-sm);
  background: var(--jade-soft);
  color: var(--jade);
  font-size: 0.82rem;
}
</style>
