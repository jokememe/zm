/**
 * SillyTavern Web - Core Types
 */

// ========== World Book (Lorebook) Types ==========

export interface LorebookEntry {
  id: string;
  keys: string[];
  secondaryKeys: string[];
  content: string;
  comment?: string;
  order: number;
  /** SillyTavern position: 0=before_char, 1=after_char, 2=before_example(AN top), 3=after_example(AN bottom), 4=at_depth, 5=example_msg_top, 6=example_msg_bottom, 7=outlet */
  position: 'before_char' | 'after_char' | 'before_example' | 'after_example' | 'at_depth' | 'example_msg_top' | 'example_msg_bottom' | 'outlet';
  depth?: number;
  role?: number;
  selective: boolean;
  /** 0=and_any(not_any?), 1=or(not_all?), actual SillyTavern has 4 logics but we normalize to and/or where possible */
  selectiveLogic: 'and_any' | 'not_all' | 'not_any' | 'and_all';
  constant: boolean;
  probability: number;
  useProbability?: boolean;
  addMemo: boolean;
  sticky?: number;
  cooldown?: number;
  delay?: number;
  weight?: number;
  scanDepth?: number;
  caseSensitive?: boolean;
  matchWholeWords?: boolean;
  excludeRecursion?: boolean;
  preventRecursion?: boolean;
  useGroupScoring?: boolean;
  matchPersonaDescription?: boolean;
  matchCharacterDescription?: boolean;
  matchCharacterPersonality?: boolean;
  matchCharacterDepthPrompt?: boolean;
  matchScenario?: boolean;
  matchCreatorNotes?: boolean;
  group?: string;
  decorators?: string[];
  characterFilter?: {
    isExclude?: boolean;
    names?: string[];
    tags?: number[];
  };
}

export interface Lorebook {
  id: string;
  name: string;
  description?: string;
  entries: LorebookEntry[];
  recursiveScanning: boolean;
  caseSensitive: boolean;
  matchWholeWords: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SillyTavernLorebookExport {
  name: string;
  description?: string;
  entries: Record<string, {
    uid: number;
    key: string[];
    keysecondary: string[];
    comment: string;
    content: string;
    constant: boolean;
    selective: boolean;
    selectiveLogic: 0 | 1 | 2 | 3;
    addMemo: boolean;
    order: number;
    position: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
    role: number;
    disable: boolean;
    probability: number;
    depth: number;
    group: string;
    useProbability: boolean;
    excluded: boolean;
    sticky: number;
    cooldown: number;
    delay: number;
    weight: number;
    scanDepth: number;
    caseSensitive: boolean;
    matchWholeWords: boolean;
    excludeRecursion: boolean;
    preventRecursion: boolean;
    useGroupScoring: boolean;
    matchPersonaDescription: boolean;
    matchCharacterDescription: boolean;
    matchCharacterPersonality: boolean;
    matchCharacterDepthPrompt: boolean;
    matchScenario: boolean;
    matchCreatorNotes: boolean;
    decorators: string[];
    characterFilter: {
      isExclude?: boolean;
      names?: string[];
      tags?: number[];
    };
  }>;
  settings?: {
    recursive_scanning?: boolean;
    case_sensitive?: boolean;
    match_whole_words?: boolean;
  };
}

export interface MatchedEntry {
  entry: LorebookEntry;
  score: number;
  matchedKeywords: string[];
}

// ========== Preset Types ==========

/** SillyTavern-compatible chat completion preset.
 *  `settings` stores the raw SillyTavern preset JSON (temp_openai, prompt_order, prompts, etc.)
 */
export interface ChatPreset {
  id: string;
  name: string;
  description?: string;
  /** Raw SillyTavern preset fields. For OpenAI presets this includes temp_openai, prompt_order, prompts, etc. */
  settings: Record<string, any>;
  createdAt: number;
  updatedAt: number;
}

// ========== Settings Types ==========

/** 次 API / 记忆 API 共用的旁路通道配置 */
export interface SideApiChannel {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ApiSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeout: number;
  /** 启用流式输出（SSE），天机逐字显示 */
  stream?: boolean;
  /** 局面分析 / 变量结算旁路 */
  secondary?: SideApiChannel;
  /**
   * 表格记忆追溯专用通道（yuzuki-Memory 独立 API）。
   * 启用并配齐后，记忆追溯只走此通道，不抢主/次 API。
   */
  memory?: SideApiChannel;
}

export interface AppSettings {
  key?: string;
  api: ApiSettings;
  /** 'single' = primary API handles all tasks. 'dual' = primary handles story, secondary handles variables. */
  apiMode: 'single' | 'dual';
  activePresetId: string | null;
  activeLorebookIds: string[];
  userName: string;
  characterName: string;
  theme: 'dark' | 'light';
  language: 'zh' | 'en';
  autoSave: boolean;
  autoSaveInterval: number;
  uiMode: 'game' | 'chat';
  customTags: string[];
  formatPromptTemplate: string;
  thinkingDisplay: 'fold' | 'hide' | 'inline';
  /** World settle after story: off | secondary API only | secondary then primary fallback */
  settlementMode?: 'off' | 'secondary_only' | 'secondary_then_primary';
  /**
   * 局面结算（次 API / 回退主 API 的 settle 侧路）专用破限。
   * 主推演心法 jailbreak **不会**进 settle；非空时插在结算 system 与 user 之间。
   * 默认空 = 不插。
   */
  settleJailbreakPrompt?: string;
  /**
   * 天机拼装 prompt 时，至少保留最近多少条 user/assistant 消息（可自定义 0～200）。
   * 在 token 预算之外优先保近端上下文；0 = 仅按 token 预算裁剪（旧行为）。
   */
  historyKeepMessages?: number;
  /**
   * 表格记忆总开关（yuzuki 式：追溯填表 + 世界状态注入 + 主文 Memory 契约）。
   * 关闭后旧楼仍可被压缩，但不跑记忆 API / 不注入表格状态。
   * 默认 true。
   */
  tableMemoryEnabled?: boolean;
  /**
   * 拼装时压缩隐藏楼层：助手文只保留 maintext/sum，去掉 thinking / option / Memory 原文。
   * 远端楼进一步只留小结。默认 true（解决整段 raw 撑到数万 token）。
   */
  historyCompress?: boolean;
  /**
   * 历史消息硬预算（粗估 token，可自定义 0～500000）。
   * 超出则丢弃更早楼层，靠世界书/表格召回。
   * 0 = 仅用预设上下文的 75%（旧行为，大上下文时极易到 6～9 万）。
   * 默认 12000。
   */
  historyMaxTokens?: number;
  /**
   * 表格记忆调度 / 合并 / 召回 — 对齐 shujuku AutoCardUpdater。
   * threshold=读深, frequency=每N层, batch, concurrent, skip, retain, merge, Top-K。
   */
  tableMemoryScheduler?: {
    autoUpdateThreshold?: number;
    autoUpdateFrequency?: number;
    updateBatchSize?: number;
    maxConcurrentGroups?: number;
    skipUpdateFloors?: number;
    retainRecentLayers?: number;
    autoMergeEnabled?: boolean;
    autoMergeThreshold?: number;
    autoMergeReserve?: number;
    mergeBatchSize?: number;
    recallEnabled?: boolean;
    recallIndexTop?: number;
    recallTopK?: number;
    entityInjectMaxChars?: number;
    journalInjectMaxChars?: number;
    /** 精确召回 system 提示；空则用内置默认；占位 {{topK}} */
    recallSystemPrompt?: string;
    /** 精确召回 user 模板；空则用内置默认；占位 {{topK}} {{query}} {{previousPlot}} {{indexText}} */
    recallUserTemplate?: string;
    /**
     * 召回支路破限（与主推演心法 jailbreak 分离）。
     * 侧路选码：独立 system；注入主推演：前缀到召回纪要块。空=不插。
     */
    recallJailbreakPrompt?: string;
  };
}

export const DEFAULT_FORMAT_PROMPT = `你必须严格按照以下 XML 标签格式输出回复，不要使用 Markdown 包裹：
<thinking>……</thinking>     ← 可选；内部任何字符都视为思考过程，不被解析
<maintext>……</maintext>     ← 必填；本回合的剧情正文，可多段，保留换行
<option>选项 A
选项 B
选项 C</option>              ← 必填；至少 2 项，每行一个
<sum>……</sum>               ← 必填；本回合一句话总结
【表格记忆 · yuzuki 兼容】人物/物品/设定有变时，在回复末尾追加：
<Memory><!--
#角色档案
[全名]|身份：…|当前位置：…|性格：…
#物品追踪
[稳定名]|持有者：…|状态：完好|物品位置：…
#世界设定
[设定名]|类型：…|详细说明：…
--></Memory>
规则：主键[]合并；只写变更字段；禁止空字段与别名拆条；与 <sum> 并存勿省略。
说明：气数与名册/外交/城池由系统在回合结束后自动分析并改档，不要用 <vars> 改档。正文与 <sum> 中若发生收徒、离宗、交恶、结盟、纳贡、资源增减等，须写出具体人名/势力名与结果，供自动结算抽取。`

export const DEFAULT_TAGS = ['maintext', 'option', 'sum', 'vars', 'thinking', 'think'] as const;
export const DEFAULT_OPAQUE_TAGS = ['thinking', 'think'] as const;

export const DEFAULT_SETTINGS: AppSettings = {
  api: {
    // 默认留空，由用户在密匣填写（兼容 OpenAI / 中转 / 本地）
    baseUrl: '',
    apiKey: '',
    model: '',
    timeout: 60000,
    secondary: {
      enabled: false,
      baseUrl: '',
      apiKey: '',
      model: '',
      temperature: 0.7,
      maxTokens: 8000,
    },
    memory: {
      enabled: false,
      baseUrl: '',
      apiKey: '',
      model: '',
      temperature: 0.2,
      maxTokens: 1200,
    },
  },
  apiMode: 'single',
  activePresetId: null,
  activeLorebookIds: [],
  userName: '用户',
  characterName: 'AI',
  theme: 'dark',
  language: 'zh',
  autoSave: true,
  autoSaveInterval: 30,
  uiMode: 'game',
  customTags: ['maintext', 'option', 'sum', 'vars', 'thinking', 'think'],
  formatPromptTemplate: DEFAULT_FORMAT_PROMPT,
  thinkingDisplay: 'fold',
  settlementMode: 'secondary_then_primary',
  settleJailbreakPrompt: '',
  historyKeepMessages: 12,
  tableMemoryEnabled: true,
  historyCompress: true,
  historyMaxTokens: 12000,
  tableMemoryScheduler: {
    autoUpdateThreshold: 3,
    autoUpdateFrequency: 1,
    updateBatchSize: 3,
    maxConcurrentGroups: 1,
    skipUpdateFloors: 0,
    retainRecentLayers: 100,
    autoMergeEnabled: true,
    autoMergeThreshold: 20,
    autoMergeReserve: 0,
    mergeBatchSize: 5,
    recallEnabled: true,
    recallIndexTop: 50,
    recallTopK: 20,
    entityInjectMaxChars: 2800,
    journalInjectMaxChars: 3200,
    // 默认文案由 table-memory-settings 注入；此处空串表示「跟随内置」
    recallSystemPrompt: '',
    recallUserTemplate: '',
    recallJailbreakPrompt: '',
  },
};

// ========== Chat Types ==========

export interface ChatMessage {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp: number;
  variables?: Record<string, string | number>;
  metadata?: {
    tokenCount?: number;
    lorebookEntries?: string[];
    processingTime?: number;
  };
  parsed?: ParsedTags;
  variablesAfter?: Record<string, any>;
  /** World snapshot after settle pipeline applied (optional; Task settle). */
  stateAfter?: import('@/types/world').WorldSnapshot;
  apiUsed?: ApiTarget;
}

export interface ChatSession {
  id: string;
  name: string;
  messages: ChatMessage[];
  characterName: string;
  userName: string;
  presetId: string | null;
  lorebookIds: string[];
  variables: Record<string, any>;
  createdAt: number;
  updatedAt: number;
}

// ========== Constants ==========

/** Common SillyTavern prompt_order identifiers used in OpenAI presets. */
export const DEFAULT_PROMPT_ORDER = [
  { identifier: 'main', name: 'Main Prompt', role: 'system' as const },
  { identifier: 'worldInfoBefore', name: 'World Info (Before)', role: 'system' as const },
  { identifier: 'charDescription', name: 'Character Description', role: 'system' as const },
  { identifier: 'charPersonality', name: 'Character Personality', role: 'system' as const },
  { identifier: 'scenario', name: 'Scenario', role: 'system' as const },
  { identifier: 'personaDescription', name: 'Persona Description', role: 'system' as const },
  { identifier: 'dialogueExamples', name: 'Dialogue Examples', role: 'system' as const },
  { identifier: 'chatHistory', name: 'Chat History', role: 'system' as const },
  { identifier: 'worldInfoAfter', name: 'World Info (After)', role: 'system' as const },
  { identifier: 'groupNudge', name: 'Group Nudge', role: 'system' as const },
];

export function createDefaultPreset(): Omit<ChatPreset, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: '默认预设',
    description: 'SillyTavern 兼容的默认 OpenAI 预设',
    settings: {
      temp_openai: 0.8,
      freq_pen_openai: 0,
      pres_pen_openai: 0,
      top_p_openai: 0.9,
      top_k_openai: 0,
      top_a_openai: 0,
      min_p_openai: 0,
      repetition_penalty_openai: 1,
      openai_max_context: 4096,
      openai_max_tokens: 2048,
      stream_openai: false,
      max_context_unlocked: false,
      chat_completion_source: 'openai',
      // 空：推演时用密匣 model，避免默认 gpt-3.5-turbo 覆盖用户配置
      openai_model: '',
      main: 'Write {{char}}\'s next reply in a fictional chat between {{char}} and {{user}}.',
      nsfw: '',
      jailbreak: '',
      enhanceDefinitions: '',
      impersonation_prompt: '',
      new_chat_prompt: '',
      new_group_chat_prompt: '',
      new_example_chat_prompt: '',
      continue_nudge_prompt: '',
      wi_format: '',
      group_nudge_prompt: '',
      scenario_format: '',
      personality_format: '',
      prompts: [],
      prompt_order: DEFAULT_PROMPT_ORDER.map((p) => ({ ...p, enabled: true })),
    },
  };
}

// ========== v3 Game Mode Types ==========

export interface ParsedTags {
  thinking: string;
  maintext: string;
  options: string[];
  sum: string;
  varsRaw: string;
  varsCommands: VarsPatch;
  unknown: Record<string, string>;
}

export interface VarsPatch {
  /** Object that will be deep-merged into chat.variables */
  merge: Record<string, any>;
}

export type Task = 'story' | 'summary' | 'vars' | 'settle';
export type ApiTarget = 'primary' | 'secondary' | 'memory';
