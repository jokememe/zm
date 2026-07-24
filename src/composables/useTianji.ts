/**
 * 天机卷轴 — 游戏唯一叙事入口。
 * SillyTavern 为底层；气数簿结算写回经营资源。
 */
import { computed, ref } from 'vue'
import type { TianjiMessage } from '@/types/game'
import { tianjiSeed } from '@/data/mock'
import { buildOpeningTianjiMessages, openingTianjiMessages } from '@/data/opening'
import { useGameState } from '@/composables/useGameState'
import { useToast } from '@/composables/useToast'
import {
  initializeDatabase,
  getSettings,
  saveSettings,
  getPresets,
  getLorebooks,
  getChats,
  saveChat,
  saveLorebook,
  deleteLorebook as deleteLorebookDb,
  savePreset,
  deletePreset as deletePresetDb,
  assemblePrompt,
  extractVariables,
  StreamTagParser,
  aggregateEvents,
  DEFAULT_SETTINGS,
  DEFAULT_TAGS,
  DEFAULT_OPAQUE_TAGS,
  createDefaultLorebook,
  createDefaultPreset,
  normalizePresetSettings,
  getSamplingForApi,
  sanitizeAssistantForDisplay,
  postChatCompletion,
  postChatCompletionStream,
  type AppSettings,
  type ChatPreset,
  type ChatSession,
  type ChatMessage,
  type Lorebook,
  type ParsedTags,
} from '@/sillytavern'
import {
  SYSTEM_LOREBOOK_ID,
  snapshotGameVariables,
  applyVariablesToGame,
  mergeSessionWithGame,
  commitVariablesFromEditor,
} from '@/composables/game-bridge'
import { ensureAndRefreshSystemLorebook } from '@/composables/system-lorebook'
import { recordTurnSum, loadMemoryBank } from '@/composables/memory-lore'
import {
  applyAssistantMemoryTags,
  hasMemoryTag,
  loadTableMemory,
} from '@/composables/table-memory'
import { syncTableMemoryFromGame } from '@/composables/table-memory-sync'
import { runSettle, textFromSettleCompletion } from '@/composables/settle-runner'
import {
  runTableMemoryPipeline,
  getSchedulerStatus,
} from '@/composables/table-memory-pipeline'
import { buildMainFormatMemoryHint } from '@/composables/table-memory-prompts'
// 注册索引 Top-K 注入
import '@/composables/table-memory-recall'
import { snapshotWorldState, restoreWorldState } from '@/composables/world-state'
import {
  isApiConfigured,
  apiConfigMissing,
  mergeApiSettings,
  saveApiCache,
  normalizeBaseUrl,
} from '@/composables/api-cache'

const TIANJI_CHAT_NAME = '天机卷轴'
const SESSION_KEY = 'tianji-session'

function defaultLocalMessages(): TianjiMessage[] {
  try {
    const { openingDone, sectName, masterName } = useGameState()
    if (openingDone.value) return [...tianjiSeed]
    return buildOpeningTianjiMessages(
      String(masterName.value || '掌门'),
      String(sectName.value || '本宗'),
    )
  } catch {
    return [...openingTianjiMessages]
  }
}

const messages = ref<TianjiMessage[]>(defaultLocalMessages())
const typing = ref(false)
/** 自动局面分析进行中（剧情已出，仍禁止连发以免状态竞态） */
const settling = ref(false)
const contextInjected = ref<string | null>(null)
const contextDetail = ref<string | null>(null)
const ready = ref(false)
const lastError = ref<string | null>(null)
/** 局面分析最近一次结果文案（成功/失败/无变更都写，供顶栏展示） */
const lastSettlement = ref<string | null>(null)
/** 顶栏样式：ok | fail | info | null */
const lastSettlementKind = ref<'ok' | 'fail' | 'info' | null>(null)

const toast = useToast()

const settings = ref<AppSettings | null>(null)
const presets = ref<ChatPreset[]>([])
const lorebooks = ref<Lorebook[]>([])
const chatSession = ref<ChatSession | null>(null)
const lastParsed = ref<ParsedTags | null>(null)

const showSettings = ref(false)
const showLorebooks = ref(false)
const showPresets = ref(false)
const showVariables = ref(false)
const showMemory = ref(false)
/** 记忆追溯（yuzuki trace）最近结果，供顶栏/锦囊展示 */
const lastMemoryTrace = ref<string | null>(null)
const lastMemoryTraceKind = ref<'ok' | 'fail' | 'info' | null>(null)
const memoryTracing = ref(false)

let seq = 100
let bootPromise: Promise<void> | null = null

const ORACLE_REPLIES: Record<string, string[]> = {
  default: [
    '云雾未散，因果已动。掌门此念，将在宗门气运中留下一痕。',
    '以眼前之局而论：外敌可缓、内政宜先。灵田与人心，是青岚再起的根基。',
    '天机混沌，非一言可决。你可点选左侧事务，注入上下文后再问。',
  ],
  赤焰谷: [
    '赤焰谷兵锋虽盛，却忌「名不正」。若以礼折其锋，或以利换其退，皆可试——切勿空口示弱，亦勿无阵妄战。',
    '矿脉一事，可允外围、守内里；令其有所得，而不窥真源。',
  ],
  灵田: [
    '东坡将熟，护田重于开荒。妖兽足迹不可轻视——宁可少收一分，不可失一季人心。',
    '北崖荒田需灵泉疏导，非一日之功。可令外门轮值开垦，以功绩换取聚气丹。',
  ],
  弟子: [
    '陆承渊锐气可用，然情丝已起；沈微幼而忠，可作远计。继位之争，宜早布、勿明撕。',
    '裴晚晴心有怨怼，若能委以阵修重任，或化戈为玉帛。',
  ],
  城池: [
    '青石城恭顺，宜护其商道以固声望；黑水坞首鼠两端，可压可拉，不宜置之不理。',
  ],
  炼丹: [
    '丹房库存尚可支撑一季。破境引成功率不足半，勿轻易投入核心弟子。',
  ],
}

function nowLabel() {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function pickReply(text: string, context?: string | null): string {
  const poolKeys = Object.keys(ORACLE_REPLIES).filter((k) => k !== 'default')
  const hit =
    poolKeys.find((k) => (context && context.includes(k)) || text.includes(k)) ??
    (context ? poolKeys.find((k) => context.includes(k)) : undefined)
  const pool = hit ? ORACLE_REPLIES[hit] : ORACLE_REPLIES.default
  return pool[Math.floor(Math.random() * pool.length)]
}

function hasApiKey(s: AppSettings | null): boolean {
  return isApiConfigured(s?.api)
}

function stRoleToTianji(role: ChatMessage['role']): TianjiMessage['role'] {
  if (role === 'user') return 'player'
  if (role === 'assistant') return 'oracle'
  return 'system'
}

function choicesFromParsed(parsed?: ParsedTags | null): TianjiMessage['choices'] {
  if (!parsed?.options?.length) return undefined
  return parsed.options
    .map((label, i) => ({ id: `opt-${i}-${label.slice(0, 12)}`, label: label.trim() }))
    .filter((c) => c.label.length > 0)
}

/**
 * 气泡/正文展示：优先 parsed.maintext，否则走 sanitize（抽 maintext + 剥控制块）。
 * 绝不把带一堆 XML 标签的 raw 原样塞进 UI。
 */
function displayContentFromAssistant(
  raw: string,
  parsed?: ParsedTags | null,
  settings?: Record<string, unknown> | null,
): string {
  if (parsed?.maintext?.trim()) {
    let out = parsed.maintext.trim()
    // maintext 内偶发嵌套标签时再剥一层
    out = sanitizeAssistantForDisplay(out, settings, { includeSum: false }) || out
    if (parsed.sum?.trim()) out += `\n\n〔小结〕${parsed.sum.trim()}`
    return out
  }
  const cleaned = sanitizeAssistantForDisplay(raw, settings)
  return cleaned || String(raw || '').trim()
}

function hydrateMessagesFromSession(session: ChatSession) {
  if (!session.messages.length) {
    messages.value = defaultLocalMessages()
    return
  }
  const presetSettings =
    (presets.value.find((p) => p.id === session.presetId || p.id === settings.value?.activePresetId)
      ?.settings as Record<string, unknown> | undefined) ||
    (settings.value as unknown as Record<string, unknown> | null)
  messages.value = session.messages.map((m) => {
    const role = stRoleToTianji(m.role)
    const content =
      role === 'oracle'
        ? displayContentFromAssistant(m.content, m.parsed, presetSettings)
        : m.content
    return {
      id: m.id,
      role,
      content,
      time: new Date(m.timestamp).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
      }),
      choices: role === 'oracle' ? choicesFromParsed(m.parsed) : undefined,
    }
  })
  const lastAsst = [...session.messages].reverse().find((m) => m.role === 'assistant')
  lastParsed.value = lastAsst?.parsed ?? null
  seq = Math.max(seq, session.messages.length + 100)
}

async function ensureSession(s: AppSettings, allChats: ChatSession[]): Promise<ChatSession> {
  let session =
    allChats.find((c) => c.id === SESSION_KEY) ||
    allChats.find((c) => c.name === TIANJI_CHAT_NAME)

  if (!session) {
    session = {
      id: SESSION_KEY,
      name: TIANJI_CHAT_NAME,
      messages: [],
      characterName: s.characterName || '天机',
      userName: s.userName || '掌门',
      presetId: s.activePresetId,
      lorebookIds: [...(s.activeLorebookIds || [])],
      variables: snapshotGameVariables(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    await saveChat(session)
  } else {
    // 对齐气数：白名单用游戏最新
    session = {
      ...session,
      variables: mergeSessionWithGame(session.variables as Record<string, unknown>),
    }
    await saveChat(session)
  }
  return session
}

async function syncSystemLore(s: AppSettings) {
  const book = await ensureAndRefreshSystemLorebook({
    tableMemoryEnabled: s.tableMemoryEnabled !== false,
    contextLabel: contextInjected.value,
    contextDetail: contextDetail.value,
  })
  const list = await getLorebooks()
  lorebooks.value = list

  const ids = new Set(s.activeLorebookIds || [])
  if (!ids.has(SYSTEM_LOREBOOK_ID)) {
    ids.add(SYSTEM_LOREBOOK_ID)
    const next = { ...s, activeLorebookIds: [...ids] }
    await saveSettings(next)
    settings.value = next
  }
  return book
}

async function boot() {
  if (bootPromise) return bootPromise
  bootPromise = (async () => {
    try {
      await initializeDatabase()
      const [s, p, l, chats] = await Promise.all([
        getSettings(),
        getPresets(),
        getLorebooks(),
        getChats(),
      ])
      const merged: AppSettings = s
        ? {
            ...DEFAULT_SETTINGS,
            ...s,
            api: mergeApiSettings(s.api, DEFAULT_SETTINGS.api),
          }
        : {
            ...DEFAULT_SETTINGS,
            api: mergeApiSettings(undefined, DEFAULT_SETTINGS.api),
          }

      if (!s || s.characterName === DEFAULT_SETTINGS.characterName) {
        merged.characterName = '天机'
        merged.userName = '掌门'
      }
      merged.uiMode = 'game'
      if (!merged.settlementMode) {
        merged.settlementMode = 'secondary_then_primary'
      }
      if (merged.tableMemoryEnabled === undefined) merged.tableMemoryEnabled = true
      if (merged.historyCompress === undefined) merged.historyCompress = true
      if (
        merged.historyMaxTokens === undefined ||
        !Number.isFinite(merged.historyMaxTokens)
      ) {
        merged.historyMaxTokens = 12000
      }

      settings.value = merged
      // 同步一份到 localStorage，防 IDB 丢配置
      try {
        saveApiCache(merged.api)
      } catch {
        /* ignore */
      }
      presets.value = p
      lorebooks.value = l

      try {
        await syncSystemLore(merged)
      } catch (e) {
        console.warn('[天机] 系统世界书同步失败（可稍后重试）', e)
      }

      const session = await ensureSession(settings.value!, chats)
      chatSession.value = session
      hydrateMessagesFromSession(session)

      if (!settings.value!.activePresetId && p[0]) {
        const next = { ...settings.value!, activePresetId: p[0].id }
        await saveSettings(next)
        settings.value = next
      }

      ready.value = true
    } catch (e) {
      // 允许下次重试；开局不依赖 boot 成功
      bootPromise = null
      ready.value = false
      // 降级：至少从 localStorage 恢复 API，保证密匣可配、可推演
      if (!settings.value) {
        settings.value = {
          ...DEFAULT_SETTINGS,
          api: mergeApiSettings(undefined, DEFAULT_SETTINGS.api),
          characterName: '天机',
          userName: '掌门',
          uiMode: 'game',
        }
      }
      console.error('[天机] 初始化失败（已降级到内存/localStorage）', e)
      throw e
    }
  })()
  return bootPromise
}

// 后台预热，失败不阻断页面
void boot().catch(() => {
  /* ignore — 开局 / 首次推演时会再 boot */
})

async function persistSession(next: ChatSession) {
  chatSession.value = next
  await saveChat(next)
}

function appendLocal(
  role: TianjiMessage['role'],
  content: string,
  extra?: Partial<TianjiMessage>,
): TianjiMessage {
  const msg: TianjiMessage = {
    id: extra?.id ?? `tm-${++seq}`,
    role,
    content,
    time: nowLabel(),
    ...extra,
  }
  messages.value = [...messages.value, msg]
  return msg
}

async function appendToSt(
  role: ChatMessage['role'],
  content: string,
  extras?: Partial<ChatMessage>,
) {
  if (!chatSession.value) return
  const stMsg: ChatMessage = {
    id: extras?.id ?? crypto.randomUUID(),
    role,
    content,
    timestamp: Date.now(),
    variables: { ...(chatSession.value.variables as Record<string, string | number>) },
    ...extras,
  }
  const next: ChatSession = {
    ...chatSession.value,
    messages: [...chatSession.value.messages, stMsg],
    updatedAt: Date.now(),
  }
  await persistSession(next)
  return stMsg
}

/** 从保留消息尾部恢复局面快照（stateAfter）或旧版资源 variables */
function restoreVarsFromKept(
  kept: ChatMessage[],
): Record<string, string | number> {
  for (let i = kept.length - 1; i >= 0; i--) {
    const m = kept[i]
    if (m.role === 'assistant' && m.stateAfter) {
      restoreWorldState(m.stateAfter)
      return mergeSessionWithGame({})
    }
    if (m.role === 'assistant' && m.variablesAfter && typeof m.variablesAfter === 'object') {
      applyVariablesToGame(m.variablesAfter as Record<string, unknown>)
      return mergeSessionWithGame(m.variablesAfter as Record<string, unknown>)
    }
    if (m.variables && typeof m.variables === 'object' && Object.keys(m.variables).length) {
      applyVariablesToGame(m.variables as Record<string, unknown>)
      return mergeSessionWithGame(m.variables as Record<string, unknown>)
    }
  }
  // 无快照：仅用当前游戏态
  return snapshotGameVariables()
}

function refreshLastParsedFromSession(session: ChatSession) {
  const lastAsst = [...session.messages].reverse().find((m) => m.role === 'assistant')
  lastParsed.value = lastAsst?.parsed ?? null
}

/**
 * 在会话中定位消息下标。
 * 天机本地 id 与 ST 应对齐；若仅本地有 system 结算条，则按角色序列对齐失败时返回 -1。
 */
function findSessionMessageIndex(messageId: string): number {
  if (!chatSession.value) return -1
  const direct = chatSession.value.messages.findIndex((m) => m.id === messageId)
  if (direct >= 0) return direct

  // 回退：本地消息与 ST 按 user/assistant/system 内容前缀弱匹配
  const local = messages.value.find((m) => m.id === messageId)
  if (!local) return -1
  const roleMap: Record<TianjiMessage['role'], ChatMessage['role'] | null> = {
    player: 'user',
    oracle: 'assistant',
    system: 'system',
    event: 'system',
  }
  const stRole = roleMap[local.role]
  if (!stRole) return -1
  const needle = local.content.slice(0, 48)
  return chatSession.value.messages.findIndex(
    (m) => m.role === stRole && m.content.includes(needle.slice(0, 24)),
  )
}

/**
 * 截断会话：删除 messageId 及其后全部消息，气数回滚到保留末条快照。
 * @returns 是否成功
 */
async function truncateSessionAt(
  messageId: string,
  opts?: { inclusive?: boolean },
): Promise<boolean> {
  await boot()
  if (!chatSession.value || typing.value) return false
  const idx = findSessionMessageIndex(messageId)
  if (idx < 0) {
    // 纯本地消息（如气数结算提示）：仅裁本地
    const localIdx = messages.value.findIndex((m) => m.id === messageId)
    if (localIdx < 0) return false
    messages.value = messages.value.slice(0, localIdx)
    lastSettlement.value = null
    return true
  }

  const cut = opts?.inclusive === false ? idx + 1 : idx
  const kept = chatSession.value.messages.slice(0, cut)
  const restored = restoreVarsFromKept(kept)
  const next: ChatSession = {
    ...chatSession.value,
    messages: kept,
    variables: restored,
    updatedAt: Date.now(),
  }
  await persistSession(next)
  hydrateMessagesFromSession(next)
  refreshLastParsedFromSession(next)
  lastSettlement.value = null
  lastError.value = null
  if (settings.value) await syncSystemLore(settings.value)
  return true
}

async function callLlm(userText: string, onStream?: (text: string) => void): Promise<{
  content: string
  parsed: ParsedTags | null
  raw: string
  nextVariables: Record<string, string | number>
}> {
  const s = settings.value
  const session = chatSession.value
  if (!s || !session) throw new Error('天机未就绪')

  const tableMemoryOn = s.tableMemoryEnabled !== false

  // 推演前：用经营名册/势力/宝物填表格记忆底表，再刷系统世界书
  if (tableMemoryOn) {
    try {
      syncTableMemoryFromGame()
    } catch (e) {
      console.warn('[天机] 表格记忆同步失败', e)
    }
  }
  await syncSystemLore(s)

  const preset =
    presets.value.find((p) => p.id === s.activePresetId) || presets.value[0]
  if (!preset) throw new Error('尚无推演心法，请先在密匣/心法中配置')

  const activeIds = new Set(s.activeLorebookIds || [])
  activeIds.add(SYSTEM_LOREBOOK_ID)
  const books = lorebooks.value.filter((b) => activeIds.has(b.id))

  // 回合开始：游戏快照覆盖白名单
  const vars = mergeSessionWithGame({
    ...(session.variables as Record<string, unknown>),
    ...(contextInjected.value
      ? {
          当前事务: contextInjected.value,
          ...(contextDetail.value ? { 事务详情: contextDetail.value } : {}),
        }
      : {}),
  })

  const history: ChatMessage[] = session.messages.filter(
    (m) => m.role === 'user' || m.role === 'assistant',
  )

  const contextBlock = contextInjected.value
    ? `\n\n【当前注入事务】${contextInjected.value}${
        contextDetail.value ? `：${contextDetail.value}` : ''
      }`
    : ''

  // 激活预设：normalize 后再拼装（嵌套 order / prompts / 采样）
  const normalizedSettings = normalizePresetSettings(
    (preset.settings || {}) as Record<string, unknown>,
  )
  const livePreset: ChatPreset = { ...preset, settings: normalizedSettings }

  // 主推演格式 = 用户模板 +（可选）yuzuki 填表契约
  const baseFormat =
    s.formatPromptTemplate || DEFAULT_SETTINGS.formatPromptTemplate || ''
  const memoryFormatHint = tableMemoryOn ? buildMainFormatMemoryHint() : ''
  const formatPrompt = memoryFormatHint
    ? `${baseFormat}\n\n${memoryFormatHint}`
    : baseFormat

  const { messages: promptMessages } = assemblePrompt({
    userInput: userText + contextBlock,
    history,
    preset: livePreset,
    lorebooks: books,
    userName: s.userName || '掌门',
    characterName: s.characterName || '天机',
    variables: vars,
    extraVariables: vars,
    formatPrompt,
    historyKeepMessages:
      typeof s.historyKeepMessages === 'number' ? s.historyKeepMessages : 12,
    historyCompress: s.historyCompress !== false,
    historyMaxTokens:
      typeof s.historyMaxTokens === 'number' ? s.historyMaxTokens : 12000,
  })

  const sampling = getSamplingForApi(normalizedSettings)
  // ★ 密匣模型优先，不用被预设默认 gpt-3.5-turbo 盖掉
  const model = (s.api.model || sampling.model || '').trim()
  const base = normalizeBaseUrl(s.api.baseUrl || '')
  if (!base || !s.api.apiKey?.trim() || !model) {
    const miss = apiConfigMissing(s.api)
    throw new Error(`密匣未配齐：缺少 ${miss.join('、')}。请打开右上角密匣填写后保存。`)
  }

  const body: Record<string, unknown> = {
    model,
    messages: promptMessages,
    stream: false,
  }
  if (sampling.temperature !== undefined) body.temperature = sampling.temperature
  if (sampling.max_tokens !== undefined) body.max_tokens = sampling.max_tokens
  if (sampling.top_p !== undefined) body.top_p = sampling.top_p
  if (sampling.frequency_penalty !== undefined) body.frequency_penalty = sampling.frequency_penalty
  if (sampling.presence_penalty !== undefined) body.presence_penalty = sampling.presence_penalty
  if (sampling.top_k !== undefined) body.top_k = sampling.top_k
  if (sampling.min_p !== undefined) body.min_p = sampling.min_p
  if (sampling.repetition_penalty !== undefined) {
    body.repetition_penalty = sampling.repetition_penalty
  }

  let rawOriginal = ''

  if (s.api.stream && onStream) {
    // 流式：逐块回调显示
    const result = await postChatCompletionStream({
      baseUrl: base,
      apiKey: String(s.api.apiKey || ''),
      body,
      onChunk: (_delta, accumulated) => onStream(accumulated),
    })
    if (!result.ok) throw new Error(`天机感应受阻：${result.error}`)
    rawOriginal = result.text
  } else {
    // 非流式
    const completion = await postChatCompletion({
      baseUrl: base,
      apiKey: String(s.api.apiKey || ''),
      body,
    })
    if (!completion.ok) throw new Error(`天机感应受阻：${completion.error}`)
    const data = completion.data as {
      choices?: Array<{ message?: { content?: string } }>
    }
    rawOriginal = data.choices?.[0]?.message?.content || ''
  }

  if (!rawOriginal.trim()) {
    throw new Error('天机返回为空，请检查模型名是否与中转一致')
  }

  // 标签解析必须用原文，避免 display regex 误伤 <vars>/<Memory>
  const raw = rawOriginal

  const tags = s.customTags?.length ? s.customTags : [...DEFAULT_TAGS]
  const parser = new StreamTagParser(tags, [...DEFAULT_OPAQUE_TAGS])
  const events = [...parser.feed(raw), ...parser.finish()]
  const parsed = aggregateEvents(events)
  const hasTags = !!(parsed.maintext || parsed.options.length || parsed.sum)

  // 展示：剥标签 / 抽 maintext（与解析分离）
  const { cleanedText } = extractVariables(raw)
  const displayFallback = sanitizeAssistantForDisplay(
    cleanedText || raw,
    normalizedSettings as Record<string, unknown>,
  )

  // 会话气数键与游戏资源对齐（只读同步），不应用 LLM vars 补丁
  const settled = mergeSessionWithGame({})

  // ★ 表格记忆：助手文中 <Memory>/<GaigaiMemory>/<tableEdit> → 主键合并
  const memoryTagged = tableMemoryOn && hasMemoryTag(raw)
  if (memoryTagged) {
    applyAssistantMemoryTags(raw)
  }

  // ★ 短/中/长期记忆：写入 <sum> → 系统世界书 constant 条目
  // 表格世界状态与 sum 层一并刷新进系统世界书（assemble 前也会 sync）
  if (parsed.sum?.trim() || memoryTagged) {
    if (parsed.sum?.trim()) {
      recordTurnSum(parsed.sum, { context: contextInjected.value })
    }
    await ensureAndRefreshSystemLorebook({
      contextLabel: contextInjected.value,
      contextDetail: contextDetail.value,
      tableMemoryEnabled: tableMemoryOn,
    })
    lorebooks.value = await getLorebooks()
  }

  const content = hasTags
    ? displayContentFromAssistant(cleanedText || raw, parsed, normalizedSettings as Record<string, unknown>)
    : displayFallback || sanitizeAssistantForDisplay(raw, normalizedSettings as Record<string, unknown>) || cleanedText || raw

  return {
    content,
    parsed: hasTags ? parsed : null,
    raw: rawOriginal,
    nextVariables: settled,
  }
}

export function useTianji() {
  const llmReady = computed(() => hasApiKey(settings.value))
  const apiMissing = computed(() => apiConfigMissing(settings.value?.api))
  const statusLabel = computed(() => {
    if (!ready.value && !settings.value) return '卷轴展开中…'
    if (llmReady.value) {
      const m = settings.value?.api?.model || ''
      return m ? `天机已通 · ${m}` : '天机已通'
    }
    const miss = apiMissing.value
    if (miss.length) return `未通灵：请配 ${miss.join('/')}`
    return '未通灵（本地推演）'
  })

  const activeLorebookIds = computed(() => settings.value?.activeLorebookIds ?? [])
  const sessionVariables = computed(
    () =>
      (chatSession.value?.variables as Record<string, string | number>) ??
      snapshotGameVariables(),
  )

  const displayMain = computed(() => {
    if (lastParsed.value?.maintext?.trim()) {
      // 已解析正文再剥一层，防 maintext 内嵌套标签
      return (
        sanitizeAssistantForDisplay(lastParsed.value.maintext, null, {
          includeSum: false,
        }) || lastParsed.value.maintext
      )
    }
    const last = [...messages.value].reverse().find((m) => m.role === 'oracle')
    // 消息 content 在写入时已 sanitize；流式中途可能仍是 raw
    if (!last?.content) return ''
    if (/<[A-Za-z\u4e00-\u9fff][\w\u4e00-\u9fff:.-]{0,40}[\s>]/.test(last.content)) {
      return sanitizeAssistantForDisplay(last.content) || last.content
    }
    return last.content
  })

  const displayOptions = computed(() => lastParsed.value?.options ?? [])
  const displaySum = computed(() => lastParsed.value?.sum ?? '')
  const displayThinking = computed(() => lastParsed.value?.thinking ?? '')

  function injectContext(label: string, detail?: string) {
    contextInjected.value = label
    contextDetail.value = detail ?? null
    appendLocal('system', `已注入事务上下文：【${label}】${detail ? ` ${detail}` : ''}`, {
      contextTag: label,
    })
    void appendToSt('system', `【事务注入】${label}${detail ? `：${detail}` : ''}`)
    if (settings.value) void syncSystemLore(settings.value)
  }

  async function sendPlayer(content: string) {
    const text = content.trim()
    if (!text || typing.value || settling.value) return
    await boot()
    lastError.value = null
    lastSettlement.value = null
    lastSettlementKind.value = null

    const ctx = contextInjected.value
    const playerLocal = appendLocal('player', text, { contextTag: ctx ?? undefined })
    // 与本地同 id，便于删楼 / 重 roll 定位
    await appendToSt('user', text, { id: playerLocal.id })

    typing.value = true
    try {
      if (!hasApiKey(settings.value)) {
        await new Promise((r) => setTimeout(r, 700 + Math.random() * 500))
        const reply = pickReply(text, ctx)
        lastParsed.value = null
        const snap = snapshotWorldState()
        const vars = snapshotGameVariables()
        const oracleLocal = appendLocal('oracle', reply, { contextTag: ctx ?? undefined })
        await appendToSt('assistant', reply, {
          id: oracleLocal.id,
          variables: vars,
          variablesAfter: vars,
          stateAfter: snap,
        })
        return
      }

      const useStream = !!settings.value?.api?.stream
      let streamMsg: ReturnType<typeof appendLocal> | null = null
      if (useStream) {
        streamMsg = appendLocal('oracle', '…', { contextTag: ctx ?? undefined })
      }

      const result = await callLlm(text, useStream ? (partial) => {
        if (streamMsg) {
          // 流式也走展示净化：避免主 API 预设标签刷屏
          const live = sanitizeAssistantForDisplay(partial) || partial
          messages.value = messages.value.map((m) =>
            m.id === streamMsg!.id ? { ...m, content: live } : m,
          )
        }
      } : undefined)
      lastParsed.value = result.parsed
      const choices = choicesFromParsed(result.parsed)

      const local = streamMsg ?? appendLocal('oracle', result.content, {
        contextTag: ctx ?? undefined,
        choices,
      })
      // 流式结束后用最终解析内容替换
      if (streamMsg) {
        messages.value = messages.value.map((m) =>
          m.id === local.id ? { ...m, content: result.content, choices } : m,
        )
      }

      // ★ 先落盘剧情，再后台局面分析（避免分析超时拖死整回合）
      const sessionVars = mergeSessionWithGame({})
      let stateAfter = snapshotWorldState()
      if (chatSession.value) {
        const stMsg: ChatMessage = {
          id: local.id,
          role: 'assistant',
          content: result.raw || result.content,
          timestamp: Date.now(),
          parsed: result.parsed ?? undefined,
          variablesAfter: sessionVars,
          variables: sessionVars,
          stateAfter,
        }
        const next: ChatSession = {
          ...chatSession.value,
          messages: [...chatSession.value.messages, stMsg],
          variables: sessionVars,
          updatedAt: Date.now(),
        }
        await persistSession(next)
      }

      // 剧情已可见：结束「推演中」；分析单独占 settling，避免叠超时体感
      typing.value = false

      if (settings.value) {
        const postChatForSide = async ({
          target,
          body,
        }: {
          target: 'primary' | 'secondary' | 'memory'
          body: Record<string, unknown>
        }) => {
          const api = settings.value!.api
          let ep: { baseUrl: string; apiKey: string; model: string }
          if (target === 'memory' && api.memory?.enabled) {
            ep = {
              baseUrl: normalizeBaseUrl(api.memory.baseUrl || ''),
              apiKey: String(api.memory.apiKey || ''),
              model: String(api.memory.model || '').trim(),
            }
          } else if (target === 'secondary' && api.secondary?.enabled) {
            ep = {
              baseUrl: normalizeBaseUrl(api.secondary.baseUrl || ''),
              apiKey: String(api.secondary.apiKey || ''),
              model: String(api.secondary.model || '').trim(),
            }
          } else {
            ep = {
              baseUrl: normalizeBaseUrl(api.baseUrl || ''),
              apiKey: String(api.apiKey || ''),
              model: String(api.model || '').trim() || String(body.model || ''),
            }
          }
          const model = ep.model || String(body.model || '')
          const completion = await postChatCompletion({
            baseUrl: ep.baseUrl,
            apiKey: ep.apiKey,
            body: { ...body, model, stream: false },
          })
          if (!completion.ok) {
            return { ok: false as const, error: completion.error || '请求失败' }
          }
          return textFromSettleCompletion(completion.data)
        }

        settling.value = true
        lastSettlementKind.value = 'info'
        lastSettlement.value = '局面分析中…'
        try {
          const settle = await runSettle({
            userText: text,
            maintext: result.parsed?.maintext || result.content,
            sum: result.parsed?.sum || '',
            settings: settings.value,
            postChat: postChatForSide,
          })

          if (settle.status === 'skipped') {
            stateAfter = snapshotWorldState()
            lastSettlementKind.value = 'info'
            lastSettlement.value = settle.reason === 'off' ? '局面分析已关闭' : '未配次 API，已跳过'
          } else if (settle.status === 'failed') {
            stateAfter = settle.stateAfter
            lastSettlementKind.value = 'fail'
            const raw = settle.error || '未知错误'
            lastSettlement.value = raw.length > 60 ? raw.slice(0, 60) + '…' : raw
          } else if (settle.status === 'applied') {
            stateAfter = settle.stateAfter
            const lines = settle.lines.join('；')
            lastSettlementKind.value = 'ok'
            lastSettlement.value = lines
            appendLocal('system', `【局面更新】${lines}`)
            void appendToSt('system', `【局面更新】${lines}`)
            if (settings.value) {
              await syncSystemLore(settings.value)
              lorebooks.value = await getLorebooks()
            }
          } else {
            stateAfter = settle.stateAfter
            lastSettlementKind.value = 'info'
            lastSettlement.value = '本回无变更'
          }

          // ★ shujuku 完整流水线：楼层调度 → 填表 → 纪要合并 → retain 清理
          // （次 API settle 已在上面完成，与本流水线分离）
          if (settings.value.tableMemoryEnabled !== false) {
            memoryTracing.value = true
            lastMemoryTraceKind.value = 'info'
            lastMemoryTrace.value = '表格记忆流水线…'
            try {
              const pipe = await runTableMemoryPipeline({
                messages: chatSession.value?.messages || [],
                userText: text,
                maintext: result.parsed?.maintext || result.content,
                sum: result.parsed?.sum || '',
                settings: settings.value,
                postChat: postChatForSide,
              })
              const parts: string[] = []
              if (!pipe.scheduled) {
                parts.push(
                  pipe.scheduleReason === 'not_ready'
                    ? `调度未触发(下一触 ${pipe.nextTriggerFloor} 层)`
                    : `调度跳过(${pipe.scheduleReason})`,
                )
              } else if (pipe.fill?.status === 'applied') {
                parts.push(`填表+${pipe.fill.count}`)
              } else if (pipe.fill?.status === 'empty') {
                parts.push('填表无新增')
              } else if (pipe.fill?.status === 'skipped') {
                parts.push(
                  pipe.fill.reason === 'memory_api_not_ready'
                    ? '记忆API未配齐'
                    : pipe.fill.reason === 'api_not_ready'
                      ? '未通灵'
                      : '填表跳过',
                )
              } else if (pipe.fill?.status === 'failed') {
                parts.push(`填表失败`)
              }
              if (pipe.merge?.status === 'merged') {
                parts.push(
                  `纪要合并 -${pipe.merge.removed || 0}/+${pipe.merge.added || 0}`,
                )
              } else if (pipe.merge?.status === 'failed') {
                parts.push('合并失败')
              }
              parts.push(`楼${pipe.lastUpdatedAiFloor}/${pipe.totalAiFloors}`)
              lastMemoryTrace.value = parts.join(' · ')
              lastMemoryTraceKind.value =
                pipe.fill?.status === 'failed' || pipe.merge?.status === 'failed'
                  ? 'fail'
                  : pipe.fill?.status === 'applied' || pipe.merge?.status === 'merged'
                    ? 'ok'
                    : 'info'
              if (settings.value) {
                await ensureAndRefreshSystemLorebook({
                  contextLabel: contextInjected.value,
                  contextDetail: contextDetail.value,
                  tableMemoryEnabled: true,
                  recallQuery: text,
                })
                lorebooks.value = await getLorebooks()
              }
            } catch (memErr) {
              lastMemoryTraceKind.value = 'fail'
              lastMemoryTrace.value = String((memErr as Error).message || memErr).slice(0, 48)
            } finally {
              memoryTracing.value = false
            }
          } else {
            lastMemoryTraceKind.value = 'info'
            lastMemoryTrace.value = '表格记忆已关闭'
          }

          // 把 stateAfter 回写到本条 assistant，供删楼回滚
          if (chatSession.value) {
            const msgs = chatSession.value.messages.map((m) =>
              m.id === local.id
                ? {
                    ...m,
                    stateAfter,
                    variablesAfter: mergeSessionWithGame({}),
                    variables: mergeSessionWithGame({}),
                  }
                : m,
            )
            await persistSession({
              ...chatSession.value,
              messages: msgs,
              variables: mergeSessionWithGame({}),
              updatedAt: Date.now(),
            })
          }
        } catch (settleErr) {
          const msg = String((settleErr as Error).message || settleErr)
          lastSettlementKind.value = 'fail'
          lastSettlement.value = msg.length > 60 ? msg.slice(0, 60) + '…' : msg
        } finally {
          settling.value = false
          memoryTracing.value = false
        }
      }
    } catch (e) {
      const msg = (e as Error).message || String(e)
      lastError.value = msg
      appendLocal('system', `推演中断：${msg}`)
    } finally {
      typing.value = false
      settling.value = false
    }
  }

  const canRegenerate = computed(() => {
    if (typing.value || settling.value || !chatSession.value) return false
    return chatSession.value.messages.some((m) => m.role === 'user')
  })

  /**
   * 重 roll：删掉最后一轮 user 及其后回复，气数回滚，再用原文重发。
   */
  async function regenerateLast() {
    if (typing.value) return
    await boot()
    if (!chatSession.value) return

    const msgs = chatSession.value.messages
    let lastUserIdx = -1
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') {
        lastUserIdx = i
        break
      }
    }
    if (lastUserIdx < 0) {
      lastError.value = '没有可重推的掌门发言'
      return
    }

    const content = msgs[lastUserIdx].content
    const kept = msgs.slice(0, lastUserIdx)
    const restored = restoreVarsFromKept(kept)
    const next: ChatSession = {
      ...chatSession.value,
      messages: kept,
      variables: restored,
      updatedAt: Date.now(),
    }
    await persistSession(next)
    hydrateMessagesFromSession(next)
    refreshLastParsedFromSession(next)
    lastSettlement.value = null
    lastError.value = null
    if (settings.value) await syncSystemLore(settings.value)

    await sendPlayer(content)
  }

  /**
   * 从此条删除（含本条）：截断会话并回滚气数。
   */
  async function deleteMessagesFrom(messageId: string) {
    if (typing.value) return
    const ok = await truncateSessionAt(messageId, { inclusive: true })
    if (!ok) lastError.value = '未找到该条消息'
  }

  /**
   * 编辑已发送的玩家消息：截断到该条（含），用新内容重新推演。
   */
  async function editAndResend(messageId: string, newContent: string) {
    const text = newContent.trim()
    if (!text || typing.value) return
    const ok = await truncateSessionAt(messageId, { inclusive: true })
    if (!ok) {
      lastError.value = '未找到该条消息'
      return
    }
    await sendPlayer(text)
  }

  /**
   * 仅删除此条之后（保留本条）：用于「回到此楼」后不重发。
   */
  async function truncateAfter(messageId: string) {
    if (typing.value) return
    const ok = await truncateSessionAt(messageId, { inclusive: false })
    if (!ok) lastError.value = '未找到该条消息'
  }

  function chooseQuick(choiceLabel: string, parentId?: string) {
    if (parentId) {
      messages.value = messages.value.map((m) =>
        m.id === parentId ? { ...m, choices: undefined } : m,
      )
    }
    void sendPlayer(choiceLabel)
  }

  function pushEvent(content: string, tag?: string) {
    appendLocal('event', content, { contextTag: tag })
    void appendToSt('system', `【事件】${content}`)
  }

  function clearContext() {
    contextInjected.value = null
    contextDetail.value = null
    if (settings.value) void syncSystemLore(settings.value)
  }

  async function updateSettings(partial: Partial<AppSettings>) {
    // 先落内存，保证密匣输入即时生效；不因 boot/IndexedDB 失败而丢改
    if (!settings.value) {
      settings.value = {
        ...DEFAULT_SETTINGS,
        api: {
          ...DEFAULT_SETTINGS.api,
          secondary: { ...DEFAULT_SETTINGS.api.secondary! },
          memory: { ...DEFAULT_SETTINGS.api.memory! },
        },
      }
    }
    const base = settings.value
    // 用 JSON 剥掉 Vue Proxy，避免后续 IDB put DataCloneError
    const plainBase = JSON.parse(JSON.stringify(base)) as AppSettings
    const next: AppSettings = {
      ...plainBase,
      ...JSON.parse(JSON.stringify(partial)),
      key: 'settings',
    }
    if (partial.api) {
      next.api = {
        ...plainBase.api,
        ...JSON.parse(JSON.stringify(partial.api)),
        secondary: {
          ...(plainBase.api.secondary ?? DEFAULT_SETTINGS.api.secondary!),
          ...(partial.api.secondary
            ? JSON.parse(JSON.stringify(partial.api.secondary))
            : {}),
        },
        memory: {
          ...(plainBase.api.memory ?? DEFAULT_SETTINGS.api.memory!),
          ...(partial.api.memory
            ? JSON.parse(JSON.stringify(partial.api.memory))
            : {}),
        },
      }
    }
    // 规范化 URL；数组字段保证是纯数组
    next.api = {
      ...next.api,
      baseUrl: normalizeBaseUrl(next.api.baseUrl || ''),
      secondary: next.api.secondary
        ? {
            ...next.api.secondary,
            baseUrl: normalizeBaseUrl(next.api.secondary.baseUrl || ''),
          }
        : next.api.secondary,
      memory: next.api.memory
        ? {
            ...next.api.memory,
            baseUrl: normalizeBaseUrl(next.api.memory.baseUrl || ''),
          }
        : next.api.memory,
    }
    next.activeLorebookIds = Array.isArray(next.activeLorebookIds)
      ? [...next.activeLorebookIds]
      : []
    next.customTags = Array.isArray(next.customTags) ? [...next.customTags] : [...DEFAULT_SETTINGS.customTags]
    settings.value = next
    saveApiCache(next.api)

    try {
      if (!ready.value) {
        await boot().catch((e) => console.warn('[密匣] boot 失败，设置仅存内存/localStorage', e))
      }
      await saveSettings(next)
    } catch (e) {
      console.warn('[密匣] IndexedDB 失败，已写入 localStorage 备份', e)
      lastError.value =
        '密匣已用本地备份保存；IndexedDB 写入失败：' + ((e as Error).message || String(e))
    }
  }

  async function reloadStMeta() {
    const [p, l, s] = await Promise.all([getPresets(), getLorebooks(), getSettings()])
    presets.value = p
    lorebooks.value = l
    if (s) {
      settings.value = {
        ...DEFAULT_SETTINGS,
        ...s,
        api: mergeApiSettings(s.api, DEFAULT_SETTINGS.api),
      }
      saveApiCache(settings.value.api)
      await syncSystemLore(settings.value)
    }
    if (chatSession.value) {
      const synced = {
        ...chatSession.value,
        variables: mergeSessionWithGame(chatSession.value.variables as Record<string, unknown>),
      }
      await persistSession(synced)
    }
  }

  async function toggleLorebook(id: string) {
    if (!settings.value) return
    if (id === SYSTEM_LOREBOOK_ID) return // 系统书不可关
    const cur = settings.value.activeLorebookIds || []
    const nextIds = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    await updateSettings({ activeLorebookIds: nextIds })
  }

  async function updateLorebook(book: Lorebook) {
    const next = { ...book, updatedAt: Date.now() }
    await saveLorebook(next)
    lorebooks.value = lorebooks.value.some((b) => b.id === next.id)
      ? lorebooks.value.map((b) => (b.id === next.id ? next : b))
      : [...lorebooks.value, next]
  }

  async function removeLorebook(id: string) {
    if (id === SYSTEM_LOREBOOK_ID) return
    await deleteLorebookDb(id)
    lorebooks.value = lorebooks.value.filter((b) => b.id !== id)
    if (settings.value?.activeLorebookIds?.includes(id)) {
      await updateSettings({
        activeLorebookIds: settings.value.activeLorebookIds.filter((x) => x !== id),
      })
    }
  }

  async function addLorebookFromDefault(name: string) {
    const base = createDefaultLorebook(name)
    await updateLorebook(base)
    return base
  }

  async function updatePreset(preset: ChatPreset, opts?: { flatIsAuthoritative?: boolean }) {
    const settings = normalizePresetSettings(
      (preset.settings || {}) as Record<string, unknown>,
      { flatIsAuthoritative: opts?.flatIsAuthoritative },
    )
    const next: ChatPreset = {
      ...preset,
      settings,
      updatedAt: Date.now(),
    }
    // Dexie 安全：JSON 克隆去掉不可序列化字段
    const safe = JSON.parse(JSON.stringify(next)) as ChatPreset
    await savePreset(safe)
    presets.value = presets.value.some((p) => p.id === safe.id)
      ? presets.value.map((p) => (p.id === safe.id ? safe : p))
      : [...presets.value, safe]
  }

  async function removePreset(id: string) {
    await deletePresetDb(id)
    presets.value = presets.value.filter((p) => p.id !== id)
    if (settings.value?.activePresetId === id) {
      await updateSettings({ activePresetId: null })
    }
  }

  async function addPresetFromDefault(name: string) {
    const data = createDefaultPreset()
    const preset: ChatPreset = {
      ...data,
      id: crypto.randomUUID(),
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    await updatePreset(preset)
    return preset
  }

  /**
   * 从头开局：清空天机会话，写入开场卷首，气数对齐当前游戏快照。
   * 宗门/掌门/难度须已由 applyOpeningConfig 写入 game state。
   * 不抛错阻断开局：DB 失败时仍写入本地卷首消息。
   */
  /**
   * 记忆锦囊手动触发：强制跑完整流水线（忽略 frequency 门闩）。
   */
  async function runManualMemoryTrace(): Promise<{ ok: boolean; message: string }> {
    await boot()
    if (!settings.value || settings.value.tableMemoryEnabled === false) {
      return { ok: false, message: '表格记忆总开关已关闭' }
    }
    if (!settings.value || !hasApiKey(settings.value)) {
      return { ok: false, message: '未通灵，无法追溯' }
    }
    const session = chatSession.value
    if (!session?.messages?.length) {
      return { ok: false, message: '尚无会话' }
    }
    let lastUser = ''
    let lastAsst = ''
    for (let i = session.messages.length - 1; i >= 0; i--) {
      const m = session.messages[i]
      if (!lastAsst && m.role === 'assistant') lastAsst = m.content
      if (!lastUser && m.role === 'user') lastUser = m.content
      if (lastUser && lastAsst) break
    }
    if (!lastAsst) return { ok: false, message: '没有可追溯的天机正文' }

    memoryTracing.value = true
    lastMemoryTraceKind.value = 'info'
    lastMemoryTrace.value = '手动流水线…'
    try {
      const postChat = async ({
        target,
        body,
      }: {
        target: 'memory' | 'secondary' | 'primary'
        body: Record<string, unknown>
      }) => {
        const api = settings.value!.api
        let ep: { baseUrl: string; apiKey: string; model: string }
        if (target === 'memory' && api.memory?.enabled) {
          ep = {
            baseUrl: normalizeBaseUrl(api.memory.baseUrl || ''),
            apiKey: String(api.memory.apiKey || ''),
            model: String(api.memory.model || '').trim(),
          }
        } else if (target === 'secondary' && api.secondary?.enabled) {
          ep = {
            baseUrl: normalizeBaseUrl(api.secondary.baseUrl || ''),
            apiKey: String(api.secondary.apiKey || ''),
            model: String(api.secondary.model || '').trim(),
          }
        } else {
          ep = {
            baseUrl: normalizeBaseUrl(api.baseUrl || ''),
            apiKey: String(api.apiKey || ''),
            model: String(api.model || '').trim() || String(body.model || ''),
          }
        }
        const model = ep.model || String(body.model || '')
        const completion = await postChatCompletion({
          baseUrl: ep.baseUrl,
          apiKey: ep.apiKey,
          body: { ...body, model, stream: false },
        })
        if (!completion.ok) {
          return { ok: false as const, error: completion.error || '请求失败' }
        }
        return textFromSettleCompletion(completion.data)
      }

      const pipe = await runTableMemoryPipeline({
        messages: session.messages,
        userText: lastUser,
        maintext: lastAsst,
        sum: lastParsed.value?.sum || '',
        settings: settings.value,
        force: true,
        postChat,
      })
      const parts: string[] = ['手动']
      if (pipe.fill?.status === 'applied') parts.push(`填表+${pipe.fill.count}`)
      else if (pipe.fill?.status === 'empty') parts.push('填表无新增')
      else if (pipe.fill?.status === 'failed') parts.push(`填表失败:${pipe.fill.error}`)
      else if (pipe.fill?.status === 'skipped') parts.push(`填表跳过:${pipe.fill.reason}`)
      if (pipe.merge?.status === 'merged') {
        parts.push(`合并-${pipe.merge.removed}/+${pipe.merge.added}`)
      }
      parts.push(`楼${pipe.lastUpdatedAiFloor}/${pipe.totalAiFloors}`)
      lastMemoryTrace.value = parts.join(' · ')
      lastMemoryTraceKind.value =
        pipe.fill?.status === 'failed' ? 'fail' : pipe.fill?.status === 'applied' ? 'ok' : 'info'
      await ensureAndRefreshSystemLorebook({
        contextLabel: contextInjected.value,
        contextDetail: contextDetail.value,
        tableMemoryEnabled: true,
        recallQuery: lastUser,
      })
      lorebooks.value = await getLorebooks()
      return {
        ok: pipe.fill?.status !== 'failed',
        message: lastMemoryTrace.value,
      }
    } catch (e) {
      const msg = String((e as Error).message || e)
      lastMemoryTraceKind.value = 'fail'
      lastMemoryTrace.value = msg.slice(0, 48)
      return { ok: false, message: msg }
    } finally {
      memoryTracing.value = false
    }
  }

  async function startOpeningRun() {
    lastError.value = null
    lastSettlement.value = null
    lastParsed.value = null
    contextInjected.value = '赤焰谷使者'
    contextDetail.value = '三日之内求见掌门，言及矿脉共享'
    typing.value = false

    loadMemoryBank()
    loadTableMemory()
    try {
      syncTableMemoryFromGame()
    } catch (e) {
      console.warn('[天机] 开局表格记忆同步失败', e)
    }

    const gs = useGameState()
    const seed = buildOpeningTianjiMessages(
      String(gs.masterName.value || '掌门'),
      String(gs.sectName.value || '本宗'),
    )
    messages.value = seed
    seq = 200

    try {
      await boot()
    } catch (e) {
      console.warn('[天机] 开局 boot 失败，仅用本地卷首', e)
      return
    }

    const s = settings.value
    if (!s) return

    try {
      const stMessages: ChatMessage[] = seed.map((m) => ({
        id: m.id,
        role:
          m.role === 'player' ? 'user' : m.role === 'oracle' ? 'assistant' : 'system',
        content: m.content,
        timestamp: Date.now(),
        variables: snapshotGameVariables(),
      }))

      const masterLabel = String(gs.masterName.value || '掌门')
      const session: ChatSession = {
        id: SESSION_KEY,
        name: TIANJI_CHAT_NAME,
        messages: stMessages,
        characterName: s.characterName || '天机',
        userName: s.userName || masterLabel,
        presetId: s.activePresetId,
        lorebookIds: [...(s.activeLorebookIds || [])],
        variables: snapshotGameVariables(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      await persistSession(session)
      await syncSystemLore(s)
    } catch (e) {
      console.warn('[天机] 开局会话落库失败', e)
    }
  }

  /** 气数簿：手改并结算到游戏 */
  async function setSessionVariables(draft: Record<string, string | number>) {
    await boot()
    if (!chatSession.value) return
    const before = snapshotGameVariables()
    const settled = commitVariablesFromEditor(
      draft,
      chatSession.value.variables as Record<string, unknown>,
    )
    const after = snapshotGameVariables()
    const lines: string[] = []
    for (const k of Object.keys(before) as (keyof typeof before)[]) {
      if (before[k] !== after[k] && typeof before[k] === 'number') {
        lines.push(`${k} ${before[k]} → ${after[k]}`)
      }
    }
    if (lines.length) {
      lastSettlementKind.value = 'ok'
      lastSettlement.value = lines.join('；')
      appendLocal('system', `【气数手改】${lines.join('；')}`)
      toast.success('气数已手改', lines.join('；').slice(0, 120))
    }
    await persistSession({
      ...chatSession.value,
      variables: settled,
      updatedAt: Date.now(),
    })
    if (settings.value) await syncSystemLore(settings.value)
  }

  return {
    messages,
    typing,
    settling,
    contextInjected,
    contextDetail,
    ready,
    lastError,
    lastSettlement,
    lastSettlementKind,
    lastMemoryTrace,
    lastMemoryTraceKind,
    memoryTracing,
    lastParsed,
    llmReady,
    apiMissing,
    statusLabel,
    settings: computed(() => settings.value),
    presets: computed(() => presets.value),
    lorebooks: computed(() => lorebooks.value),
    activeLorebookIds,
    sessionVariables,
    chatSession: computed(() => chatSession.value),
    displayMain,
    displayOptions,
    displaySum,
    displayThinking,
    showSettings,
    showLorebooks,
    showPresets,
    showVariables,
    showMemory,
    injectContext,
    sendPlayer,
    chooseQuick,
    regenerateLast,
    deleteMessagesFrom,
    editAndResend,
    truncateAfter,
    canRegenerate,
    pushEvent,
    clearContext,
    updateSettings,
    reloadStMeta,
    boot,
    toggleLorebook,
    updateLorebook,
    deleteLorebook: removeLorebook,
    addLorebookFromDefault,
    updatePreset,
    deletePreset: removePreset,
    addPresetFromDefault,
    setSessionVariables,
    startOpeningRun,
    runManualMemoryTrace,
    getTableMemorySchedulerStatus: () =>
      getSchedulerStatus(settings.value || ({} as AppSettings), chatSession.value?.messages || []),
  }
}
