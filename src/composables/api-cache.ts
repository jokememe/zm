/**
 * API 配置本地备份（localStorage）
 * IndexedDB 失败或旧默认值时，仍能读写密匣配置。
 */
import type { ApiSettings, AppSettings } from '@/sillytavern/types'

export const API_CACHE_KEY = 'zongmen-api-cache-v1'

/** 旧版写死的默认地址：无 Key 时视为未配置，便于用户重填 */
const LEGACY_DEFAULT_URLS = [
  'https://api.openai.com/v1',
  'https://api.openai.com/v1/',
]

export function normalizeBaseUrl(url: string): string {
  let u = (url || '').trim()
  // 用户若误贴完整 chat 路径，自动剥掉
  u = u.replace(/\/chat\/completions\/?$/i, '')
  u = u.replace(/\/+$/, '')
  return u
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
  return base
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
