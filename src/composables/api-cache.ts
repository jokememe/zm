/**
 * API 配置本地备份（localStorage）
 * IndexedDB 失败或旧默认值时，仍能读写密匣配置。
 */
import type { ApiSettings, AppSettings } from '@/sillytavern/types'
import { normalizeApiBaseUrl } from '@/sillytavern/api-tools'

export const API_CACHE_KEY = 'zongmen-api-cache-v1'

/** 旧版写死的默认地址：无 Key 时视为未配置，便于用户重填 */
const LEGACY_DEFAULT_URLS = [
  'https://api.openai.com/v1',
  'https://api.openai.com/v1/',
]

/** 统一走 api-tools 规范化，避免两处规则不一致 */
export function normalizeBaseUrl(url: string): string {
  return normalizeApiBaseUrl(url)
}

export function isApiConfigured(api?: Partial<ApiSettings> | null): boolean {
  if (!api) return false
  const base = normalizeBaseUrl(String(api.baseUrl || ''))
  const key = String(api.apiKey || '').trim()
  const model = String(api.model || '').trim()
  if (!base || !key || !model) return false
  if (key === 'sk-...' || key === 'sk-') return false
  return true
}

/** 更清晰的缺项提示 */
export function apiConfigMissing(api?: Partial<ApiSettings> | null): string[] {
  const miss: string[] = []
  if (!api) return ['Base URL', 'API Key', '模型']
  if (!normalizeBaseUrl(String(api.baseUrl || ''))) miss.push('Base URL')
  const key = String(api.apiKey || '').trim()
  if (!key || key === 'sk-...') miss.push('API Key')
  if (!String(api.model || '').trim()) miss.push('模型')
  return miss
}

export function loadApiCache(): Partial<ApiSettings> | null {
  try {
    const raw = localStorage.getItem(API_CACHE_KEY)
    if (!raw) return null
    const o = JSON.parse(raw) as Partial<ApiSettings>
    if (!o || typeof o !== 'object') return null
    return {
      baseUrl: typeof o.baseUrl === 'string' ? o.baseUrl : '',
      apiKey: typeof o.apiKey === 'string' ? o.apiKey : '',
      model: typeof o.model === 'string' ? o.model : '',
      timeout: typeof o.timeout === 'number' ? o.timeout : 60000,
      secondary: o.secondary,
      memory: o.memory,
      recall: o.recall,
    }
  } catch {
    return null
  }
}

export function saveApiCache(api: ApiSettings) {
  try {
    localStorage.setItem(
      API_CACHE_KEY,
      JSON.stringify({
        baseUrl: api.baseUrl ?? '',
        apiKey: api.apiKey ?? '',
        model: api.model ?? '',
        timeout: api.timeout ?? 60000,
        secondary: api.secondary,
        memory: api.memory,
        recall: api.recall,
      }),
    )
  } catch {
    /* ignore */
  }
}

/**
 * 合并 DB 设置 + localStorage 备份，并清理「无 Key 的旧默认 openai 地址」。
 */
export function mergeApiSettings(
  fromDb: Partial<ApiSettings> | undefined | null,
  defaults: ApiSettings,
): ApiSettings {
  const cache = loadApiCache()
  const base: ApiSettings = {
    ...defaults,
    ...(fromDb || {}),
    secondary: {
      ...defaults.secondary!,
      ...(fromDb?.secondary || {}),
      ...(cache?.secondary || {}),
    },
    memory: {
      ...defaults.memory!,
      ...(fromDb?.memory || {}),
      ...(cache?.memory || {}),
    },
    recall: {
      ...defaults.recall!,
      ...(fromDb?.recall || {}),
      ...(cache?.recall || {}),
    },
  }

  // cache 覆盖主字段（用户最近保存优先）
  if (cache) {
    if (cache.baseUrl !== undefined) base.baseUrl = cache.baseUrl
    if (cache.apiKey !== undefined) base.apiKey = cache.apiKey
    if (cache.model !== undefined) base.model = cache.model
    if (cache.timeout !== undefined) base.timeout = cache.timeout
  }

  // 旧默认：只有 openai 地址、没有真 Key → 清空，逼用户重填
  const key = (base.apiKey || '').trim()
  const url = (base.baseUrl || '').trim()
  if ((!key || key === 'sk-...') && LEGACY_DEFAULT_URLS.includes(url)) {
    base.baseUrl = ''
    base.model = base.model === 'gpt-3.5-turbo' ? '' : base.model
  }

  base.baseUrl = normalizeBaseUrl(base.baseUrl || '')
  if (base.recall) {
    base.recall = {
      ...base.recall,
      baseUrl: normalizeBaseUrl(base.recall.baseUrl || ''),
    }
  }
  return base
}

/** 旁路通道是否启用且 baseUrl/key/model 齐全 */
export function sideChannelReady(
  ch?: { enabled?: boolean; baseUrl?: string; apiKey?: string; model?: string } | null,
): boolean {
  if (!ch?.enabled) return false
  return !!(
    normalizeBaseUrl(String(ch.baseUrl || '')) &&
    String(ch.apiKey || '').trim() &&
    String(ch.model || '').trim()
  )
}

/**
 * 发话前召回选码端点优先级：
 * 1. 召回 API 启用且配齐 → 只用召回（不抢记忆）
 * 2. 召回启用但未配齐 → null（关键词兜底，不静默偷其它线）
 * 3. 召回未启用 → 记忆 → 次 → 主（兼容旧配置）
 */
export function resolveRecallApiEndpoint(api: ApiSettings): {
  kind: 'recall' | 'memory' | 'secondary' | 'primary' | 'none'
  baseUrl: string
  apiKey: string
  model: string
  temperature?: number
  maxTokens?: number
  reason: string
} {
  const rec = api.recall
  if (rec?.enabled) {
    if (sideChannelReady(rec)) {
      return {
        kind: 'recall',
        baseUrl: normalizeBaseUrl(rec.baseUrl || ''),
        apiKey: String(rec.apiKey || ''),
        model: String(rec.model || '').trim(),
        temperature: rec.temperature,
        maxTokens: rec.maxTokens,
        reason: 'recall_api',
      }
    }
    return {
      kind: 'none',
      baseUrl: '',
      apiKey: '',
      model: '',
      reason: 'recall_enabled_but_incomplete',
    }
  }
  if (sideChannelReady(api.memory)) {
    const m = api.memory!
    return {
      kind: 'memory',
      baseUrl: normalizeBaseUrl(m.baseUrl || ''),
      apiKey: String(m.apiKey || ''),
      model: String(m.model || '').trim(),
      temperature: m.temperature,
      maxTokens: m.maxTokens,
      reason: 'fallback_memory',
    }
  }
  if (sideChannelReady(api.secondary)) {
    const s = api.secondary!
    return {
      kind: 'secondary',
      baseUrl: normalizeBaseUrl(s.baseUrl || ''),
      apiKey: String(s.apiKey || ''),
      model: String(s.model || '').trim(),
      temperature: s.temperature,
      maxTokens: s.maxTokens,
      reason: 'fallback_secondary',
    }
  }
  if (isApiConfigured(api)) {
    return {
      kind: 'primary',
      baseUrl: normalizeBaseUrl(api.baseUrl || ''),
      apiKey: String(api.apiKey || ''),
      model: String(api.model || '').trim(),
      reason: 'fallback_primary',
    }
  }
  return {
    kind: 'none',
    baseUrl: '',
    apiKey: '',
    model: '',
    reason: 'no_endpoint',
  }
}

export function applyApiToSettings(
  settings: AppSettings,
  defaults: ApiSettings,
): AppSettings {
  return {
    ...settings,
    api: mergeApiSettings(settings.api, defaults),
  }
}
