import { describe, it, expect } from 'vitest'
import { resolveRecallApiEndpoint } from './api-cache'
import type { ApiSettings } from '@/sillytavern/types'
import { DEFAULT_SETTINGS } from '@/sillytavern/types'

function baseApi(over: Partial<ApiSettings> = {}): ApiSettings {
  return {
    ...DEFAULT_SETTINGS.api,
    baseUrl: 'https://primary.test/v1',
    apiKey: 'sk-primary',
    model: 'primary-model',
    secondary: {
      enabled: false,
      baseUrl: '',
      apiKey: '',
      model: '',
    },
    memory: {
      enabled: false,
      baseUrl: '',
      apiKey: '',
      model: '',
    },
    recall: {
      enabled: false,
      baseUrl: '',
      apiKey: '',
      model: '',
    },
    ...over,
  }
}

describe('resolveRecallApiEndpoint', () => {
  it('prefers dedicated recall when enabled and ready', () => {
    const r = resolveRecallApiEndpoint(
      baseApi({
        recall: {
          enabled: true,
          baseUrl: 'https://recall.test/v1',
          apiKey: 'sk-rec',
          model: 'rec-mini',
          temperature: 0.1,
          maxTokens: 512,
        },
        memory: {
          enabled: true,
          baseUrl: 'https://mem.test/v1',
          apiKey: 'sk-mem',
          model: 'mem-model',
        },
      }),
    )
    expect(r.kind).toBe('recall')
    expect(r.model).toBe('rec-mini')
    expect(r.reason).toBe('recall_api')
  })

  it('does not steal other lines when recall enabled but incomplete', () => {
    const r = resolveRecallApiEndpoint(
      baseApi({
        recall: {
          enabled: true,
          baseUrl: '',
          apiKey: '',
          model: '',
        },
        memory: {
          enabled: true,
          baseUrl: 'https://mem.test/v1',
          apiKey: 'sk-mem',
          model: 'mem-model',
        },
      }),
    )
    expect(r.kind).toBe('none')
    expect(r.reason).toBe('recall_enabled_but_incomplete')
  })

  it('falls back memory → secondary → primary when recall off', () => {
    expect(
      resolveRecallApiEndpoint(
        baseApi({
          memory: {
            enabled: true,
            baseUrl: 'https://mem.test/v1',
            apiKey: 'sk-mem',
            model: 'mem',
          },
        }),
      ).kind,
    ).toBe('memory')

    expect(
      resolveRecallApiEndpoint(
        baseApi({
          secondary: {
            enabled: true,
            baseUrl: 'https://sec.test/v1',
            apiKey: 'sk-sec',
            model: 'sec',
          },
        }),
      ).kind,
    ).toBe('secondary')

    expect(resolveRecallApiEndpoint(baseApi()).kind).toBe('primary')
  })
})
