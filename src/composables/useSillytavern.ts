/**
 * Vue composable for SillyTavern Web integration.
 * Multi-session chat, lorebooks, presets, variables, game-mode streaming.
 */
import { ref, computed, onMounted } from 'vue'
import {
  getLorebooks,
  saveLorebook,
  deleteLorebook as deleteLorebookDb,
  getPresets,
  savePreset,
  deletePreset as deletePresetDb,
  getSettings,
  saveSettings,
  initializeDatabase,
  getChats,
  saveChat,
  deleteChat as deleteChatById,
  assemblePrompt,
  extractVariables,
  mergeVariables,
  USER_ROLE,
  truncateChatAt,
  branchChat,
  createApiRouter,
  StreamTagParser,
  aggregateEvents,
  applyParsedToChat,
  createDefaultLorebook,
  createDefaultPreset,
  DEFAULT_SETTINGS,
  DEFAULT_TAGS,
  DEFAULT_OPAQUE_TAGS,
  type Lorebook,
  type ChatPreset,
  type AppSettings,
  type ChatSession,
  type ChatMessage,
  type ParserEvent,
} from '../sillytavern'

export interface StreamParserState {
  thinking: string
  maintext: string
  options: string[]
  sum: string
  varsRaw: string
  isStreaming: boolean
}

const initialStreamState: StreamParserState = {
  thinking: '',
  maintext: '',
  options: [],
  sum: '',
  varsRaw: '',
  isStreaming: false,
}

// Shared singleton state so multiple components share the same ST session
const lorebooks = ref<Lorebook[]>([])
const presets = ref<ChatPreset[]>([])
const settings = ref<AppSettings | null>(null)
const activeLorebookIds = ref<string[]>([])
const chats = ref<ChatSession[]>([])
const activeChatId = ref<string | null>(null)
const isSending = ref(false)
const isLoading = ref(true)
const initialized = ref(false)

const showSettings = ref(false)
const showLorebooks = ref(false)
const showPresets = ref(false)
const showVariables = ref(false)
const showChatModal = ref(false)

const toast = ref<string | null>(null)
const streamState = ref<StreamParserState>({ ...initialStreamState })

let parser: StreamTagParser | null = null
let eventBuf: ParserEvent[] = []
let abortController: AbortController | null = null
let toastTimer: ReturnType<typeof setTimeout> | null = null
let loadPromise: Promise<void> | null = null

function showToast(message: string) {
  toast.value = message
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toast.value = null
  }, 2200)
}

function applyStreamEvents(prev: StreamParserState, events: ParserEvent[]): StreamParserState {
  const next = { ...prev, options: [...prev.options] }
  for (const ev of events) {
    if (ev.type === 'tag-chunk') {
      if (ev.tag === 'maintext') next.maintext += ev.chunk
      else if (ev.tag === 'thinking' || ev.tag === 'think') next.thinking += ev.chunk
      else if (ev.tag === 'sum') next.sum += ev.chunk
      else if (ev.tag === 'vars') next.varsRaw += ev.chunk
    } else if (ev.type === 'option-line') {
      next.options.push(ev.line)
    }
  }
  return next
}

async function loadAll(force = false) {
  if (loadPromise && !force) return loadPromise
  loadPromise = (async () => {
    isLoading.value = true
    await initializeDatabase()
    const [l, p, s, c] = await Promise.all([
      getLorebooks(),
      getPresets(),
      getSettings(),
      getChats(),
    ])
    lorebooks.value = l
    presets.value = p
    const merged = s
      ? {
          ...DEFAULT_SETTINGS,
          ...s,
          api: {
            ...DEFAULT_SETTINGS.api,
            ...s.api,
            secondary: {
              ...DEFAULT_SETTINGS.api.secondary!,
              ...s.api?.secondary,
            },
            memory: {
              ...DEFAULT_SETTINGS.api.memory!,
              ...s.api?.memory,
            },
          },
        }
      : { ...DEFAULT_SETTINGS }
    settings.value = merged
    activeLorebookIds.value = merged.activeLorebookIds || []
    chats.value = c
    if (c.length > 0 && !activeChatId.value) {
      activeChatId.value = c[0].id
    }
    if (!c.find((x) => x.id === activeChatId.value)) {
      activeChatId.value = c[0]?.id ?? null
    }
    isLoading.value = false
    initialized.value = true
  })()
  try {
    await loadPromise
  } finally {
    if (force) loadPromise = null
  }
  return loadPromise
}

export function useSillytavern() {
  onMounted(() => {
    void loadAll()
  })

  const activeChat = computed(
    () => chats.value.find((c) => c.id === activeChatId.value) || null,
  )
  const activePreset = computed(
    () =>
      presets.value.find((p) => p.id === settings.value?.activePresetId) ||
      presets.value[0] ||
      null,
  )

  const toggleLorebook = async (id: string) => {
    const newIds = activeLorebookIds.value.includes(id)
      ? activeLorebookIds.value.filter((i) => i !== id)
      : [...activeLorebookIds.value, id]
    activeLorebookIds.value = newIds
    if (settings.value) {
      const next = { ...settings.value, activeLorebookIds: newIds }
      await saveSettings(next)
      settings.value = next
    }
  }

  const updateSettings = async (updates: Partial<AppSettings>) => {
    if (!settings.value) return
    const next = { ...settings.value, ...updates }
    if (updates.api) {
      next.api = {
        ...settings.value.api,
        ...updates.api,
        secondary: {
          ...settings.value.api.secondary!,
          ...updates.api.secondary,
        },
        memory: {
          ...settings.value.api.memory!,
          ...updates.api.memory,
        },
      }
    }
    await saveSettings(next)
    settings.value = next
    if (updates.activeLorebookIds) {
      activeLorebookIds.value = updates.activeLorebookIds
    }
  }

  const createChat = async (name?: string) => {
    if (!settings.value) throw new Error('Settings not loaded')
    const chatCount = chats.value.filter(
      (c) => c.characterName === settings.value!.characterName,
    ).length
    const chatName =
      name || `${settings.value.characterName} - 新对话 ${chatCount + 1}`
    const newChat: ChatSession = {
      id: crypto.randomUUID(),
      name: chatName,
      messages: [],
      characterName: settings.value.characterName,
      userName: settings.value.userName,
      presetId: settings.value.activePresetId || presets.value[0]?.id || null,
      lorebookIds: [...activeLorebookIds.value],
      variables: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    await saveChat(newChat)
    chats.value = [...chats.value, newChat]
    activeChatId.value = newChat.id
    return newChat.id
  }

  const loadChat = (id: string) => {
    if (activeChatId.value === id) return
    activeChatId.value = id
  }

  const deleteChat = async (id: string) => {
    await deleteChatById(id)
    chats.value = chats.value.filter((c) => c.id !== id)
    if (activeChatId.value === id) {
      activeChatId.value = chats.value[0]?.id ?? null
    }
  }

  const updateVariables = async (updates: Record<string, string | number>) => {
    if (!activeChat.value) return
    const merged = mergeVariables(activeChat.value.variables as Record<string, string | number>, updates)
    const updatedChat = {
      ...activeChat.value,
      variables: merged,
      updatedAt: Date.now(),
    }
    await saveChat(updatedChat)
    chats.value = chats.value.map((c) =>
      c.id === updatedChat.id ? updatedChat : c,
    )
  }

  const setChatVariables = async (vars: Record<string, unknown>) => {
    if (!activeChat.value) return
    const updatedChat = {
      ...activeChat.value,
      variables: vars,
      updatedAt: Date.now(),
    }
    await saveChat(updatedChat)
    chats.value = chats.value.map((c) =>
      c.id === updatedChat.id ? updatedChat : c,
    )
  }

  /** Classic chat-mode send (non-streaming, variable extraction via <var /> tags). */
  const sendMessage = async (content: string) => {
    if (!settings.value || !activeChat.value) {
      throw new Error('No active chat or settings not loaded')
    }
    isSending.value = true
    try {
      const preset = activePreset.value
      if (!preset) throw new Error('No preset available')

      const activeBooks = lorebooks.value.filter((b) =>
        activeLorebookIds.value.includes(b.id),
      )
      const currentVariables = (activeChat.value.variables || {}) as Record<
        string,
        string | number
      >

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content,
        timestamp: Date.now(),
        variables: { ...currentVariables },
      }

      const updatedMessages = [...activeChat.value.messages, userMessage]
      let updatedChat: ChatSession = {
        ...activeChat.value,
        messages: updatedMessages,
        updatedAt: Date.now(),
      }

      const { messages: promptMessages } = assemblePrompt({
        userInput: content,
        history: updatedMessages,
        preset,
        lorebooks: activeBooks,
        userName: settings.value.userName,
        characterName: settings.value.characterName,
        variables: currentVariables,
        formatPrompt:
          settings.value.uiMode === 'game'
            ? settings.value.formatPromptTemplate
            : undefined,
        historyKeepMessages:
          typeof settings.value.historyKeepMessages === 'number'
            ? settings.value.historyKeepMessages
            : 12,
        historyCompress: settings.value.historyCompress !== false,
        historyMaxTokens:
          typeof settings.value.historyMaxTokens === 'number'
            ? settings.value.historyMaxTokens
            : 12000,
      })

      const requestBody: Record<string, unknown> = {
        model: preset.settings.openai_model || settings.value.api.model,
        messages: promptMessages,
      }
      if (preset.settings.temp_openai !== undefined)
        requestBody.temperature = preset.settings.temp_openai
      if (preset.settings.openai_max_tokens !== undefined)
        requestBody.max_tokens = preset.settings.openai_max_tokens
      if (preset.settings.top_p_openai !== undefined)
        requestBody.top_p = preset.settings.top_p_openai
      if (preset.settings.freq_pen_openai !== undefined)
        requestBody.frequency_penalty = preset.settings.freq_pen_openai
      if (preset.settings.pres_pen_openai !== undefined)
        requestBody.presence_penalty = preset.settings.pres_pen_openai
      if (preset.settings.stream_openai !== undefined)
        requestBody.stream = preset.settings.stream_openai

      const response = await fetch(
        settings.value.api.baseUrl.replace(/\/$/, '') + '/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${settings.value.api.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        },
      )

      if (!response.ok) throw new Error(`API error: ${response.status}`)

      const data = await response.json()
      const rawReply = data.choices?.[0]?.message?.content || ''
      const { cleanedText: reply, updates: extractedVars } =
        extractVariables(rawReply)
      const nextVariables = mergeVariables(currentVariables, extractedVars)

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: reply,
        timestamp: Date.now(),
        variables: { ...nextVariables },
      }

      updatedChat = {
        ...updatedChat,
        messages: [...updatedChat.messages, assistantMessage],
        variables: nextVariables,
      }
      await saveChat(updatedChat)
      chats.value = chats.value.map((c) =>
        c.id === updatedChat.id ? updatedChat : c,
      )
    } finally {
      isSending.value = false
    }
  }

  /** Game-mode send with streaming XML tag parse. */
  const sendGameMessage = async (userText: string) => {
    if (!activeChat.value || !settings.value) return
    const preset = activePreset.value
    if (!preset) throw new Error('No preset available')

    isSending.value = true
    abortController?.abort()
    abortController = new AbortController()

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userText,
      timestamp: Date.now(),
      variables: { ...(activeChat.value.variables as Record<string, string | number>) },
    }
    let updatedChat: ChatSession = {
      ...activeChat.value,
      messages: [...activeChat.value.messages, userMsg],
      updatedAt: Date.now(),
    }
    await saveChat(updatedChat)
    chats.value = chats.value.map((c) =>
      c.id === updatedChat.id ? updatedChat : c,
    )

    const activeBooks = lorebooks.value.filter((b) =>
      activeLorebookIds.value.includes(b.id),
    )
    const { messages } = assemblePrompt({
      userInput: userText,
      history: updatedChat.messages,
      preset,
      lorebooks: activeBooks,
      userName: settings.value.userName,
      characterName: settings.value.characterName,
      variables: updatedChat.variables as Record<string, string | number>,
      extraVariables: updatedChat.variables,
      formatPrompt: settings.value.formatPromptTemplate,
      historyKeepMessages:
        typeof settings.value.historyKeepMessages === 'number'
          ? settings.value.historyKeepMessages
          : 12,
      historyCompress: settings.value.historyCompress !== false,
      historyMaxTokens:
        typeof settings.value.historyMaxTokens === 'number'
          ? settings.value.historyMaxTokens
          : 12000,
    })

    const tags = settings.value.customTags?.length
      ? settings.value.customTags
      : [...DEFAULT_TAGS]
    parser = new StreamTagParser(tags, [...DEFAULT_OPAQUE_TAGS])
    eventBuf = []
    streamState.value = { ...initialStreamState, isStreaming: true }

    try {
      const router = createApiRouter(settings.value.api)
      const { response, targetUsed } = await router.call('story', {
        messages,
        stream: true,
        model: preset.settings.openai_model || settings.value.api.model,
        temperature: preset.settings.temp_openai,
        max_tokens: preset.settings.openai_max_tokens,
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        if (abortController.signal.aborted) {
          await reader.cancel()
          throw new Error('aborted')
        }
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop() ?? ''
        for (const part of parts) {
          const lines = part.split('\n').filter((l) => l.startsWith('data: '))
          for (const line of lines) {
            const data = line.slice(6).trim()
            if (data === '[DONE]') continue
            try {
              const json = JSON.parse(data)
              const delta: string = json?.choices?.[0]?.delta?.content ?? ''
              if (delta && parser) {
                const events = parser.feed(delta)
                eventBuf.push(...events)
                streamState.value = applyStreamEvents(streamState.value, events)
              }
            } catch {
              // ignore malformed SSE lines
            }
          }
        }
      }

      if (parser) {
        const tail = parser.finish()
        eventBuf.push(...tail)
        streamState.value = {
          ...applyStreamEvents(streamState.value, tail),
          isStreaming: false,
        }
      }

      const parsed = aggregateEvents(eventBuf)
      const { nextVariables, snapshot } = applyParsedToChat(
        updatedChat.variables ?? {},
        parsed,
      )

      const rawContent = eventBuf
        .filter((e) => e.type === 'tag-chunk' || e.type === 'raw')
        .map((e) => ('chunk' in e ? e.chunk : ''))
        .join('')

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: rawContent || parsed.maintext || streamState.value.maintext,
        timestamp: Date.now(),
        parsed,
        variablesAfter: snapshot,
        apiUsed: targetUsed,
        variables: nextVariables as Record<string, string | number>,
      }

      updatedChat = {
        ...updatedChat,
        messages: [...updatedChat.messages, assistantMsg],
        variables: nextVariables,
        updatedAt: Date.now(),
      }
      await saveChat(updatedChat)
      chats.value = chats.value.map((c) =>
        c.id === updatedChat.id ? updatedChat : c,
      )
    } catch (e) {
      streamState.value = { ...initialStreamState }
      parser = null
      throw e
    } finally {
      isSending.value = false
      parser = null
    }
  }

  const editMessage = async (messageId: string, newContent: string) => {
    if (!activeChat.value) return
    const idx = activeChat.value.messages.findIndex((m) => m.id === messageId)
    if (idx === -1) return
    if (activeChat.value.messages[idx].role !== USER_ROLE) return

    const updatedChat = truncateChatAt(
      activeChat.value,
      idx,
      activeChat.value.messages[idx].variables,
    )
    await saveChat(updatedChat)
    chats.value = chats.value.map((c) =>
      c.id === updatedChat.id ? updatedChat : c,
    )
    if (settings.value?.uiMode === 'game') {
      await sendGameMessage(newContent)
    } else {
      await sendMessage(newContent)
    }
  }

  const deleteMessagesFrom = async (messageId: string) => {
    if (!activeChat.value) return
    const idx = activeChat.value.messages.findIndex((m) => m.id === messageId)
    if (idx === -1) return
    const updatedChat = truncateChatAt(activeChat.value, idx)
    await saveChat(updatedChat)
    chats.value = chats.value.map((c) =>
      c.id === updatedChat.id ? updatedChat : c,
    )
  }

  const branchFromMessage = async (messageId: string, name?: string) => {
    if (!activeChat.value || !settings.value)
      throw new Error('No active chat')
    const idx = activeChat.value.messages.findIndex((m) => m.id === messageId)
    if (idx === -1) throw new Error('Message not found')

    const branchCount = chats.value.filter(
      (c) => c.characterName === settings.value!.characterName,
    ).length
    const branchName =
      name || `${settings.value.characterName} - 分支 ${branchCount + 1}`
    const newChat = branchChat(activeChat.value, idx, {
      name: branchName,
      presetId: settings.value.activePresetId || presets.value[0]?.id || null,
      lorebookIds: [...activeLorebookIds.value],
      variables: activeChat.value.messages[idx].variables,
    })
    await saveChat(newChat)
    chats.value = [...chats.value, newChat]
    activeChatId.value = newChat.id
    return newChat.id
  }

  const regenerateLast = async () => {
    if (!activeChat.value) return
    const lastUserIdx = [...activeChat.value.messages]
      .reverse()
      .findIndex((m) => m.role === 'user')
    if (lastUserIdx < 0) return
    const targetIdx = activeChat.value.messages.length - 1 - lastUserIdx
    const content = activeChat.value.messages[targetIdx].content
    const truncated = truncateChatAt(activeChat.value, targetIdx)
    await saveChat(truncated)
    chats.value = chats.value.map((c) =>
      c.id === truncated.id ? truncated : c,
    )
    if (settings.value?.uiMode === 'game') {
      await sendGameMessage(content)
    } else {
      await sendMessage(content)
    }
  }

  const jumpToFloor = async (messageId: string) => {
    if (!activeChat.value) return
    const idx = activeChat.value.messages.findIndex((m) => m.id === messageId)
    if (idx < 0) return
    const truncated = activeChat.value.messages.slice(0, idx + 1)
    const target = truncated[truncated.length - 1]
    const restoredVars =
      target?.role === 'assistant' && target.variablesAfter
        ? target.variablesAfter
        : activeChat.value.variables ?? {}
    const next: ChatSession = {
      ...activeChat.value,
      messages: truncated,
      variables: restoredVars,
      updatedAt: Date.now(),
    }
    await saveChat(next)
    chats.value = chats.value.map((c) => (c.id === next.id ? next : c))
  }

  const abortStream = () => {
    abortController?.abort()
  }

  const addLorebookFromDefault = async (name: string) => {
    const book = createDefaultLorebook(name)
    await saveLorebook(book)
    lorebooks.value = [...lorebooks.value, book]
    return book
  }

  const updateLorebook = async (book: Lorebook) => {
    const next = { ...book, updatedAt: Date.now() }
    await saveLorebook(next)
    lorebooks.value = lorebooks.value.map((b) => (b.id === next.id ? next : b))
  }

  const removeLorebook = async (id: string) => {
    await deleteLorebookDb(id)
    lorebooks.value = lorebooks.value.filter((b) => b.id !== id)
    if (activeLorebookIds.value.includes(id)) {
      await toggleLorebook(id)
    }
  }

  const addPresetFromDefault = async (name: string) => {
    const base = createDefaultPreset()
    const preset: ChatPreset = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...base,
      name,
    }
    await savePreset(preset)
    presets.value = [...presets.value, preset]
    return preset
  }

  const updatePreset = async (preset: ChatPreset) => {
    const next = { ...preset, updatedAt: Date.now() }
    await savePreset(next)
    presets.value = presets.value.map((p) => (p.id === next.id ? next : p))
  }

  const removePreset = async (id: string) => {
    await deletePresetDb(id)
    presets.value = presets.value.filter((p) => p.id !== id)
    if (settings.value?.activePresetId === id) {
      await updateSettings({ activePresetId: null })
    }
  }

  return {
    lorebooks: computed(() => lorebooks.value),
    presets: computed(() => presets.value),
    settings: computed(() => settings.value),
    activeLorebookIds: computed(() => activeLorebookIds.value),
    chats: computed(() => chats.value),
    activeChatId: computed(() => activeChatId.value),
    activeChat,
    activePreset,
    isSending: computed(() => isSending.value),
    isLoading: computed(() => isLoading.value),
    initialized: computed(() => initialized.value),
    streamState: computed(() => streamState.value),
    toast: computed(() => toast.value),

    showSettings,
    showLorebooks,
    showPresets,
    showVariables,
    showChatModal,

    loadAll,
    toggleLorebook,
    updateSettings,
    createChat,
    loadChat,
    deleteChat,
    sendMessage,
    sendGameMessage,
    updateVariables,
    setChatVariables,
    editMessage,
    deleteMessagesFrom,
    branchFromMessage,
    regenerateLast,
    jumpToFloor,
    abortStream,
    showToast,

    saveLorebook: updateLorebook,
    deleteLorebook: removeLorebook,
    addLorebookFromDefault,
    updateLorebook,
    savePreset: updatePreset,
    deletePreset: removePreset,
    addPresetFromDefault,
    updatePreset,

    openSettings: () => {
      showSettings.value = true
    },
    openLorebooks: () => {
      showLorebooks.value = true
    },
    openPresets: () => {
      showPresets.value = true
    },
    openVariables: () => {
      showVariables.value = true
    },
    openChatModal: () => {
      showChatModal.value = true
    },
  }
}

// Re-export type helper used by stream state consumers
export type { ParserEvent }
