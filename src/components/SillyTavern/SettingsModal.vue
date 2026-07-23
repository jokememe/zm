<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import ModalFrame from '@/components/ui/ModalFrame.vue'
import {
  DEFAULT_FORMAT_PROMPT,
  fetchModels,
  testConnection,
  diagnoseBrowserApiBlock,
  exportAllData,
  importAllData,
  clearAllData,
  getActiveStorageInfo,
  findLegacySharedDatabases,
  type AppSettings,
} from '@/sillytavern'
import './st-shared.css'

const props = defineProps<{
  settings: AppSettings
  updateSettings?: (partial: Partial<AppSettings>) => void | Promise<void>
}>()

const emit = defineEmits<{
  close: []
  reloaded: []
}>()

const toastMsg = ref<string | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | null = null
function showToast(message: string) {
  toastMsg.value = message
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toastMsg.value = null
  }, 2200)
}

async function updateSettings(partial: Partial<AppSettings>) {
  if (props.updateSettings) {
    await props.updateSettings(partial)
    return
  }
  const { saveSettings } = await import('@/sillytavern')
  await saveSettings({ ...props.settings, ...partial, key: 'settings' } as AppSettings)
}

const tabs = [
  { id: 'primary', label: '主 API' },
  { id: 'secondary', label: '次 API' },
  { id: 'tags', label: '称谓' },
  { id: 'prompt', label: '格式' },
  { id: 'display', label: '显示' },
  { id: 'backup', label: '备份' },
] as const

type TabId = (typeof tabs)[number]['id']
const tab = ref<TabId>('primary')
const busy = ref<string | null>(null)
const primaryModels = ref<string[]>([])
const secondaryModels = ref<string[]>([])
const storageInfo = getActiveStorageInfo()
const legacySharedDbs = ref<string[]>([])
const allowCrossAppImport = ref(false)
const saveHint = ref('')

/** 本地草稿：输入可随时改，不依赖异步 props 回写 */
const draftPrimary = reactive({
  baseUrl: '',
  apiKey: '',
  model: '',
  timeout: 60000,
  stream: false,
})
const draftSecondary = reactive({
  enabled: false,
  baseUrl: '',
  apiKey: '',
  model: '',
  temperature: 0.7,
  maxTokens: 8000,
})

function pullDraftFromProps() {
  const api = props.settings.api
  draftPrimary.baseUrl = api.baseUrl ?? ''
  draftPrimary.apiKey = api.apiKey ?? ''
  draftPrimary.model = api.model ?? ''
  draftPrimary.timeout = api.timeout ?? 60000
  draftPrimary.stream = !!api.stream
  const sec = api.secondary
  draftSecondary.enabled = !!sec?.enabled
  draftSecondary.baseUrl = sec?.baseUrl ?? ''
  draftSecondary.apiKey = sec?.apiKey ?? ''
  draftSecondary.model = sec?.model ?? ''
  draftSecondary.temperature = sec?.temperature ?? 0.7
  draftSecondary.maxTokens = sec?.maxTokens ?? 8000
}

onMounted(async () => {
  pullDraftFromProps()
  legacySharedDbs.value = await findLegacySharedDatabases()
})

// 注意：不要在输入过程中用 props 覆盖草稿（会表现为「填不了 / 写死」）
// 密匣用 v-if 打开，每次 onMounted 已 pullDraftFromProps

const secondary = computed(
  () =>
    props.settings.api.secondary ?? {
      enabled: false,
      baseUrl: '',
      apiKey: '',
      model: '',
      temperature: 0.7,
      maxTokens: 8000,
    },
)

function patch(partial: Partial<AppSettings>) {
  void updateSettings(partial)
}

/** 把主 API 草稿写入全局设置（内存 + 尽量落库） */
async function flushPrimary() {
  saveHint.value = '保存中…'
  try {
    await updateSettings({
      api: {
        ...props.settings.api,
        baseUrl: draftPrimary.baseUrl.trim(),
        apiKey: draftPrimary.apiKey.trim(),
        model: draftPrimary.model.trim(),
        timeout: Number(draftPrimary.timeout) || 60000,
        stream: draftPrimary.stream,
        secondary: {
          ...secondary.value,
          enabled: draftSecondary.enabled,
          baseUrl: draftSecondary.baseUrl.trim(),
          apiKey: draftSecondary.apiKey.trim(),
          model: draftSecondary.model.trim(),
          temperature: draftSecondary.temperature,
          maxTokens: draftSecondary.maxTokens,
        },
      },
    })
    saveHint.value = '已保存'
    showToast('主 API 已保存')
  } catch (e) {
    saveHint.value = '保存失败'
    showToast('保存失败：' + ((e as Error).message || String(e)))
  }
}

async function flushSecondary() {
  saveHint.value = '保存中…'
  try {
    const nextSec = {
      enabled: draftSecondary.enabled,
      baseUrl: draftSecondary.baseUrl.trim(),
      apiKey: draftSecondary.apiKey.trim(),
      model: draftSecondary.model.trim(),
      temperature: draftSecondary.temperature,
      maxTokens: draftSecondary.maxTokens,
    }
    await updateSettings({
      apiMode: draftSecondary.enabled ? 'dual' : props.settings.apiMode,
      api: {
        ...props.settings.api,
        baseUrl: draftPrimary.baseUrl.trim() || props.settings.api.baseUrl,
        apiKey: draftPrimary.apiKey.trim() || props.settings.api.apiKey,
        model: draftPrimary.model.trim() || props.settings.api.model,
        secondary: nextSec,
      },
    })
    saveHint.value = '已保存'
    showToast('次 API 已保存')
  } catch (e) {
    saveHint.value = '保存失败'
    showToast('保存失败：' + ((e as Error).message || String(e)))
  }
}

function patchSecondary(partial: Partial<typeof draftSecondary>) {
  Object.assign(draftSecondary, partial)
  if (partial.enabled === true) {
    void updateSettings({ apiMode: 'dual' })
  }
  if (partial.enabled === false) {
    void updateSettings({ apiMode: 'single' })
  }
}

function copyPrimaryToSecondary() {
  draftSecondary.enabled = true
  draftSecondary.baseUrl = draftPrimary.baseUrl
  draftSecondary.apiKey = draftPrimary.apiKey
  draftSecondary.model = draftPrimary.model
  void flushSecondary()
  showToast('已从主 API 复制地址/密钥/模型，并启用次 API')
  tab.value = 'secondary'
}

const secondaryReady = computed(
  () =>
    !!draftSecondary.enabled &&
    !!draftSecondary.baseUrl.trim() &&
    !!draftSecondary.apiKey.trim() &&
    !!draftSecondary.model.trim(),
)

const primaryReady = computed(
  () =>
    !!draftPrimary.baseUrl.trim() &&
    !!draftPrimary.apiKey.trim() &&
    !!draftPrimary.model.trim(),
)

/** HTTPS 页 + HTTP API：直连不可用，提示改 HTTPS 中转 */
const primaryAccessWarn = computed(() => {
  const d = diagnoseBrowserApiBlock(draftPrimary.baseUrl)
  if (d.blocked && d.reason === 'mixed-content') return d.message
  return ''
})

const lastFetchError = ref('')
const lastFetchSource = ref<'remote' | 'fallback' | ''>('')

function pickModel(which: 'primary' | 'secondary', id: string) {
  if (which === 'primary') {
    draftPrimary.model = id
    void flushPrimary()
  } else {
    draftSecondary.model = id
    void flushSecondary()
  }
  showToast(`已选用模型：${id}`)
}

async function handleFetchModels(which: 'primary' | 'secondary') {
  // 先落盘草稿，保证用最新值拉模型
  if (which === 'primary') await flushPrimary()
  else await flushSecondary()
  busy.value = `fetch-${which}`
  lastFetchError.value = ''
  lastFetchSource.value = ''
  try {
    const target =
      which === 'primary'
        ? { baseUrl: draftPrimary.baseUrl, apiKey: draftPrimary.apiKey }
        : { baseUrl: draftSecondary.baseUrl, apiKey: draftSecondary.apiKey }
    const { models, source, error } = await fetchModels(target)
    if (which === 'primary') primaryModels.value = models
    else secondaryModels.value = models
    lastFetchSource.value = source
    if (source === 'remote') {
      showToast(`已从接口获取 ${models.length} 个模型`)
      // 若当前模型为空，自动填第一个
      if (which === 'primary' && !draftPrimary.model.trim() && models[0]) {
        draftPrimary.model = models[0]
        await flushPrimary()
      }
      if (which === 'secondary' && !draftSecondary.model.trim() && models[0]) {
        draftSecondary.model = models[0]
        await flushSecondary()
      }
    } else {
      lastFetchError.value = error || '拉取失败，以下为猜测的常用模型，可手动改名'
      showToast(`拉取失败，已给参考模型（请手动确认）`)
    }
  } catch (e) {
    lastFetchError.value = (e as Error).message || String(e)
    showToast('拉取异常')
  } finally {
    busy.value = null
  }
}

async function handleTest(which: 'primary' | 'secondary') {
  if (which === 'primary') await flushPrimary()
  else await flushSecondary()
  busy.value = `test-${which}`
  try {
    const target =
      which === 'primary'
        ? {
            baseUrl: draftPrimary.baseUrl,
            apiKey: draftPrimary.apiKey,
            model: draftPrimary.model,
          }
        : {
            baseUrl: draftSecondary.baseUrl,
            apiKey: draftSecondary.apiKey,
            model: draftSecondary.model,
          }
    const result = await testConnection(target)
    if (result.ok) {
      showToast(
        `${which === 'primary' ? '主' : '辅'}线连通` +
          (result.usedUrl ? ` · ${result.usedUrl}` : ''),
      )
    } else {
      const detail = [result.error, result.errorBody].filter(Boolean).join('\n')
      alert(`测试失败\n${detail || '未知错误'}`)
    }
  } finally {
    busy.value = null
  }
}

async function handleExport() {
  const data = await exportAllData()
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `zongmen-backup-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
  showToast('备份已导出')
}

function handleImport() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json,application/json'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      if (data?.appId && data.appId !== storageInfo.appId && !allowCrossAppImport.value) {
        const ok = confirm(
          `此备份来自「${data.appId}」，当前为「${storageInfo.appId}」。导入会覆盖本宗数据，是否继续？`,
        )
        if (!ok) return
        await importAllData(data, { allowCrossApp: true })
      } else {
        await importAllData(data, { allowCrossApp: allowCrossAppImport.value })
      }
      emit('reloaded')
      showToast('备份已导入')
    } catch (e) {
      alert(`导入失败: ${(e as Error).message}`)
    }
  }
  input.click()
}

async function handleClear() {
  if (!confirm('确定清空全部天机数据？此操作不可恢复。')) return
  await clearAllData()
  emit('reloaded')
  showToast('已清空')
}

async function handleNewGame() {
  if (
    !confirm(
      '从头开局将重置资源、历法、通知与天机会话（密匣 API/预设保留）。是否继续？',
    )
  ) {
    return
  }
  const { useGameState } = await import('@/composables/useGameState')
  const { useTianji } = await import('@/composables/useTianji')
  const gs = useGameState()
  const tj = useTianji()
  gs.resetGameToOpening()
  await tj.startOpeningRun()
  gs.replayOpening()
  emit('close')
  showToast('已重置为开局')
}

function onTagsInput(value: string) {
  const tags = value
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
  patch({ customTags: tags })
}
</script>

<template>
  <ModalFrame
    id="modal-tianji-settings"
    title="密匣"
    subtitle="主 API · 次 API · 推演格式 · 备份"
    width="760px"
    @close="emit('close')"
  >
    <p v-if="toastMsg" class="tj-toast">{{ toastMsg }}</p>

    <div class="tj-tabs">
      <button
        v-for="t in tabs"
        :key="t.id"
        type="button"
        class="tj-tab"
        :class="{ 'is-active': tab === t.id }"
        @click="tab = t.id"
      >
        {{ t.label }}
        <span
          v-if="t.id === 'primary'"
          class="tab-dot"
          :class="primaryReady ? 'is-on' : 'is-off'"
        />
        <span
          v-if="t.id === 'secondary'"
          class="tab-dot"
          :class="secondaryReady ? 'is-on' : draftSecondary.enabled ? 'is-warn' : 'is-off'"
        />
      </button>
    </div>

    <!-- 主 API -->
    <template v-if="tab === 'primary'">
      <div class="api-status-bar">
        <span class="api-pill" :class="primaryReady ? 'is-on' : 'is-off'">
          主线 {{ primaryReady ? '已配置' : '未配齐' }}
        </span>
        <span class="api-pill" :class="secondaryReady ? 'is-on' : draftSecondary.enabled ? 'is-warn' : 'is-off'">
          次线
          {{
            secondaryReady
              ? '已就绪'
              : draftSecondary.enabled
                ? '已开未配齐'
                : '未启用'
          }}
        </span>
        <span class="api-pill is-mode">
          {{ settings.apiMode === 'dual' ? '双线模式' : '单线模式' }}
        </span>
      </div>

      <div class="mode-cards">
        <button
          type="button"
          class="mode-card"
          :class="{ 'is-active': settings.apiMode === 'single' }"
          @click="patch({ apiMode: 'single' })"
        >
          <strong>单线</strong>
          <span>剧情与变量都走主 API</span>
        </button>
        <button
          type="button"
          class="mode-card"
          :class="{ 'is-active': settings.apiMode === 'dual' }"
          @click="
            () => {
              patch({ apiMode: 'dual' })
              if (!draftSecondary.enabled) patchSecondary({ enabled: true })
            }
          "
        >
          <strong>双线</strong>
          <span>剧情主 API · 变量/总结次 API</span>
        </button>
      </div>

      <div class="api-panel">
        <h3 class="api-panel__title">主 API（剧情推演）</h3>
        <p class="tj-hint">
          浏览器<strong>直连</strong>你填的地址（任意网站域名通用）。
          填到 <code>/v1</code> 为止。须使用 <strong>HTTPS</strong> 中转，并开启 CORS。
          例：<code>https://api.deepseek.com/v1</code> 或
          <code>https://llm.你的域名.com/v1</code>
        </p>
        <div v-if="primaryAccessWarn" class="api-block-banner">
          <strong>当前地址无法在 HTTPS 网页上直连</strong>
          <pre>{{ primaryAccessWarn }}</pre>
        </div>
        <div class="tj-field">
          <label>Base URL</label>
          <input
            v-model="draftPrimary.baseUrl"
            class="tj-input"
            placeholder="https://你的中转域名/v1"
            autocomplete="off"
            spellcheck="false"
            @blur="flushPrimary"
          />
        </div>
        <div class="tj-field">
          <label>API Key</label>
          <input
            v-model="draftPrimary.apiKey"
            class="tj-input"
            type="password"
            placeholder="sk-...（不会上传到本站服务器，仅存你浏览器）"
            autocomplete="off"
            @blur="flushPrimary"
          />
        </div>
        <div class="tj-field">
          <label>模型（推演时以密匣此处为准，不被心法预设覆盖）</label>
          <input
            v-model="draftPrimary.model"
            class="tj-input"
            list="tj-primary-models"
            placeholder="如 gpt-4o-mini / deepseek-chat / 本地模型名"
            autocomplete="off"
            @blur="flushPrimary"
          />
          <datalist id="tj-primary-models">
            <option v-for="m in primaryModels" :key="m" :value="m" />
          </datalist>
        </div>
        <div v-if="primaryModels.length" class="model-pick">
          <p class="model-pick__label">
            {{ lastFetchSource === 'remote' ? '接口返回（点击选用）' : '参考列表（点击选用，请核对是否真实可用）' }}
            · {{ primaryModels.length }} 个
          </p>
          <div class="model-pick__list">
            <button
              v-for="m in primaryModels.slice(0, 80)"
              :key="m"
              type="button"
              class="model-chip"
              :class="{ 'is-on': draftPrimary.model === m }"
              :title="m"
              @click="pickModel('primary', m)"
            >
              {{ m }}
            </button>
          </div>
          <p v-if="primaryModels.length > 80" class="tj-hint">仅显示前 80 个，其余可输入框搜索</p>
        </div>
        <p v-if="lastFetchError" class="model-fetch-err">{{ lastFetchError }}</p>
        <div class="tj-field">
          <label>超时（毫秒）</label>
          <input
            v-model.number="draftPrimary.timeout"
            class="tj-input"
            type="number"
            min="5000"
            step="1000"
            @blur="flushPrimary"
          />
        </div>
        <label class="tj-check">
          <input type="checkbox" v-model="draftPrimary.stream" @change="flushPrimary" />
          <span>流式输出（逐字显示，需 API 支持 SSE）</span>
        </label>
        <div class="tj-row">
          <button type="button" class="btn btn-primary btn-sm" @click="flushPrimary">
            保存主 API
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            :disabled="busy === 'fetch-primary'"
            @click="handleFetchModels('primary')"
          >
            {{ busy === 'fetch-primary' ? '拉取中…' : '拉取模型列表' }}
          </button>
          <button
            type="button"
            class="btn btn-soft btn-sm"
            :disabled="busy === 'test-primary' || !primaryReady"
            @click="handleTest('primary')"
          >
            测试主 API
          </button>
          <button type="button" class="btn btn-soft btn-sm" @click="copyPrimaryToSecondary">
            复制到次 API
          </button>
          <span v-if="saveHint" class="tj-hint" style="margin: 0">{{ saveHint }}</span>
        </div>
      </div>

      <div class="api-secondary-teaser">
        <div>
          <strong>次 API</strong>
          <p class="tj-hint" style="margin: 0.2rem 0 0">
            用于变量结算 / 总结分流，可与主线不同模型（更便宜或更快）。
          </p>
        </div>
        <button type="button" class="btn btn-soft btn-sm" @click="tab = 'secondary'">
          {{ draftSecondary.enabled ? '编辑次 API' : '配置次 API' }}
        </button>
      </div>
    </template>

    <!-- 次 API -->
    <template v-else-if="tab === 'secondary'">
      <div class="api-status-bar">
        <span class="api-pill" :class="draftSecondary.enabled ? 'is-on' : 'is-off'">
          {{ draftSecondary.enabled ? '次 API 已启用' : '次 API 未启用' }}
        </span>
        <span class="api-pill" :class="secondaryReady ? 'is-on' : 'is-warn'">
          {{ secondaryReady ? '字段已配齐' : '请补全地址 / 密钥 / 模型' }}
        </span>
      </div>

      <div class="api-panel api-panel--secondary">
        <div class="secondary-head">
          <div>
            <h3 class="api-panel__title">次 API（自动局面分析）</h3>
            <p class="tj-hint" style="margin: 0">
              每回合推演结束后，系统自动分析本回对话并改写名册/外交/城池/资源（无需你手填变量）。优先用次 API 出短 JSON；建议温度 ≤0.3。
            </p>
          </div>
          <label class="switch">
            <input
              type="checkbox"
              :checked="draftSecondary.enabled"
              @change="
                patchSecondary({ enabled: ($event.target as HTMLInputElement).checked })
              "
            />
            <span class="switch__ui" />
            <span class="switch__label">{{ draftSecondary.enabled ? '已启用' : '已关闭' }}</span>
          </label>
        </div>

        <div class="tj-field" style="margin-bottom: 0.85rem">
          <label>自动局面分析</label>
          <select
            class="tj-input"
            :value="props.settings.settlementMode || 'secondary_then_primary'"
            @change="
              patch({
                settlementMode: ($event.target as HTMLSelectElement)
                  .value as AppSettings['settlementMode'],
              })
            "
          >
            <option value="off">关闭（最省 token，对话不改局面）</option>
            <option value="secondary_only">仅次通灵分析（未配次 API 则不写入）</option>
            <option value="secondary_then_primary">
              次通灵优先，否则主通灵分析（默认）
            </option>
          </select>
          <p class="tj-hint">
            每回合剧情后自动多一次短 JSON（单次、不重试）。关闭可省 token。建议次 API 用小而快的模型。
          </p>
        </div>

        <div class="tj-row" style="margin-bottom: 0.75rem">
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            :disabled="!primaryReady"
            @click="copyPrimaryToSecondary"
          >
            从主 API 复制
          </button>
          <button
            type="button"
            class="btn btn-soft btn-sm"
            :disabled="!draftSecondary.enabled"
            @click="patch({ apiMode: 'dual' })"
          >
            设为双线模式
          </button>
          <button type="button" class="btn btn-primary btn-sm" @click="flushSecondary">
            保存次 API
          </button>
        </div>

        <div class="tj-field">
          <label>Base URL</label>
          <input
            v-model="draftSecondary.baseUrl"
            class="tj-input"
            :disabled="!draftSecondary.enabled"
            placeholder="https://api.deepseek.com/v1 或本地 http://localhost:1234/v1"
            autocomplete="off"
            spellcheck="false"
            @blur="flushSecondary"
          />
          <p class="tj-hint">OpenAI 兼容，不要带 /chat/completions</p>
        </div>
        <div class="tj-field">
          <label>API Key</label>
          <input
            v-model="draftSecondary.apiKey"
            class="tj-input"
            type="password"
            :disabled="!draftSecondary.enabled"
            placeholder="sk-...（可与主线不同）"
            autocomplete="off"
            @blur="flushSecondary"
          />
        </div>
        <div class="tj-field">
          <label>模型</label>
          <input
            v-model="draftSecondary.model"
            class="tj-input"
            list="tj-secondary-models"
            :disabled="!draftSecondary.enabled"
            placeholder="deepseek-chat / gpt-4o-mini …"
            autocomplete="off"
            @blur="flushSecondary"
          />
          <datalist id="tj-secondary-models">
            <option v-for="m in secondaryModels" :key="m" :value="m" />
          </datalist>
        </div>
        <div v-if="secondaryModels.length && draftSecondary.enabled" class="model-pick">
          <p class="model-pick__label">
            {{ lastFetchSource === 'remote' ? '接口返回' : '参考列表' }} · 点击选用
          </p>
          <div class="model-pick__list">
            <button
              v-for="m in secondaryModels.slice(0, 80)"
              :key="m"
              type="button"
              class="model-chip"
              :class="{ 'is-on': draftSecondary.model === m }"
              @click="pickModel('secondary', m)"
            >
              {{ m }}
            </button>
          </div>
        </div>

        <div class="secondary-grid">
          <div class="tj-field">
            <label>温度 {{ draftSecondary.temperature }}</label>
            <input
              v-model.number="draftSecondary.temperature"
              type="range"
              min="0"
              max="2"
              step="0.05"
              :disabled="!draftSecondary.enabled"
              @change="flushSecondary"
            />
          </div>
          <div class="tj-field">
            <label>最大 tokens</label>
            <input
              v-model.number="draftSecondary.maxTokens"
              class="tj-input"
              type="number"
              min="256"
              step="256"
              :disabled="!draftSecondary.enabled"
              @blur="flushSecondary"
            />
          </div>
        </div>

        <div class="tj-row">
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            :disabled="!draftSecondary.enabled || busy === 'fetch-secondary'"
            @click="handleFetchModels('secondary')"
          >
            拉取模型列表
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            :disabled="!draftSecondary.enabled || busy === 'test-secondary'"
            @click="handleTest('secondary')"
          >
            测试次 API
          </button>
        </div>
      </div>
    </template>

    <template v-else-if="tab === 'tags'">
      <div class="tj-field">
        <label>输出标签（须含 maintext 与 option）</label>
        <input
          class="tj-input"
          :value="settings.customTags.join(' ')"
          @input="onTagsInput(($event.target as HTMLInputElement).value)"
        />
        <p class="tj-hint">默认：maintext option sum vars thinking think</p>
      </div>
      <div class="tj-field">
        <label>掌门称谓</label>
        <input
          class="tj-input"
          :value="settings.userName"
          @input="patch({ userName: ($event.target as HTMLInputElement).value })"
        />
      </div>
      <div class="tj-field">
        <label>天机称谓</label>
        <input
          class="tj-input"
          :value="settings.characterName"
          @input="patch({ characterName: ($event.target as HTMLInputElement).value })"
        />
      </div>
    </template>

    <template v-else-if="tab === 'prompt'">
      <div class="tj-field">
        <label>格式提示词（注入推演，约束标签与气数结算）</label>
        <textarea
          class="tj-textarea"
          rows="12"
          :value="settings.formatPromptTemplate"
          @input="
            patch({ formatPromptTemplate: ($event.target as HTMLTextAreaElement).value })
          "
        />
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          @click="patch({ formatPromptTemplate: DEFAULT_FORMAT_PROMPT })"
        >
          恢复默认
        </button>
      </div>
    </template>

    <template v-else-if="tab === 'display'">
      <div class="tj-field">
        <label>思考过程</label>
        <select
          class="tj-select"
          :value="settings.thinkingDisplay"
          @change="
            patch({
              thinkingDisplay: ($event.target as HTMLSelectElement).value as
                | 'fold'
                | 'hide'
                | 'inline',
            })
          "
        >
          <option value="fold">折叠</option>
          <option value="inline">内联</option>
          <option value="hide">隐藏</option>
        </select>
      </div>
      <p class="tj-hint">库标识：{{ storageInfo.dbName }}（与其它项目隔离）</p>
    </template>

    <template v-else>
      <p class="tj-hint" style="margin-bottom: 0.75rem">
        导出含预设、秘闻、会话与气数。跨应用导入需勾选下方许可。
      </p>
      <label class="tj-check" style="margin-bottom: 0.85rem">
        <input v-model="allowCrossAppImport" type="checkbox" />
        允许跨应用备份导入
      </label>
      <p v-if="legacySharedDbs.length" class="tj-hint" style="color: var(--amber)">
        检测到遗留共享库：{{ legacySharedDbs.join(', ') }}（本宗不会读写它们）
      </p>
      <div class="tj-row">
        <button type="button" class="btn btn-soft btn-sm" @click="handleExport">导出备份</button>
        <button type="button" class="btn btn-ghost btn-sm" @click="handleImport">导入备份</button>
        <button type="button" class="btn btn-soft btn-sm" @click="handleNewGame">
          从头开局
        </button>
        <button type="button" class="btn btn-danger btn-sm" @click="handleClear">清空数据</button>
      </div>
      <p class="tj-hint" style="margin-top: 0.65rem">
        「从头开局」只重置经营与天机叙事；「清空数据」会抹掉 IndexedDB 里的预设/世界书等。
      </p>
    </template>

    <template #footer>
      <button type="button" class="btn btn-primary" @click="emit('close')">收起密匣</button>
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

.tab-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin-left: 0.3rem;
  vertical-align: middle;
}
.tab-dot.is-on {
  background: var(--jade);
}
.tab-dot.is-warn {
  background: var(--amber);
}
.tab-dot.is-off {
  background: var(--ink-faint);
}

.api-status-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-bottom: 0.85rem;
}

.api-pill {
  display: inline-flex;
  align-items: center;
  padding: 0.2rem 0.55rem;
  border-radius: var(--radius-full);
  font-size: 0.72rem;
  font-weight: 600;
  border: 1px solid var(--border-subtle);
  color: var(--ink-muted);
}
.api-pill.is-on {
  background: var(--jade-soft);
  color: var(--jade);
  border-color: rgba(90, 154, 150, 0.25);
}
.api-pill.is-warn {
  background: var(--amber-soft);
  color: var(--amber);
}
.api-pill.is-off {
  background: rgba(120, 145, 180, 0.1);
}
.api-pill.is-mode {
  background: var(--moon-glow);
  color: var(--moon-deep);
}

.mode-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.55rem;
  margin-bottom: 0.9rem;
}

.mode-card {
  appearance: none;
  text-align: left;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  padding: 0.7rem 0.85rem;
  cursor: pointer;
  font-family: inherit;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  transition: border-color var(--dur-fast), box-shadow var(--dur-fast);
}

.mode-card strong {
  font-size: 0.9rem;
  color: var(--ink-primary);
}

.mode-card span {
  font-size: 0.75rem;
  color: var(--ink-muted);
  line-height: 1.4;
}

.mode-card.is-active {
  border-color: var(--border-moon);
  box-shadow: var(--shadow-glow);
  background: rgba(91, 141, 239, 0.06);
}

.api-panel {
  padding: 0.9rem 1rem;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
}

.api-panel--secondary {
  border-color: rgba(123, 107, 176, 0.25);
  background: linear-gradient(180deg, rgba(123, 107, 176, 0.05), var(--bg-elevated) 40%);
}

.api-panel__title {
  margin: 0 0 0.75rem;
  font-family: var(--font-display);
  font-size: 1rem;
  font-weight: 600;
}

.secondary-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.secondary-head .api-panel__title {
  margin-bottom: 0.25rem;
}

.secondary-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.65rem;
}

.api-secondary-teaser {
  margin-top: 0.85rem;
  padding: 0.75rem 0.9rem;
  border-radius: var(--radius-md);
  border: 1px dashed rgba(123, 107, 176, 0.35);
  background: var(--violet-soft);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
}

.api-secondary-teaser strong {
  font-size: 0.9rem;
  color: var(--violet);
}

.switch {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  cursor: pointer;
  user-select: none;
  flex-shrink: 0;
}

.switch input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.switch__ui {
  width: 40px;
  height: 22px;
  border-radius: 999px;
  background: rgba(120, 145, 180, 0.35);
  position: relative;
  transition: background var(--dur-fast);
}

.switch__ui::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: var(--shadow-sm);
  transition: transform var(--dur-fast);
}

.switch input:checked + .switch__ui {
  background: var(--jade);
}

.switch input:checked + .switch__ui::after {
  transform: translateX(18px);
}

.switch__label {
  font-size: 0.8rem;
  color: var(--ink-secondary);
  font-weight: 600;
}

.model-pick {
  margin: 0.35rem 0 0.75rem;
  padding: 0.55rem 0.65rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  background: var(--bg-soft, rgba(240, 245, 252, 0.6));
}

.model-pick__label {
  margin: 0 0 0.45rem;
  font-size: 0.75rem;
  color: var(--ink-muted);
  font-weight: 600;
}

.model-pick__list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  max-height: 9.5rem;
  overflow-y: auto;
}

.model-chip {
  appearance: none;
  border: 1px solid var(--border-medium);
  background: #fff;
  color: var(--ink-secondary);
  font-size: 0.72rem;
  padding: 0.2rem 0.5rem;
  border-radius: var(--radius-full);
  cursor: pointer;
  font-family: inherit;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-chip:hover {
  border-color: var(--moon);
  color: var(--moon-deep);
}

.model-chip.is-on {
  border-color: var(--jade);
  background: var(--jade-soft);
  color: var(--jade);
  font-weight: 600;
}

.model-fetch-err {
  margin: 0 0 0.65rem;
  padding: 0.5rem 0.65rem;
  border-radius: var(--radius-sm);
  background: var(--rose-soft);
  color: var(--rose);
  font-size: 0.78rem;
  line-height: 1.45;
  white-space: pre-wrap;
  max-height: 6rem;
  overflow-y: auto;
}

.api-block-banner {
  margin: 0 0 0.85rem;
  padding: 0.75rem 0.85rem;
  border-radius: var(--radius-md);
  border: 1px solid rgba(196, 90, 90, 0.35);
  background: var(--rose-soft);
  color: var(--rose);
  font-size: 0.82rem;
  line-height: 1.5;
}

.api-block-banner strong {
  display: block;
  margin-bottom: 0.35rem;
  font-size: 0.9rem;
}

.api-block-banner pre {
  margin: 0.4rem 0 0;
  white-space: pre-wrap;
  font-family: inherit;
  font-size: 0.78rem;
  line-height: 1.45;
  max-height: 12rem;
  overflow-y: auto;
}

@media (max-width: 560px) {
  .mode-cards,
  .secondary-grid {
    grid-template-columns: 1fr;
  }
  .secondary-head {
    flex-direction: column;
  }
}
</style>
