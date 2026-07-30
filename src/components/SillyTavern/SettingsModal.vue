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
  // 记忆走三期 + 角色图谱 + 冷档案（零强制 API），不再设记忆/召回专用通道
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
/** Embedding 独立端点三件套合并写入（保留未改字段） */
function patchEmbeddingApi(field: 'baseUrl' | 'apiKey' | 'model', raw: string) {
  const cur = props.settings.embeddingApi || { baseUrl: '', apiKey: '', model: '' }
  patch({ embeddingApi: { ...cur, [field]: raw.trim() } })
}
/** 运行诊断文案：正常/失败原因/未启用 */
const embedStatusText = computed(() => {
  const st = props.settings.embeddingStatus
  if (!st) return ''
  if (st.state === 'ok') {
    return st.recallHits != null ? `正常 · 最近召回 ${st.recallHits} 条` : '正常'
  }
  if (st.state === 'error') {
    return st.message ? `失败：${st.message}` : '失败'
  }
  return '未启用 embedding 模式'
})
/** 摘要端点三件套合并写入（保留未改字段） */
function patchSummaryApi(field: 'baseUrl' | 'apiKey' | 'model', raw: string) {
  const cur = props.settings.summaryApi || { baseUrl: '', apiKey: '', model: '' }
  patch({ summaryApi: { ...cur, [field]: raw.trim() } })
}
/** 摘要运行诊断文案 */
const summaryStatusText = computed(() => {
  const st = props.settings.summaryStatus
  if (!st || st.state === 'disabled') return '未启用'
  if (st.state === 'ok') return '正常 · 上次记账成功'
  if (st.state === 'error') return st.message ? `失败：${st.message}` : '失败'
  return '未启用'
})

const RECALL_OPTIONS = [
  { value: 'keyword' as const, label: '仅关键词' },
  { value: 'embedding' as const, label: '语义向量' },
  { value: 'both' as const, label: '双路召回' },
]

/** 显示页 · 历史限制自定义：钳制后写入 */
function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, Math.round(n)))
}

function patchHistoryKeep(raw: string | number) {
  const n = clampInt(Number(raw), 0, 200)
  patch({ historyKeepMessages: n })
}

function patchHistoryMaxTokens(raw: string | number) {
  const n = clampInt(Number(raw), 0, 500_000)
  patch({ historyMaxTokens: n })
}

const KEEP_PRESETS = [0, 4, 8, 12, 16, 24, 32, 48, 64] as const
const TOKEN_PRESETS = [0, 4000, 8000, 12000, 16000, 20000, 32000, 48000, 64000] as const

function packSideChannels() {
  return {
    secondary: {
      ...secondary.value,
      enabled: draftSecondary.enabled,
      baseUrl: draftSecondary.baseUrl.trim(),
      apiKey: draftSecondary.apiKey.trim(),
      model: draftSecondary.model.trim(),
      temperature: draftSecondary.temperature,
      maxTokens: draftSecondary.maxTokens,
    },
  }
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
        ...packSideChannels(),
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
    await updateSettings({
      apiMode: draftSecondary.enabled ? 'dual' : props.settings.apiMode,
      api: {
        ...props.settings.api,
        baseUrl: draftPrimary.baseUrl.trim() || props.settings.api.baseUrl,
        apiKey: draftPrimary.apiKey.trim() || props.settings.api.apiKey,
        model: draftPrimary.model.trim() || props.settings.api.model,
        ...packSideChannels(),
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

type ApiWhich = 'primary' | 'secondary'

function pickModel(which: ApiWhich, id: string) {
  if (which === 'primary') {
    draftPrimary.model = id
    void flushPrimary()
  } else {
    draftSecondary.model = id
    void flushSecondary()
  }
  showToast(`已选用模型：${id}`)
}

async function handleFetchModels(which: ApiWhich) {
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

async function handleTest(which: ApiWhich) {
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
      const label = which === 'primary' ? '主' : '辅'
      showToast(
        `${label}线连通` + (result.usedUrl ? ` · ${result.usedUrl}` : ''),
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
  try {
    const data = await exportAllData()
    // 二次校验：序列化后再 parse，确保下载文件真有弟子
    const text = JSON.stringify(data, null, 2)
    let parsed: typeof data
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error('导出序列化失败')
    }
    const gs = parsed.gameSave as
      | { disciples?: unknown[]; resources?: { spiritStone?: number } }
      | undefined
    const n = Array.isArray(gs?.disciples) ? gs!.disciples!.length : 0
    const stone = gs?.resources?.spiritStone
    if (!gs) {
      const go = confirm(
        '当前导出不含经营存档（gameSave 为空）。\n' +
          '可能原因：本机还没开局、或进度未写入。\n\n' +
          '仍要下载这份「仅天机」备份吗？',
      )
      if (!go) return
    } else if (n === 0) {
      const go = confirm(
        '经营档里弟子数为 0。若你界面上有弟子，说明导出仍有 bug，请取消并反馈。\n\n仍要下载吗？',
      )
      if (!go) return
    }

    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `zongmen-backup-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
    if (gs) {
      showToast(`整包已导出 · 弟子${n} · 灵石${stone ?? '?'}`)
    } else {
      showToast('已导出（仅天机，无经营档）')
    }
  } catch (e) {
    alert(`导出失败: ${(e as Error).message}`)
  }
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
      const hasGameField =
        data?.gameSave != null ||
        data?.localState?.['zongmen-game-v1'] ||
        (data?.resources && data?.calendar && !Array.isArray(data?.lorebooks))
      if (!hasGameField && Array.isArray(data?.chats)) {
        const go = confirm(
          '此备份没有经营存档（无 gameSave）。\n' +
            '导入后：会话/预设可恢复，弟子名册与资源不会变。\n\n' +
            '要用「含弟子数」的新备份，请在导出站确认 toast 有「弟子N」。\n\n' +
            '仍只导入天机数据吗？',
        )
        if (!go) return
      }
      // 文件内弟子预检
      const fileDisciples = Array.isArray(data?.gameSave?.disciples)
        ? data.gameSave.disciples.length
        : -1
      if (fileDisciples === 0 && hasGameField) {
        const go = confirm('备份里弟子数为 0。导入会清空当前名册。继续？')
        if (!go) return
      }

      let result
      if (data?.appId && data.appId !== storageInfo.appId && !allowCrossAppImport.value) {
        const ok = confirm(
          `此备份来自「${data.appId}」，当前为「${storageInfo.appId}」。导入会覆盖本宗数据，是否继续？`,
        )
        if (!ok) return
        result = await importAllData(data, { allowCrossApp: true })
      } else {
        result = await importAllData(data, { allowCrossApp: allowCrossAppImport.value })
      }

      const parts: string[] = []
      if (result.gameHydrated) {
        parts.push(`经营已恢复·弟子${result.discipleCount}`)
      } else if (result.hasGameSave) {
        parts.push('经营档在文件中但未写入界面')
      } else {
        parts.push('无经营档')
      }
      if (result.idbRestored) parts.push(`会话包${result.chatCount}`)
      if (result.tianjiRebooted) parts.push('天机已重载')

      if (result.errors?.length) {
        alert(`${parts.join(' · ')}\n\n问题：\n${result.errors.join('\n')}`)
      } else {
        showToast(parts.join(' · '))
      }

      // 经营恢复成功：整页刷新，确保所有视图读到新 localStorage（最硬、最不骗）
      if (result.gameHydrated) {
        const reload = confirm(
          `经营已写入（弟子 ${result.discipleCount}）。\n建议立即刷新页面以完整显示名册与资源。\n\n现在刷新？`,
        )
        if (reload) {
          window.location.reload()
          return
        }
      }
      emit('reloaded')
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

        <div class="tj-field" style="margin-bottom: 0.85rem">
          <label>局面结算 · 破限（jailbreak）</label>
          <textarea
            class="tj-textarea"
            rows="5"
            :value="props.settings.settleJailbreakPrompt || ''"
            :disabled="(props.settings.settlementMode || 'secondary_then_primary') === 'off'"
            placeholder="空 = 不插破限。主推演心法的越狱不会进次 API；需要时把破限贴在这里。发送顺序：system 任务 → 本段破限 → user 局面与契约。"
            @change="
              patch({
                settleJailbreakPrompt: ($event.target as HTMLTextAreaElement).value,
              })
            "
          />
          <p class="tj-hint">
            <strong>为何单独做：</strong>
            回合后的局面分析走次 API（或回退主 API）的侧路，不拼主推演心法，
            所以心法里的「相对/越狱」挂不进这里。敏感收徒、资源、外交等若被模型拒写，
            在此贴破限。默认空，不内置越狱正文。与「召回破限」互不共用。
          </p>
          <div class="tj-row" style="margin-top: 0.4rem">
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              :disabled="!(props.settings.settleJailbreakPrompt || '').trim()"
              @click="patch({ settleJailbreakPrompt: '' })"
            >
              清空破限
            </button>
          </div>
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

      <div class="api-panel" style="margin-top: 0.85rem">
        <div class="secondary-head">
          <div>
            <h3 class="api-panel__title">隐藏楼层 · 压缩</h3>
            <p class="tj-hint" style="margin: 0">
              拼装时把助手楼压成 maintext/小结，去掉 thinking/option/Memory 原文；
              更早的楼只留一句话小结。这才是「隐藏楼层」真正省 token 的地方。
            </p>
          </div>
          <label class="switch">
            <input
              type="checkbox"
              :checked="settings.historyCompress !== false"
              @change="
                patch({
                  historyCompress: ($event.target as HTMLInputElement).checked,
                })
              "
            />
            <span class="switch__ui" />
            <span class="switch__label">{{
              settings.historyCompress !== false ? '已开启' : '已关闭'
            }}</span>
          </label>
        </div>
      </div>

      <div class="tj-field" style="margin-top: 0.85rem">
        <label>近端保底条数（自定义 0～200）</label>
        <div class="limit-row">
          <input
            class="tj-input limit-input"
            type="number"
            min="0"
            max="200"
            step="1"
            :value="settings.historyKeepMessages ?? 12"
            @change="patchHistoryKeep(($event.target as HTMLInputElement).value)"
            @blur="patchHistoryKeep(($event.target as HTMLInputElement).value)"
          />
          <span class="limit-unit">条 user/assistant</span>
        </div>
        <div class="limit-presets">
          <button
            v-for="n in KEEP_PRESETS"
            :key="'keep-' + n"
            type="button"
            class="model-chip"
            :class="{ 'is-on': (settings.historyKeepMessages ?? 12) === n }"
            @click="patchHistoryKeep(n)"
          >
            {{ n === 0 ? '0·仅预算' : n === 12 ? '12·默认' : String(n) }}
          </button>
        </div>
        <p class="tj-hint">
          优先保留最近 N 条（压缩开启时这 N 条用 maintext+sum，更早的只留小结）。
          0 = 不按条数保底，只靠下方 token 预算。可手填任意整数。
        </p>
      </div>

      <div class="tj-field" style="margin-top: 0.85rem">
        <label>历史硬预算（自定义 0～500000 粗估 token）</label>
        <div class="limit-row">
          <input
            class="tj-input limit-input"
            type="number"
            min="0"
            max="500000"
            step="500"
            :value="settings.historyMaxTokens ?? 12000"
            @change="patchHistoryMaxTokens(($event.target as HTMLInputElement).value)"
            @blur="patchHistoryMaxTokens(($event.target as HTMLInputElement).value)"
          />
          <span class="limit-unit">token（粗估≈字数/4）</span>
        </div>
        <div class="limit-presets">
          <button
            v-for="n in TOKEN_PRESETS"
            :key="'tok-' + n"
            type="button"
            class="model-chip"
            :class="{ 'is-on': (settings.historyMaxTokens ?? 12000) === n }"
            @click="patchHistoryMaxTokens(n)"
          >
            {{
              n === 0
                ? '0·不限'
                : n === 12000
                  ? '12k·默认'
                  : n >= 1000
                    ? Math.round(n / 1000) + 'k'
                    : String(n)
            }}
          </button>
        </div>
        <p class="tj-hint">
          历史消息总粗估超过此值就截断更早楼。与心法「上下文长度 ×75%」取更小者。
          0 = 不设硬上限（大上下文易回到数万 token）。系统世界书不计入此预算。可手填如 15000、24000。
        </p>
      </div>

      <div class="api-panel" style="margin-top: 0.85rem">
        <div class="secondary-head">
          <div>
            <h3 class="api-panel__title">推演时注入 · 角色记忆</h3>
            <p class="tj-hint" style="margin: 0">
              Boot 锚 + 长线/近端摘要 + 角色图谱。
              完整浏览：侧栏「角色记忆」。
            </p>
          </div>
        </div>

        <!-- ── 自动记账 ── -->
        <div class="mem-group">
          <div class="mem-group__head">
            <span class="mem-group__label">自动记账</span>
            <label class="switch">
              <input
                type="checkbox"
                :checked="settings.memoryNarrativeFallback !== false"
                @change="
                  patch({
                    memoryNarrativeFallback: ($event.target as HTMLInputElement).checked,
                  })
                "
              />
              <span class="switch__ui" />
              <span class="switch__label">{{
                settings.memoryNarrativeFallback !== false ? '开启' : '关闭'
              }}</span>
            </label>
          </div>
          <p class="mem-group__desc">
            每回合 AI 回复后自动从正文提取角色近事、物品/地点/关系变更。
          </p>

          <!-- 引擎选择（记账开启时显示） -->
          <template v-if="settings.memoryNarrativeFallback !== false">
            <p class="mem-sub-label">记账引擎</p>
            <div class="mem-radio-row">
              <label
                class="mem-radio"
                :class="{ 'is-on': !settings.memoryLlmSummary }"
              >
                <input
                  type="radio"
                  name="mem-engine"
                  :checked="!settings.memoryLlmSummary"
                  @change="patch({ memoryLlmSummary: false })"
                />
                <span class="mem-radio__dot" />
                <span class="mem-radio__body">
                  <span class="mem-radio__title">正则规则引擎</span>
                  <span class="mem-radio__hint">默认 · 零 API 调用</span>
                </span>
              </label>
              <label
                class="mem-radio"
                :class="{ 'is-on': !!settings.memoryLlmSummary }"
              >
                <input
                  type="radio"
                  name="mem-engine"
                  :checked="!!settings.memoryLlmSummary"
                  @change="patch({ memoryLlmSummary: true })"
                />
                <span class="mem-radio__dot" />
                <span class="mem-radio__body">
                  <span class="mem-radio__title">LLM 摘要引擎</span>
                  <span class="mem-radio__hint">小模型提炼 · 质量更高</span>
                </span>
              </label>
            </div>

            <!-- LLM 摘要引擎配置 -->
            <div class="mem-sub-block" v-if="settings.memoryLlmSummary">
              <p class="mem-sub-label">摘要小模型端点</p>
              <div class="mem-endpoint-grid">
                <input
                  class="tj-input"
                  type="url"
                  :value="settings.summaryApi?.baseUrl || ''"
                  placeholder="baseUrl（如 http://localhost:11434/v1）"
                  @change="patchSummaryApi('baseUrl', ($event.target as HTMLInputElement).value)"
                />
                <input
                  class="tj-input"
                  type="password"
                  :value="settings.summaryApi?.apiKey || ''"
                  placeholder="API Key（可空）"
                  @change="patchSummaryApi('apiKey', ($event.target as HTMLInputElement).value)"
                />
                <input
                  class="tj-input"
                  type="text"
                  :value="settings.summaryApi?.model || ''"
                  placeholder="模型名（如 gemma3:27b）"
                  @change="patchSummaryApi('model', ($event.target as HTMLInputElement).value)"
                />
              </div>
              <p class="sched-hint" v-if="settings.summaryStatus && settings.summaryStatus.state !== 'disabled'" :class="`sched-hint--${settings.summaryStatus.state}`">
                {{ summaryStatusText }}
              </p>
            </div>
          </template>
        </div>

        <!-- ── 语义召回 ── -->
        <div class="mem-group">
          <div class="mem-group__head">
            <span class="mem-group__label">语义召回</span>
            <span class="mem-group__badge">需 embedding API</span>
          </div>
          <p class="mem-group__desc">
            从历史建库中语义检索相关记忆，追加注入到推演上下文。
          </p>

          <p class="mem-sub-label">注入时策略</p>
          <div class="mem-recall-row">
            <label
              v-for="opt in RECALL_OPTIONS"
              :key="opt.value"
              class="mem-chip"
              :class="{ 'is-on': (settings.memoryRecallMode || 'keyword') === opt.value }"
            >
              <input
                type="radio"
                name="mem-recall"
                :value="opt.value"
                :checked="(settings.memoryRecallMode || 'keyword') === opt.value"
                @change="
                  patch({
                    memoryRecallMode: ($event.target as HTMLInputElement).value as
                      | 'keyword'
                      | 'embedding'
                      | 'both',
                  })
                "
              />
              <span>{{ opt.label }}</span>
            </label>
          </div>

          <!-- embedding 配置 -->
          <div class="mem-sub-block" v-if="settings.memoryRecallMode === 'embedding' || settings.memoryRecallMode === 'both'">
            <p class="mem-sub-label">Embedding 配置</p>
            <div class="tj-field" style="margin-bottom: 0.55rem">
              <input
                class="tj-input"
                type="text"
                :value="settings.embeddingModel || ''"
                placeholder="模型（空=主 API model，如 text-embedding-3-small）"
                @change="
                  patch({
                    embeddingModel: ($event.target as HTMLInputElement).value.trim(),
                  })
                "
              />
            </div>
            <p class="mem-sub-label" style="font-size: 0.72rem">独立端点（可选 · 全空则回退主 API）</p>
            <div class="mem-endpoint-grid">
              <input
                class="tj-input"
                type="text"
                :value="settings.embeddingApi?.baseUrl || ''"
                placeholder="baseUrl"
                @change="patchEmbeddingApi('baseUrl', ($event.target as HTMLInputElement).value)"
              />
              <input
                class="tj-input"
                type="password"
                :value="settings.embeddingApi?.apiKey || ''"
                placeholder="API Key"
                @change="patchEmbeddingApi('apiKey', ($event.target as HTMLInputElement).value)"
              />
              <input
                class="tj-input"
                type="text"
                :value="settings.embeddingApi?.model || ''"
                placeholder="端点模型"
                @change="patchEmbeddingApi('model', ($event.target as HTMLInputElement).value)"
              />
            </div>
            <p class="sched-hint" v-if="settings.embeddingStatus" :class="`sched-hint--${settings.embeddingStatus.state}`">
              {{ embedStatusText }}
            </p>
          </div>
        </div>

        <!-- ── 外置记忆服 ── -->
        <div class="mem-group">
          <div class="mem-group__head">
            <span class="mem-group__label">外置记忆服</span>
            <span class="mem-group__badge">可选</span>
          </div>
          <p class="mem-group__desc">
            Nocturne 类 HTTP 补充记忆源，失败不挡推演。
          </p>
          <div class="mem-svr-grid">
            <input
              class="tj-input"
              type="url"
              :value="settings.memoryServerUrl || ''"
              placeholder="URL（约定 GET /memory/search?q=）"
              @change="
                patch({
                  memoryServerUrl: ($event.target as HTMLInputElement).value.trim(),
                })
              "
            />
            <input
              class="tj-input"
              type="password"
              autocomplete="off"
              :value="settings.memoryServerToken || ''"
              placeholder="Bearer Token（可空）"
              @change="
                patch({
                  memoryServerToken: ($event.target as HTMLInputElement).value.trim(),
                })
              "
            />
          </div>
        </div>
      </div>

      <p class="tj-hint">库标识：{{ storageInfo.dbName }}（与其它项目隔离）</p>
    </template>

    <template v-else>
      <p class="tj-hint" style="margin-bottom: 0.75rem">
        导出必须含 <strong>gameSave</strong>（弟子名册、资源、灵田等）+ 天机会话。
        导出成功时会提示「弟子N · 灵石X」——没有这句就别拿去 beta 导入。
        main / beta 域名不同，只能靠本页整包迁移。
      </p>
      <p class="tj-hint" style="margin-bottom: 0.75rem; color: var(--amber)">
        <strong>旧备份</strong>（JSON 里搜不到 <code>gameSave</code> 或
        <code>zongmen-game-v1</code>）= 没有弟子名册。请在本页用最新版重新导出。
        导入后若提示「无经营档」，不是解析坏了，是文件里本来就没有。
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

.limit-row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  margin-bottom: 0.45rem;
}

.limit-input {
  max-width: 9rem;
  font-variant-numeric: tabular-nums;
}

.limit-unit {
  font-size: 0.78rem;
  color: var(--ink-muted);
  white-space: nowrap;
}

.limit-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin-bottom: 0.35rem;
}

/* 旧两列表格（若别处仍用） */
.sched-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
  gap: 0.55rem 0.75rem;
  margin-top: 0.65rem;
}

.sched-grid .tj-field span {
  display: block;
  font-size: 0.72rem;
  color: var(--ink-muted);
  margin-bottom: 0.2rem;
}

.sched-grid .limit-input {
  width: 100%;
  max-width: none;
}

/* 参数区：单列说明 + 数字框，避免半截标签 */
.sched-fields {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  margin-top: 0.75rem;
}

/* ── 角色记忆组（mem-group / mem-radio / mem-chip）── */
.mem-group {
  margin-top: 0.85rem;
  padding: 0.8rem;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.3);
}
.mem-group__head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
}
.mem-group__label {
  font-size: 0.92rem;
  font-weight: 650;
  color: var(--ink-primary);
}
.mem-group__badge {
  font-size: 0.68rem;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--jade-soft);
  color: var(--jade);
  font-weight: 500;
}
.mem-group__desc {
  margin: 0 0 0.65rem;
  font-size: 0.75rem;
  color: var(--ink-faint);
  line-height: 1.45;
}
.mem-sub-label {
  margin: 0 0 0.35rem;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--ink-secondary);
}
.mem-sub-block {
  margin-top: 0.6rem;
  padding: 0.65rem 0.7rem;
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.45);
  border: 1px dashed var(--border-subtle);
}

/* 引擎单选行 */
.mem-radio-row {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.mem-radio {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.55rem 0.7rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  background: #fff;
  cursor: pointer;
  transition: border-color 0.18s, background 0.18s;
}
.mem-radio.is-on {
  border-color: var(--jade);
  background: #edf7f0;
}
.mem-radio input { display: none; }
.mem-radio__dot {
  flex-shrink: 0;
  margin-top: 2px;
  width: 14px; height: 14px;
  border-radius: 50%;
  border: 2px solid var(--border-mid);
  background: #fff;
  transition: border-color 0.18s, background 0.18s;
}
.mem-radio.is-on .mem-radio__dot {
  border-color: var(--jade);
  background: var(--jade);
}
.mem-radio__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mem-radio__title {
  font-size: 0.84rem;
  font-weight: 600;
  color: var(--ink-primary);
}
.mem-radio__hint {
  font-size: 0.7rem;
  color: var(--ink-faint);
}

/* 召回策略 chip 行 */
.mem-recall-row {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}
.mem-chip {
  display: flex;
  align-items: center;
  padding: 0.38rem 0.7rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  background: #fff;
  font-size: 0.78rem;
  font-weight: 550;
  color: var(--ink-secondary);
  cursor: pointer;
  transition: border-color 0.18s, background 0.18s, color 0.18s;
}
.mem-chip.is-on {
  border-color: var(--jade);
  background: #edf7f0;
  color: var(--jade);
}
.mem-chip input { display: none; }

/* 端点 / 外置记忆服 紧凑网格 */
.mem-endpoint-grid {
  display: flex;
  gap: 0.45rem;
  flex-wrap: wrap;
}
.mem-endpoint-grid .tj-input {
  flex: 1 1 120px;
  min-width: 0;
}
.mem-svr-grid {
  display: flex;
  gap: 0.45rem;
}
.mem-svr-grid .tj-input {
  flex: 1 1 0;
  min-width: 0;
}

.sched-field {
  display: block;
  margin: 0;
  padding: 0.7rem 0.8rem;
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.35);
  border: 1px solid var(--border-subtle);
}

.sched-field__title {
  display: block;
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--ink-primary);
  margin-bottom: 0.1rem;
}

.sched-field__key {
  display: block;
  font-size: 0.7rem;
  color: var(--ink-faint);
  letter-spacing: 0.02em;
  margin-bottom: 0.4rem;
}

.sched-field .limit-input {
  width: 100%;
  max-width: 12rem;
}
/** Embedding 端点三件套紧凑排布 */
.sched-embed-grid {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.sched-embed-grid .tj-input {
  width: 100%;
}
/** 运行诊断文案配色（可观测性） */
.sched-hint {
  margin: 0;
  font-size: 0.78rem;
  color: var(--ink-faint);
}
.sched-hint--ok {
  color: #3a8a4a;
}
.sched-hint--error {
  color: #c0563a;
}
.sched-hint--disabled {
  color: var(--ink-faint);
}

.sched-field__help {
  margin: 0.45rem 0 0;
  font-size: 0.75rem;
  line-height: 1.5;
  color: var(--ink-muted);
}

.sched-field__help strong {
  color: var(--ink-secondary);
  font-weight: 600;
}

.sched-field__help code {
  font-size: 0.72rem;
  padding: 0.05em 0.3em;
  border-radius: 4px;
  background: rgba(91, 141, 239, 0.12);
  color: var(--moon-deep);
}

.sched-prompt-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.35rem;
}

.sched-prompt-head .sched-field__title {
  margin-bottom: 0.15rem;
}

.sched-field .tj-textarea {
  width: 100%;
  min-height: 4.5rem;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.78rem;
  line-height: 1.45;
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
