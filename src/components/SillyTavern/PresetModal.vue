<script setup lang="ts">
/**
 * 推演心法 — Teleport 到 body 的真全屏编辑器
 * 禁止挂在带 backdrop-filter 的侧栏内（fixed 会被困住）
 */
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import {
  importJsonFileWithName,
  importPreset,
  exportPreset,
  exportToJson,
  movePromptItem,
  normalizePresetSettings,
  resolveOrderDisplayName,
  flattenPromptOrder,
  listPromptOrderGroups,
  type ChatPreset,
  type FlatPromptOrderItem,
  type NormalizedPromptBlock,
  type RegexScript,
} from '@/sillytavern'
import { useTianji } from '@/composables/useTianji'

const emit = defineEmits<{ close: [] }>()

const {
  presets,
  settings,
  updateSettings,
  addPresetFromDefault,
  updatePreset,
  deletePreset,
} = useTianji()

type EditorTab = 'order' | 'prompts' | 'sample' | 'regex'

const toastMsg = ref<string | null>(null)
const editing = ref<ChatPreset | null>(null)
const editorTab = ref<EditorTab>('order')
const orderDirty = ref(false)
const selectedId = ref<string | null>(null)
const listFilter = ref('')
const onlyEnabled = ref(false)
const contentEl = ref<HTMLTextAreaElement | null>(null)

function toast(msg: string) {
  toastMsg.value = msg
  window.setTimeout(() => {
    toastMsg.value = null
  }, 2400)
}

const activeId = computed(() => settings.value?.activePresetId ?? null)

const flatOrder = computed((): FlatPromptOrderItem[] => {
  if (!editing.value?.settings) return []
  try {
    return flattenPromptOrder(editing.value.settings.prompt_order)
  } catch {
    return []
  }
})

const prompts = computed((): NormalizedPromptBlock[] => {
  const p = editing.value?.settings?.prompts
  return Array.isArray(p) ? (p as NormalizedPromptBlock[]) : []
})

const promptMap = computed(() => {
  const m = new Map<string, NormalizedPromptBlock>()
  for (const p of prompts.value) m.set(p.identifier, p)
  return m
})

const regexScripts = computed((): RegexScript[] => {
  const r = editing.value?.settings?.regex_scripts
  return Array.isArray(r) ? (r as RegexScript[]) : []
})

const orderGroups = computed(() => {
  if (!editing.value?.settings) return []
  try {
    return listPromptOrderGroups(
      editing.value.settings._raw_prompt_order || editing.value.settings.prompt_order,
    )
  } catch {
    return []
  }
})

const stats = computed(() => ({
  order: flatOrder.value.length,
  on: flatOrder.value.filter((o) => o.enabled !== false).length,
  blocks: prompts.value.length,
  regex: regexScripts.value.length,
}))

const selectedItem = computed(() => {
  if (!selectedId.value) return null
  return flatOrder.value.find((o) => o.identifier === selectedId.value) ?? null
})

const selectedPrompt = computed(() => {
  if (!selectedId.value) return null
  return promptMap.value.get(selectedId.value) ?? null
})

const selectedIndex = computed(() => {
  if (!selectedId.value) return -1
  return flatOrder.value.findIndex((o) => o.identifier === selectedId.value)
})

function titleOf(item: FlatPromptOrderItem | null | undefined) {
  if (!item) return ''
  return resolveOrderDisplayName(item, prompts.value)
}

function kindOf(id: string): 'history' | 'world' | 'system' | 'custom' {
  if (id === 'chatHistory') return 'history'
  if (id.startsWith('worldInfo')) return 'world'
  const systemIds = new Set([
    'main',
    'nsfw',
    'jailbreak',
    'charDescription',
    'charPersonality',
    'scenario',
    'personaDescription',
    'dialogueExamples',
    'enhanceDefinitions',
    'groupNudge',
    'impersonate',
    'quietPrompt',
    'bias',
  ])
  if (systemIds.has(id)) return 'system'
  return 'custom'
}

function kindText(k: ReturnType<typeof kindOf>) {
  return ({ history: '历史', world: '世界书', system: '系统', custom: '自定义' } as const)[k]
}

function previewOf(id: string): string {
  const p = promptMap.value.get(id)
  if (p?.content?.trim()) {
    const t = p.content.replace(/\s+/g, ' ').trim()
    return t.length > 100 ? `${t.slice(0, 100)}…` : t
  }
  const tips: Record<string, string> = {
    chatHistory: '（动态）对话历史插入点',
    worldInfoBefore: '（动态）世界书 · 前',
    worldInfoAfter: '（动态）世界书 · 后',
    main: '主提示',
    jailbreak: '相对 / 越狱提示',
    nsfw: 'NSFW 提示',
  }
  return tips[id] || '无正文内容'
}

const visibleOrder = computed(() => {
  let rows = flatOrder.value.map((item, index) => ({
    ...item,
    index,
    title: titleOf(item),
    kind: kindOf(item.identifier),
    preview: previewOf(item.identifier),
    chars: promptMap.value.get(item.identifier)?.content?.length ?? 0,
  }))
  if (onlyEnabled.value) rows = rows.filter((r) => r.enabled !== false)
  const q = listFilter.value.trim().toLowerCase()
  if (q) {
    rows = rows.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.identifier.toLowerCase().includes(q) ||
        r.preview.toLowerCase().includes(q),
    )
  }
  return rows
})

const filteredPrompts = computed(() => {
  const q = listFilter.value.trim().toLowerCase()
  if (!q) return prompts.value
  return prompts.value.filter(
    (p) =>
      (p.name || '').toLowerCase().includes(q) ||
      p.identifier.toLowerCase().includes(q) ||
      (p.content || '').toLowerCase().includes(q),
  )
})

watch(editorTab, (t) => {
  if (t === 'prompts' && !selectedId.value && prompts.value[0]) {
    selectedId.value = prompts.value[0].identifier
  }
})

function patchSettings(key: string, value: unknown) {
  if (!editing.value) return
  editing.value = {
    ...editing.value,
    settings: { ...editing.value.settings, [key]: value },
  }
}

function setOrder(next: FlatPromptOrderItem[]) {
  orderDirty.value = true
  patchSettings('prompt_order', next)
}

function setPrompts(next: NormalizedPromptBlock[]) {
  patchSettings('prompts', next)
}

function patchPrompt(id: string, partial: Partial<NormalizedPromptBlock>) {
  setPrompts(prompts.value.map((p) => (p.identifier === id ? { ...p, ...partial } : p)))
  if (partial.name !== undefined) {
    setOrder(
      flatOrder.value.map((o) =>
        o.identifier === id ? { ...o, name: String(partial.name) } : o,
      ),
    )
  }
}

async function createNew() {
  const name = window.prompt('心法名称', '新心法')
  if (!name?.trim()) return
  const p = await addPresetFromDefault(name.trim())
  openEdit(p)
}

async function handleImport() {
  const file = await importJsonFileWithName<Record<string, unknown>>()
  if (!file) return
  try {
    const data = importPreset(file.data, { fileName: file.fileName })
    const preset: ChatPreset = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    await updatePreset(preset)
    const n = flattenPromptOrder(preset.settings?.prompt_order).length
    toast(`已导入「${preset.name}」· ${n} 序`)
    openEdit(preset)
  } catch (e) {
    alert(`导入失败: ${(e as Error).message}`)
  }
}

function handleExport(p: ChatPreset) {
  exportToJson(exportPreset(p), `${p.name || 'preset'}.json`)
  toast('已导出')
}

async function activate(id: string) {
  await updateSettings({ activePresetId: id })
  toast('已启用')
}

async function remove(id: string) {
  if (!confirm('确定删除？')) return
  await deletePreset(id)
  if (editing.value?.id === id) editing.value = null
}

function openEdit(p: ChatPreset) {
  try {
    const s = normalizePresetSettings((p.settings || {}) as Record<string, unknown>)
    editing.value = JSON.parse(JSON.stringify({ ...p, settings: s })) as ChatPreset
    orderDirty.value = false
    editorTab.value = 'order'
    listFilter.value = ''
    onlyEnabled.value = false
    nextTick(() => {
      const order = flattenPromptOrder(editing.value?.settings?.prompt_order)
      selectedId.value = order[0]?.identifier ?? null
    })
  } catch (e) {
    alert(`打开失败: ${(e as Error).message}`)
  }
}

function closeEdit() {
  editing.value = null
  orderDirty.value = false
  selectedId.value = null
}

async function saveEdit() {
  if (!editing.value) return
  try {
    const promptsSync = prompts.value.map((p) => ({
      ...p,
      content: p.content ?? '',
      prompt: p.content ?? '',
    }))
    const s = normalizePresetSettings(
      {
        ...editing.value.settings,
        prompts: promptsSync,
        prompt_order: flatOrder.value,
        regex_scripts: regexScripts.value,
      } as Record<string, unknown>,
      { flatIsAuthoritative: orderDirty.value },
    )
    await updatePreset(
      { ...editing.value, settings: s },
      { flatIsAuthoritative: orderDirty.value },
    )
    toast('已保存')
    closeEdit()
  } catch (e) {
    alert(`保存失败: ${(e as Error).message}`)
  }
}

function selectRow(id: string) {
  selectedId.value = id
}

function moveSelected(delta: number) {
  const idx = selectedIndex.value
  if (idx < 0) return
  const to = idx + delta
  if (to < 0 || to >= flatOrder.value.length) return
  const id = flatOrder.value[idx].identifier
  setOrder(movePromptItem([...flatOrder.value], idx, to))
  selectedId.value = id
}

function toggleSelected() {
  const idx = selectedIndex.value
  if (idx < 0) return
  setOrder(
    flatOrder.value.map((o, i) =>
      i === idx ? { ...o, enabled: o.enabled === false } : o,
    ),
  )
}

function goEditContent(id: string) {
  selectedId.value = id
  editorTab.value = 'prompts'
  nextTick(() => contentEl.value?.focus())
}

function addCustom() {
  const id = crypto.randomUUID()
  const block: NormalizedPromptBlock = {
    identifier: id,
    name: '自定义块',
    role: 'system',
    content: '',
    enabled: true,
    marker: false,
  }
  setPrompts([...prompts.value, block])
  const order = [...flatOrder.value]
  const hist = order.findIndex((o) => o.identifier === 'chatHistory')
  const item: FlatPromptOrderItem = {
    identifier: id,
    enabled: true,
    name: '自定义块',
    role: 'system',
  }
  if (hist >= 0) order.splice(hist, 0, item)
  else order.push(item)
  setOrder(order)
  selectedId.value = id
  editorTab.value = 'prompts'
  toast('已添加，请填写正文')
}

function removeSelectedPrompt() {
  if (!selectedId.value) return
  if (!confirm('删除该提示块？')) return
  const id = selectedId.value
  setPrompts(prompts.value.filter((p) => p.identifier !== id))
  setOrder(flatOrder.value.filter((o) => o.identifier !== id))
  selectedId.value = flatOrder.value.find((o) => o.identifier !== id)?.identifier ?? null
}

function toggleRegex(i: number) {
  patchSettings(
    'regex_scripts',
    regexScripts.value.map((s, idx) =>
      idx === i ? { ...s, disabled: !s.disabled } : s,
    ),
  )
}

function switchGroup(cid: number) {
  if (!editing.value?.settings?._raw_prompt_order) return
  editing.value = {
    ...editing.value,
    settings: {
      ...editing.value.settings,
      _active_character_id: cid,
      _raw_prompt_order: editing.value.settings._raw_prompt_order,
      prompt_order: flattenPromptOrder(editing.value.settings._raw_prompt_order, cid),
    },
  }
  orderDirty.value = false
  selectedId.value = flatOrder.value[0]?.identifier ?? null
  toast(`已切换角色组 ${cid}`)
}

function sampleGet(key: string, fallback: number | string = 0) {
  const v = editing.value?.settings?.[key]
  if (v === undefined || v === null || v === '') return fallback
  return v as number | string
}

function sampleSet(key: string, value: unknown) {
  patchSettings(key, value)
}

function metaLine(p: ChatPreset) {
  try {
    const s = normalizePresetSettings((p.settings || {}) as Record<string, unknown>)
    const m = s._meta as { orderCount?: number; promptsCount?: number; regexCount?: number }
    return `${m?.orderCount ?? 0} 序 · ${m?.promptsCount ?? 0} 块 · ${m?.regexCount ?? 0} 正则`
  } catch {
    return '—'
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (editing.value) closeEdit()
  else emit('close')
}

onMounted(() => {
  document.addEventListener('keydown', onKey)
  document.body.style.overflow = 'hidden'
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
})

const TABS: { id: EditorTab; label: string }[] = [
  { id: 'order', label: '顺序' },
  { id: 'prompts', label: '正文' },
  { id: 'sample', label: '采样' },
  { id: 'regex', label: '正则' },
]
</script>

<template>
  <Teleport to="body">
    <div class="pm" role="dialog" aria-modal="true" aria-label="推演心法">
      <div class="pm__atmosphere" aria-hidden="true" />

      <!-- 列表 -->
      <template v-if="!editing">
        <header class="pm__bar">
          <div class="pm__brand">
            <span class="pm__mark" aria-hidden="true">✦</span>
            <div>
              <h1 class="pm__title">推演心法</h1>
              <p class="pm__sub">SillyTavern 预设工坊 · 顺序 · 正文 · 采样 · 正则</p>
            </div>
          </div>
          <div class="pm__bar-actions">
            <button type="button" class="btn btn-soft" @click="handleImport">导入 JSON</button>
            <button type="button" class="btn btn-primary" @click="createNew">新建心法</button>
            <button type="button" class="btn btn-ghost" @click="emit('close')">关闭</button>
          </div>
        </header>
        <p v-if="toastMsg" class="pm__toast">{{ toastMsg }}</p>
        <div class="pm__scroll">
          <div class="pm__list-wrap">
            <header class="pm__list-head">
              <div>
                <h2>心法库</h2>
                <p>共 {{ presets.length }} 部 · 点「编辑」进入工坊</p>
              </div>
            </header>
            <ul v-if="presets.length" class="pm__cards">
              <li
                v-for="p in presets"
                :key="p.id"
                class="pm__card"
                :class="{ 'is-on': activeId === p.id }"
              >
                <button type="button" class="pm__card-main" @click="openEdit(p)">
                  <span class="pm__card-glyph" aria-hidden="true">卷</span>
                  <span class="pm__card-text">
                    <span class="pm__card-name">
                      {{ p.name }}
                      <span v-if="activeId === p.id" class="pm__badge">使用中</span>
                    </span>
                    <span class="pm__card-meta">{{ metaLine(p) }}</span>
                  </span>
                  <span class="pm__card-go">编辑 →</span>
                </button>
                <div class="pm__card-actions">
                  <button
                    v-if="activeId !== p.id"
                    type="button"
                    class="btn btn-soft btn-sm"
                    @click="activate(p.id)"
                  >
                    启用
                  </button>
                  <button type="button" class="btn btn-ghost btn-sm" @click="handleExport(p)">
                    导出
                  </button>
                  <button type="button" class="btn btn-danger btn-sm" @click="remove(p.id)">
                    删除
                  </button>
                </div>
              </li>
            </ul>
            <div v-else class="pm__empty">
              <div class="pm__empty-icon" aria-hidden="true">✦</div>
              <p>心法库尚空</p>
              <span>从 SillyTavern 导出 OpenAI 预设 JSON 后在此导入</span>
              <button type="button" class="btn btn-primary" @click="handleImport">
                导入预设
              </button>
            </div>
          </div>
        </div>
      </template>

      <!-- 编辑工坊 -->
      <template v-else>
        <header class="pm__bar pm__bar--edit">
          <div class="pm__bar-left">
            <button type="button" class="btn btn-ghost btn-sm" @click="closeEdit">← 心法库</button>
            <div class="pm__name-wrap">
              <label class="pm__name-label">心法名称</label>
              <input
                class="pm__name"
                :value="editing.name"
                @input="
                  editing = {
                    ...editing,
                    name: ($event.target as HTMLInputElement).value,
                  }
                "
              />
            </div>
            <div class="pm__stat-chips">
              <span class="pm__chip">{{ stats.on }}/{{ stats.order }} 启用</span>
              <span class="pm__chip">{{ stats.blocks }} 提示块</span>
              <span class="pm__chip">{{ stats.regex }} 正则</span>
              <span v-if="orderDirty" class="pm__chip pm__chip--warn">顺序未保存</span>
            </div>
          </div>
          <div class="pm__bar-actions">
            <button type="button" class="btn btn-ghost" @click="closeEdit">取消</button>
            <button type="button" class="btn btn-primary" @click="saveEdit">保存心法</button>
            <button type="button" class="btn btn-ghost btn-sm" @click="emit('close')">
              退出
            </button>
          </div>
        </header>

        <p v-if="toastMsg" class="pm__toast">{{ toastMsg }}</p>

        <nav class="pm__tabs" aria-label="工坊分区">
          <button
            v-for="t in TABS"
            :key="t.id"
            type="button"
            class="pm__tab"
            :class="{ 'is-on': editorTab === t.id }"
            @click="editorTab = t.id"
          >
            {{ t.label }}
          </button>
          <div v-if="orderGroups.length > 1" class="pm__groups">
            <span>角色组</span>
            <button
              v-for="g in orderGroups"
              :key="g.character_id"
              type="button"
              class="pm__group"
              :class="{ 'is-on': editing.settings?._active_character_id === g.character_id }"
              @click="switchGroup(g.character_id)"
            >
              {{ g.character_id }}
            </button>
          </div>
        </nav>

        <div class="pm__work">
          <!-- 顺序 -->
          <div v-if="editorTab === 'order'" class="pm__split">
            <aside class="pm__side">
              <div class="pm__side-bar">
                <input v-model="listFilter" class="pm__search" placeholder="搜索…" />
                <label class="pm__check">
                  <input v-model="onlyEnabled" type="checkbox" />
                  仅启用
                </label>
                <button type="button" class="btn btn-soft btn-sm" @click="addCustom">+ 块</button>
              </div>
              <div class="pm__side-list">
                <button
                  v-for="row in visibleOrder"
                  :key="row.identifier + '-' + row.index"
                  type="button"
                  class="pm__row"
                  :class="[
                    `pm__row--${row.kind}`,
                    {
                      'is-sel': selectedId === row.identifier,
                      'is-off': row.enabled === false,
                    },
                  ]"
                  @click="selectRow(row.identifier)"
                >
                  <span class="pm__num">{{ row.index + 1 }}</span>
                  <span class="pm__row-body">
                    <span class="pm__row-title">{{ row.title }}</span>
                    <span class="pm__row-sub">
                      {{ kindText(row.kind) }}
                      <template v-if="row.enabled === false"> · 停用</template>
                      <template v-if="row.chars"> · {{ row.chars }}字</template>
                    </span>
                  </span>
                </button>
                <p v-if="!visibleOrder.length" class="pm__hint">无匹配项</p>
              </div>
            </aside>

            <section class="pm__detail">
              <template v-if="selectedItem">
                <h2>{{ titleOf(selectedItem) }}</h2>
                <code class="pm__id">{{ selectedItem.identifier }}</code>
                <p class="pm__preview">{{ previewOf(selectedItem.identifier) }}</p>
                <div class="pm__actions">
                  <button type="button" class="btn btn-ghost" @click="moveSelected(-1)">
                    ↑ 上移
                  </button>
                  <button type="button" class="btn btn-ghost" @click="moveSelected(1)">
                    ↓ 下移
                  </button>
                  <button type="button" class="btn btn-soft" @click="toggleSelected">
                    {{ selectedItem.enabled === false ? '启用' : '停用' }}
                  </button>
                  <button
                    type="button"
                    class="btn btn-primary"
                    @click="goEditContent(selectedItem.identifier)"
                  >
                    编辑正文
                  </button>
                </div>
              </template>
              <p v-else class="pm__hint">点左侧一行查看详情</p>
            </section>
          </div>

          <!-- 正文 -->
          <div v-else-if="editorTab === 'prompts'" class="pm__split">
            <aside class="pm__side">
              <div class="pm__side-bar">
                <input v-model="listFilter" class="pm__search" placeholder="搜索块…" />
                <button type="button" class="btn btn-soft btn-sm" @click="addCustom">+</button>
              </div>
              <div class="pm__side-list">
                <button
                  v-for="(pr, i) in filteredPrompts"
                  :key="pr.identifier"
                  type="button"
                  class="pm__row"
                  :class="{
                    'is-sel': selectedId === pr.identifier,
                    'is-off': pr.enabled === false,
                  }"
                  @click="selectRow(pr.identifier)"
                >
                  <span class="pm__num">{{ i + 1 }}</span>
                  <span class="pm__row-body">
                    <span class="pm__row-title">{{ pr.name || pr.identifier.slice(0, 16) }}</span>
                    <span class="pm__row-sub">
                      {{ pr.role || 'system' }} · {{ (pr.content || '').length }}字
                    </span>
                  </span>
                </button>
              </div>
            </aside>

            <section class="pm__detail pm__detail--editor">
              <template v-if="selectedPrompt">
                <div class="pm__form-row">
                  <label>
                    名称
                    <input
                      class="pm__input"
                      :value="selectedPrompt.name || ''"
                      @input="
                        patchPrompt(selectedPrompt.identifier, {
                          name: ($event.target as HTMLInputElement).value,
                        })
                      "
                    />
                  </label>
                  <label>
                    角色
                    <select
                      class="pm__input"
                      :value="selectedPrompt.role || 'system'"
                      @change="
                        patchPrompt(selectedPrompt.identifier, {
                          role: ($event.target as HTMLSelectElement).value,
                        })
                      "
                    >
                      <option value="system">system</option>
                      <option value="user">user</option>
                      <option value="assistant">assistant</option>
                    </select>
                  </label>
                  <label class="pm__check pm__check--tall">
                    <input
                      type="checkbox"
                      :checked="selectedPrompt.enabled !== false"
                      @change="
                        patchPrompt(selectedPrompt.identifier, {
                          enabled: ($event.target as HTMLInputElement).checked,
                        })
                      "
                    />
                    启用
                  </label>
                  <button type="button" class="btn btn-danger btn-sm" @click="removeSelectedPrompt">
                    删除
                  </button>
                </div>
                <div class="pm__editor-label">
                  <span>正文</span>
                  <span>{{ (selectedPrompt.content || '').length }} 字</span>
                </div>
                <textarea
                  ref="contentEl"
                  class="pm__textarea"
                  spellcheck="false"
                  :value="selectedPrompt.content || ''"
                  placeholder="在此编写提示内容…"
                  @input="
                    patchPrompt(selectedPrompt.identifier, {
                      content: ($event.target as HTMLTextAreaElement).value,
                    })
                  "
                />
              </template>
              <p v-else class="pm__hint">选择左侧提示块</p>
            </section>
          </div>

          <!-- 采样 -->
          <div v-else-if="editorTab === 'sample'" class="pm__sample">
            <label class="pm__sample-row">
              <span>模型 <small>空则用密匣</small></span>
              <input
                class="pm__input"
                :value="String(sampleGet('openai_model', ''))"
                @input="sampleSet('openai_model', ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label class="pm__sample-row">
              <span>温度 <small>{{ sampleGet('temp_openai', 0.8) }}</small></span>
              <div class="pm__range">
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.05"
                  :value="Number(sampleGet('temp_openai', 0.8))"
                  @input="
                    sampleSet('temp_openai', Number(($event.target as HTMLInputElement).value))
                  "
                />
                <input
                  class="pm__input pm__input--num"
                  type="number"
                  step="0.05"
                  :value="Number(sampleGet('temp_openai', 0.8))"
                  @input="
                    sampleSet('temp_openai', Number(($event.target as HTMLInputElement).value))
                  "
                />
              </div>
            </label>
            <label class="pm__sample-row">
              <span>最大输出 tokens</span>
              <input
                class="pm__input"
                type="number"
                :value="Number(sampleGet('openai_max_tokens', 2048))"
                @input="
                  sampleSet(
                    'openai_max_tokens',
                    Number(($event.target as HTMLInputElement).value) || 2048,
                  )
                "
              />
            </label>
            <label class="pm__sample-row">
              <span>上下文窗口</span>
              <input
                class="pm__input"
                type="number"
                :value="Number(sampleGet('openai_max_context', 8192))"
                @input="
                  sampleSet(
                    'openai_max_context',
                    Number(($event.target as HTMLInputElement).value) || 8192,
                  )
                "
              />
            </label>
            <label class="pm__sample-row">
              <span>Top P <small>{{ sampleGet('top_p_openai', 0.9) }}</small></span>
              <div class="pm__range">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  :value="Number(sampleGet('top_p_openai', 0.9))"
                  @input="
                    sampleSet('top_p_openai', Number(($event.target as HTMLInputElement).value))
                  "
                />
                <input
                  class="pm__input pm__input--num"
                  type="number"
                  step="0.01"
                  :value="Number(sampleGet('top_p_openai', 0.9))"
                  @input="
                    sampleSet('top_p_openai', Number(($event.target as HTMLInputElement).value))
                  "
                />
              </div>
            </label>
            <label class="pm__sample-row">
              <span>Top K</span>
              <input
                class="pm__input"
                type="number"
                :value="Number(sampleGet('top_k_openai', 0))"
                @input="
                  sampleSet('top_k_openai', Number(($event.target as HTMLInputElement).value) || 0)
                "
              />
            </label>
            <label class="pm__sample-row">
              <span>Min P</span>
              <input
                class="pm__input"
                type="number"
                step="0.01"
                :value="Number(sampleGet('min_p_openai', 0))"
                @input="
                  sampleSet('min_p_openai', Number(($event.target as HTMLInputElement).value) || 0)
                "
              />
            </label>
            <label class="pm__sample-row">
              <span>Frequency Penalty <small>{{ sampleGet('freq_pen_openai', 0) }}</small></span>
              <div class="pm__range">
                <input
                  type="range"
                  min="-2"
                  max="2"
                  step="0.05"
                  :value="Number(sampleGet('freq_pen_openai', 0))"
                  @input="
                    sampleSet('freq_pen_openai', Number(($event.target as HTMLInputElement).value))
                  "
                />
                <input
                  class="pm__input pm__input--num"
                  type="number"
                  step="0.05"
                  :value="Number(sampleGet('freq_pen_openai', 0))"
                  @input="
                    sampleSet('freq_pen_openai', Number(($event.target as HTMLInputElement).value))
                  "
                />
              </div>
            </label>
            <label class="pm__sample-row">
              <span>Presence Penalty <small>{{ sampleGet('pres_pen_openai', 0) }}</small></span>
              <div class="pm__range">
                <input
                  type="range"
                  min="-2"
                  max="2"
                  step="0.05"
                  :value="Number(sampleGet('pres_pen_openai', 0))"
                  @input="
                    sampleSet('pres_pen_openai', Number(($event.target as HTMLInputElement).value))
                  "
                />
                <input
                  class="pm__input pm__input--num"
                  type="number"
                  step="0.05"
                  :value="Number(sampleGet('pres_pen_openai', 0))"
                  @input="
                    sampleSet('pres_pen_openai', Number(($event.target as HTMLInputElement).value))
                  "
                />
              </div>
            </label>
            <label class="pm__sample-row">
              <span>Repetition Penalty</span>
              <input
                class="pm__input"
                type="number"
                step="0.01"
                :value="Number(sampleGet('repetition_penalty_openai', 1))"
                @input="
                  sampleSet(
                    'repetition_penalty_openai',
                    Number(($event.target as HTMLInputElement).value) || 1,
                  )
                "
              />
            </label>
          </div>

          <!-- 正则 -->
          <div v-else class="pm__regex">
            <p class="pm__hint">promptOnly 进请求 · markdownOnly 只影响展示</p>
            <ul v-if="regexScripts.length" class="pm__regex-list">
              <li v-for="(sc, i) in regexScripts" :key="i" class="pm__regex-item">
                <div>
                  <strong>{{ sc.scriptName || sc.id || `脚本 ${i + 1}` }}</strong>
                  <p>
                    {{ sc.disabled ? '禁用' : '启用' }} ·
                    {{
                      sc.markdownOnly ? '展示' : sc.promptOnly ? '提示' : '通用'
                    }}
                  </p>
                  <p class="pm__regex-find">{{ String(sc.findRegex || '').slice(0, 120) }}</p>
                </div>
                <button type="button" class="btn btn-soft" @click="toggleRegex(i)">
                  {{ sc.disabled ? '启用' : '禁用' }}
                </button>
              </li>
            </ul>
            <p v-else class="pm__hint">导入含 regex_scripts 的预设后显示于此</p>
          </div>
        </div>
      </template>
    </div>
  </Teleport>
</template>


<style scoped>
/* 全屏工坊 · 月白云雾气质，非粗暴白板 */
.pm {
  position: fixed;
  inset: 0;
  z-index: 500;
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--ink-primary);
  font-family: var(--font-body);
  animation: pm-in 0.32s var(--ease-out, ease);
}

@keyframes pm-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.pm__atmosphere {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background:
    radial-gradient(ellipse 90% 70% at 12% -10%, rgba(91, 141, 239, 0.16), transparent 55%),
    radial-gradient(ellipse 70% 55% at 100% 10%, rgba(123, 107, 176, 0.1), transparent 50%),
    radial-gradient(ellipse 60% 40% at 50% 100%, rgba(90, 154, 150, 0.08), transparent 55%),
    linear-gradient(165deg, #e8eef7 0%, #f3f6fb 42%, #e9eef6 100%);
}

.pm > *:not(.pm__atmosphere) {
  position: relative;
  z-index: 1;
}

/* 顶栏 · 玻璃 */
.pm__bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.85rem 1.5rem;
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(16px) saturate(1.2);
  border-bottom: 1px solid var(--border-subtle);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.6) inset;
}

.pm__bar--edit {
  padding: 0.7rem 1.15rem;
}

.pm__brand {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

.pm__mark {
  width: 2.35rem;
  height: 2.35rem;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: linear-gradient(145deg, rgba(91, 141, 239, 0.2), rgba(123, 107, 176, 0.12));
  color: var(--moon-deep);
  font-size: 1rem;
  border: 1px solid var(--border-moon);
  flex-shrink: 0;
}

.pm__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.3rem;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.pm__sub {
  margin: 0.15rem 0 0;
  font-size: 0.8rem;
  color: var(--ink-muted);
}

.pm__bar-actions,
.pm__bar-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  min-width: 0;
}

.pm__name-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}

.pm__name-label {
  font-size: 0.68rem;
  color: var(--ink-muted);
  letter-spacing: 0.04em;
  padding-left: 0.35rem;
}

.pm__name {
  border: 1px solid transparent;
  background: rgba(255, 255, 255, 0.5);
  font-family: var(--font-display);
  font-size: 1.1rem;
  font-weight: 600;
  padding: 0.3rem 0.55rem;
  border-radius: 10px;
  min-width: 140px;
  max-width: min(34vw, 300px);
  color: var(--ink-primary);
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
}

.pm__name:hover {
  border-color: var(--border-medium);
  background: #fff;
}

.pm__name:focus {
  outline: none;
  border-color: var(--border-moon);
  background: #fff;
  box-shadow: 0 0 0 3px var(--moon-glow);
}

.pm__stat-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-left: 0.35rem;
}

.pm__chip {
  font-size: 0.72rem;
  font-weight: 600;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.75);
  border: 1px solid var(--border-subtle);
  color: var(--ink-secondary);
}

.pm__chip--warn {
  background: var(--amber-soft);
  border-color: rgba(196, 149, 74, 0.3);
  color: var(--amber);
}

.pm__toast {
  flex-shrink: 0;
  margin: 0;
  padding: 0.5rem 1rem;
  text-align: center;
  background: linear-gradient(90deg, transparent, var(--jade-soft), transparent);
  color: var(--jade);
  font-size: 0.85rem;
  font-weight: 500;
}

/* 列表区 */
.pm__scroll {
  flex: 1;
  overflow: auto;
  padding: 1.5rem 1.75rem 2.5rem;
}

.pm__list-wrap {
  max-width: 880px;
  margin: 0 auto;
}

.pm__list-head {
  margin-bottom: 1.1rem;
}

.pm__list-head h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.15rem;
  font-weight: 600;
}

.pm__list-head p {
  margin: 0.25rem 0 0;
  font-size: 0.82rem;
  color: var(--ink-muted);
}

.pm__cards {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.pm__card {
  display: flex;
  align-items: stretch;
  gap: 0;
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(12px);
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  overflow: hidden;
  box-shadow: var(--shadow-sm);
  transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s;
}

.pm__card:hover {
  border-color: var(--border-medium);
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}

.pm__card.is-on {
  border-color: var(--border-moon);
  box-shadow: var(--shadow-glow);
}

.pm__card-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.9rem;
  padding: 1rem 1.15rem;
  appearance: none;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  color: inherit;
}

.pm__card-glyph {
  width: 2.6rem;
  height: 2.6rem;
  border-radius: 12px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  font-family: var(--font-display);
  font-size: 0.95rem;
  color: var(--moon-deep);
  background: linear-gradient(145deg, rgba(91, 141, 239, 0.14), rgba(180, 200, 230, 0.2));
  border: 1px solid var(--border-subtle);
}

.pm__card-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.pm__card-name {
  font-size: 1.05rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex-wrap: wrap;
}

.pm__card-meta {
  font-size: 0.8rem;
  color: var(--ink-muted);
}

.pm__card-go {
  flex-shrink: 0;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--moon-deep);
  opacity: 0.75;
}

.pm__card-main:hover .pm__card-go {
  opacity: 1;
}

.pm__card-actions {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0.3rem;
  padding: 0.65rem 0.85rem 0.65rem 0;
  border-left: 1px solid var(--border-subtle);
  background: rgba(247, 249, 252, 0.65);
  min-width: 5.5rem;
}

.pm__card-actions .btn {
  width: 100%;
  justify-content: center;
}

.pm__badge {
  font-size: 0.68rem;
  font-weight: 600;
  padding: 0.12rem 0.45rem;
  border-radius: 999px;
  background: var(--jade-soft);
  color: var(--jade);
}

.pm__empty {
  text-align: center;
  padding: 3.5rem 1.5rem;
  background: rgba(255, 255, 255, 0.55);
  border: 1px dashed var(--border-medium);
  border-radius: 18px;
  color: var(--ink-muted);
}

.pm__empty-icon {
  width: 3rem;
  height: 3rem;
  margin: 0 auto 0.85rem;
  border-radius: 14px;
  display: grid;
  place-items: center;
  background: var(--moon-glow);
  color: var(--moon-deep);
  border: 1px solid var(--border-moon);
}

.pm__empty p {
  margin: 0 0 0.35rem;
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--ink-secondary);
}

.pm__empty span {
  display: block;
  margin-bottom: 1.1rem;
  font-size: 0.85rem;
}

/* Tabs */
.pm__tabs {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.4rem 1.15rem 0;
  background: rgba(255, 255, 255, 0.45);
  border-bottom: 1px solid var(--border-subtle);
}

.pm__tab {
  appearance: none;
  border: none;
  background: transparent;
  padding: 0.65rem 1.1rem 0.75rem;
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--ink-muted);
  cursor: pointer;
  font-family: inherit;
  position: relative;
  border-radius: 10px 10px 0 0;
  transition: color 0.15s, background 0.15s;
}

.pm__tab:hover {
  color: var(--ink-primary);
  background: rgba(255, 255, 255, 0.5);
}

.pm__tab.is-on {
  color: var(--moon-deep);
  font-weight: 600;
  background: rgba(255, 255, 255, 0.85);
}

.pm__tab.is-on::after {
  content: '';
  position: absolute;
  left: 18%;
  right: 18%;
  bottom: 0;
  height: 2px;
  border-radius: 2px;
  background: linear-gradient(90deg, var(--moon), var(--moon-soft));
}

.pm__groups {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.75rem;
  color: var(--ink-muted);
  padding-bottom: 0.35rem;
}

.pm__group {
  appearance: none;
  border: 1px solid var(--border-subtle);
  background: rgba(255, 255, 255, 0.7);
  border-radius: 999px;
  padding: 0.2rem 0.55rem;
  font-size: 0.75rem;
  cursor: pointer;
  font-family: inherit;
}

.pm__group.is-on {
  border-color: var(--border-moon);
  background: var(--moon-glow);
  color: var(--moon-deep);
}

/* Work area */
.pm__work {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0.75rem 0.85rem 0.85rem;
}

.pm__split {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(260px, 300px) 1fr;
  gap: 0.75rem;
  overflow: hidden;
}

.pm__side {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: rgba(255, 255, 255, 0.78);
  backdrop-filter: blur(12px);
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

.pm__side-bar {
  display: flex;
  gap: 0.4rem;
  align-items: center;
  padding: 0.6rem 0.65rem;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
  background: rgba(247, 249, 252, 0.8);
}

.pm__search {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border-medium);
  border-radius: 10px;
  padding: 0.4rem 0.6rem;
  font-size: 0.85rem;
  font-family: inherit;
  background: #fff;
}

.pm__search:focus {
  outline: none;
  border-color: var(--border-moon);
  box-shadow: 0 0 0 3px var(--moon-glow);
}

.pm__check {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.78rem;
  color: var(--ink-secondary);
  white-space: nowrap;
  cursor: pointer;
}

.pm__check--tall {
  height: 38px;
}

.pm__side-list {
  flex: 1;
  overflow: auto;
  padding: 0.4rem;
}

.pm__row {
  width: 100%;
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
  text-align: left;
  appearance: none;
  border: 1px solid transparent;
  background: transparent;
  border-radius: 12px;
  padding: 0.65rem 0.55rem;
  cursor: pointer;
  font-family: inherit;
  margin-bottom: 0.15rem;
  color: var(--ink-primary);
  transition: background 0.15s, border-color 0.15s;
}

.pm__row:hover {
  background: var(--bg-mist);
}

.pm__row.is-sel {
  background: rgba(91, 141, 239, 0.1);
  border-color: var(--border-moon);
}

.pm__row.is-off {
  opacity: 0.48;
}

.pm__row.is-off .pm__row-title {
  text-decoration: line-through;
  text-decoration-color: rgba(120, 145, 180, 0.4);
}

.pm__row--history {
  border-left: 3px solid var(--violet);
}
.pm__row--world {
  border-left: 3px solid var(--jade);
}
.pm__row--custom {
  border-left: 3px solid var(--amber);
}
.pm__row--system {
  border-left: 3px solid var(--moon);
}

.pm__num {
  flex-shrink: 0;
  width: 1.6rem;
  height: 1.6rem;
  border-radius: 50%;
  background: rgba(180, 200, 230, 0.25);
  font-size: 0.75rem;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-secondary);
}

.pm__row.is-sel .pm__num {
  background: var(--moon);
  color: #fff;
}

.pm__row-body {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
}

.pm__row-title {
  font-size: 0.9rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pm__row-sub {
  font-size: 0.72rem;
  color: var(--ink-muted);
}

.pm__detail {
  min-height: 0;
  overflow: auto;
  padding: 1.35rem 1.5rem;
  background: rgba(255, 255, 255, 0.78);
  backdrop-filter: blur(12px);
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  box-shadow: var(--shadow-sm);
}

.pm__detail h2 {
  margin: 0 0 0.3rem;
  font-family: var(--font-display);
  font-size: 1.35rem;
  font-weight: 600;
}

.pm__id {
  font-size: 0.75rem;
  color: var(--ink-muted);
  word-break: break-all;
}

.pm__preview {
  margin: 1rem 0;
  padding: 1rem 1.1rem;
  border-radius: 12px;
  background: linear-gradient(180deg, #fafbfd, #f4f7fb);
  border: 1px solid var(--border-subtle);
  font-size: 0.92rem;
  line-height: 1.7;
  color: var(--ink-secondary);
  min-height: 5.5rem;
}

.pm__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.pm__detail--editor {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.pm__form-row {
  display: grid;
  grid-template-columns: 1.4fr 0.8fr auto auto;
  gap: 0.6rem;
  align-items: end;
  margin-bottom: 0.75rem;
  flex-shrink: 0;
}

.pm__form-row label {
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
  font-size: 0.75rem;
  color: var(--ink-secondary);
}

.pm__input {
  border: 1px solid var(--border-medium);
  border-radius: 10px;
  padding: 0.48rem 0.65rem;
  font-size: 0.9rem;
  font-family: inherit;
  background: #fff;
  width: 100%;
}

.pm__input:focus {
  outline: none;
  border-color: var(--border-moon);
  box-shadow: 0 0 0 3px var(--moon-glow);
}

.pm__input--num {
  width: 5rem;
  flex-shrink: 0;
}

.pm__editor-label {
  display: flex;
  justify-content: space-between;
  font-size: 0.78rem;
  color: var(--ink-secondary);
  margin-bottom: 0.4rem;
  flex-shrink: 0;
}

.pm__textarea {
  flex: 1;
  min-height: 0;
  width: 100%;
  border: 1px solid var(--border-medium);
  border-radius: 12px;
  padding: 1rem 1.15rem;
  font-family: ui-monospace, 'Cascadia Code', 'Sarasa Mono SC', Consolas, monospace;
  font-size: 0.92rem;
  line-height: 1.65;
  resize: none;
  background: #fff;
  color: var(--ink-primary);
  box-shadow: inset 0 1px 2px rgba(40, 60, 100, 0.03);
}

.pm__textarea:focus {
  outline: none;
  border-color: var(--border-moon);
  box-shadow: 0 0 0 3px var(--moon-glow);
}

.pm__sample {
  flex: 1;
  overflow: auto;
  padding: 0.25rem 0.5rem 1rem;
  max-width: 820px;
  width: 100%;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.pm__sample-row {
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: 1rem;
  align-items: center;
  padding: 0.85rem 1.05rem;
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid var(--border-subtle);
  border-radius: 14px;
  font-size: 0.9rem;
  font-weight: 600;
  box-shadow: var(--shadow-sm);
}

.pm__sample-row small {
  font-weight: 400;
  color: var(--ink-muted);
  margin-left: 0.35rem;
}

.pm__range {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}

.pm__range input[type='range'] {
  flex: 1;
  accent-color: var(--moon);
}

.pm__regex {
  flex: 1;
  overflow: auto;
  padding: 0.25rem 0.5rem 1rem;
  max-width: 920px;
  width: 100%;
  margin: 0 auto;
}

.pm__hint {
  margin: 0;
  color: var(--ink-muted);
  font-size: 0.88rem;
  text-align: center;
  padding: 2rem 1rem;
}

.pm__regex > .pm__hint {
  text-align: left;
  padding: 0 0 0.85rem;
}

.pm__regex-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.pm__regex-item {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.95rem 1.1rem;
  background: rgba(255, 255, 255, 0.85);
  border: 1px solid var(--border-subtle);
  border-radius: 14px;
  box-shadow: var(--shadow-sm);
}

.pm__regex-item p {
  margin: 0.25rem 0 0;
  font-size: 0.8rem;
  color: var(--ink-muted);
}

.pm__regex-find {
  word-break: break-all;
  font-size: 0.76rem !important;
}

@media (max-width: 900px) {
  .pm__split {
    grid-template-columns: 1fr;
  }
  .pm__side {
    max-height: 36vh;
  }
  .pm__sample-row {
    grid-template-columns: 1fr;
  }
  .pm__form-row {
    grid-template-columns: 1fr 1fr;
  }
  .pm__bar {
    flex-wrap: wrap;
  }
  .pm__card {
    flex-direction: column;
  }
  .pm__card-actions {
    flex-direction: row;
    border-left: none;
    border-top: 1px solid var(--border-subtle);
    padding: 0.55rem 0.85rem;
  }
  .pm__card-actions .btn {
    width: auto;
  }
}
</style>
