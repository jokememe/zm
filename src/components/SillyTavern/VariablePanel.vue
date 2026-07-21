<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import ModalFrame from '@/components/ui/ModalFrame.vue'
import { useTianji } from '@/composables/useTianji'
import {
  WRITABLE_VAR_NAMES,
  READONLY_VAR_KEYS,
  snapshotGameVariables,
} from '@/composables/game-bridge'
import './st-shared.css'

const props = defineProps<{
  /** 内嵌面板（非弹窗） */
  embedded?: boolean
}>()

const emit = defineEmits<{ close: [] }>()

const { sessionVariables, setSessionVariables, showVariables } = useTianji()

const draft = ref<Record<string, string>>({})
const saving = ref(false)

const open = computed({
  get: () => (props.embedded ? true : showVariables.value),
  set: (v: boolean) => {
    if (!props.embedded) showVariables.value = v
    if (!v) emit('close')
  },
})

function loadDraft() {
  const base = { ...snapshotGameVariables(), ...sessionVariables.value }
  draft.value = Object.fromEntries(
    Object.entries(base).map(([k, v]) => [k, String(v)]),
  )
}

watch(
  () => open.value,
  (v) => {
    if (v) loadDraft()
  },
  { immediate: true },
)

const writableRows = computed(() =>
  WRITABLE_VAR_NAMES.map((name) => ({
    name,
    value: draft.value[name] ?? '',
    writable: true,
  })),
)

const readonlyRows = computed(() =>
  READONLY_VAR_KEYS.map((name) => ({
    name,
    value: draft.value[name] ?? '',
    writable: false,
  })),
)

const extraKeys = computed(() => {
  const known = new Set<string>([...WRITABLE_VAR_NAMES, ...READONLY_VAR_KEYS])
  return Object.keys(draft.value).filter((k) => !known.has(k) && k.trim())
})

async function save() {
  saving.value = true
  try {
    const updates: Record<string, string | number> = {}
    for (const [k, v] of Object.entries(draft.value)) {
      if (!k.trim()) continue
      const num = Number(v)
      updates[k.trim()] = Number.isNaN(num) ? v : num
    }
    // 相对写法保留字符串
    for (const name of WRITABLE_VAR_NAMES) {
      const raw = draft.value[name]
      if (raw != null && /^[+-]\d+/.test(String(raw).trim())) {
        updates[name] = String(raw).trim()
      }
    }
    await setSessionVariables(updates)
    if (!props.embedded) open.value = false
  } finally {
    saving.value = false
  }
}

function addExtra() {
  draft.value = { ...draft.value, 自定义: '' }
}
</script>

<template>
  <!-- 内嵌条 -->
  <div v-if="embedded" class="qi-embed">
    <div class="qi-embed__head">
      <strong>气数簿</strong>
      <span class="tj-hint">改写后同步顶栏资源</span>
      <button type="button" class="btn btn-primary btn-sm" :disabled="saving" @click="save">
        {{ saving ? '结算中…' : '结算' }}
      </button>
    </div>
    <div class="qi-grid">
      <label v-for="row in writableRows" :key="row.name" class="qi-cell">
        <span>{{ row.name }}</span>
        <input v-model="draft[row.name]" class="tj-input" />
      </label>
    </div>
    <p class="tj-hint">支持相对值如 <code>-30</code> / <code>+100</code></p>
  </div>

  <!-- 弹窗 -->
  <ModalFrame
    v-else-if="open"
    id="modal-qi-shu"
    title="气数簿"
    subtitle="灵石声望等写入经营；年季宗门只读"
    width="560px"
    @close="open = false"
  >
    <div class="qi-grid">
      <label v-for="row in writableRows" :key="row.name" class="qi-cell">
        <span>{{ row.name }}</span>
        <input v-model="draft[row.name]" class="tj-input" />
      </label>
    </div>
    <p class="tj-hint" style="margin: 0.75rem 0 0.35rem">只读（历法 / 称谓）</p>
    <div class="qi-grid qi-grid--muted">
      <label v-for="row in readonlyRows" :key="row.name" class="qi-cell">
        <span>{{ row.name }}</span>
        <input class="tj-input" :value="row.value" disabled />
      </label>
    </div>
    <template v-if="extraKeys.length">
      <p class="tj-hint" style="margin: 0.75rem 0 0.35rem">其它会话变量</p>
      <div class="qi-grid">
        <label v-for="k in extraKeys" :key="k" class="qi-cell">
          <span>{{ k }}</span>
          <input v-model="draft[k]" class="tj-input" />
        </label>
      </div>
    </template>
    <div class="tj-row" style="margin-top: 0.75rem">
      <button type="button" class="btn btn-ghost btn-sm" @click="addExtra">+ 自定义键</button>
    </div>

    <template #footer>
      <button type="button" class="btn btn-ghost" @click="open = false">取消</button>
      <button type="button" class="btn btn-primary" :disabled="saving" @click="save">
        {{ saving ? '结算中…' : '写入并结算' }}
      </button>
    </template>
  </ModalFrame>
</template>

<style scoped>
.qi-embed {
  padding: 0.75rem 0.9rem;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  margin-bottom: 0.85rem;
}

.qi-embed__head {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  margin-bottom: 0.65rem;
}

.qi-embed__head strong {
  font-family: var(--font-display);
  font-size: 0.95rem;
}

.qi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 0.55rem;
}

.qi-grid--muted {
  opacity: 0.85;
}

.qi-cell {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.75rem;
  color: var(--ink-secondary);
}

.qi-cell .tj-input {
  font-size: 0.88rem;
}
</style>
