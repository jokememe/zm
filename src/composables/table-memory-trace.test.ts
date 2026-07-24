import { describe, it, expect, beforeEach } from 'vitest'
import {
  buildMemoryTraceMessages,
  buildTableDefinitionsText,
  buildTraceRealtimePrompt,
  buildMainFormatMemoryHint,
} from './table-memory-prompts'
import {
  buildMemoryTraceRequestBody,
  resolveMemoryTraceTarget,
  runMemoryTrace,
} from './table-memory-trace'
import {
  clearTableMemory,
  createDefaultTableMemoryState,
  applyMemoryTextToState,
  loadTableMemory,
} from './table-memory'
import type { AppSettings } from '@/sillytavern/types'
import { DEFAULT_SETTINGS } from '@/sillytavern/types'

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => store.set(k, String(v)),
      removeItem: (k: string) => store.delete(k),
    },
    configurable: true,
  })
  clearTableMemory()
})

describe('yuzuki prompt contracts (shipped)', () => {
  it('buildTableDefinitionsText lists default tables with primary keys', () => {
    const text = buildTableDefinitionsText()
    expect(text).toContain('#角色档案')
    expect(text).toContain('角色名(主键)')
    expect(text).toContain('#物品追踪')
    expect(text).toContain('#世界设定')
  })

  it('buildTraceRealtimePrompt requires Memory wrapper and incremental rules', () => {
    const p = buildTraceRealtimePrompt()
    expect(p).toContain('<Memory>')
    expect(p).toMatch(/主键|\[\]/)
    expect(p).toContain('数据库结构定义')
    expect(p).toContain('#角色档案')
  })

  it('buildMemoryTraceMessages injects world state + trace + turn texts', () => {
    const s = createDefaultTableMemoryState()
    applyMemoryTextToState(
      s,
      `<Memory>#角色档案\n[陆承渊]|身份：内门弟子|当前位置：青石城</Memory>`,
    )
    const msgs = buildMemoryTraceMessages({
      userText: '接见赤焰谷使者',
      maintext: '陆承渊随侍在侧，掌门印仍在宗门。',
      sum: '接见使者',
      state: s,
    })
    expect(msgs.length).toBeGreaterThanOrEqual(3)
    const joined = msgs.map((m) => m.content).join('\n')
    expect(joined).toContain('陆承渊')
    expect(joined).toContain('接见赤焰谷使者')
    expect(joined).toContain('<Memory>')
    expect(joined).toContain('当前世界状态参考')
  })

  it('main format hint contains Memory instructions', () => {
    const h = buildMainFormatMemoryHint()
    expect(h).toContain('<Memory>')
    expect(h).toContain('#角色档案')
  })
})

describe('resolveMemoryTraceTarget (independent memory API)', () => {
  it('prefers memory when enabled and ready', () => {
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      api: {
        ...DEFAULT_SETTINGS.api,
        baseUrl: 'https://primary.test/v1',
        apiKey: 'sk-primary',
        model: 'primary-model',
        secondary: {
          enabled: true,
          baseUrl: 'https://secondary.test/v1',
          apiKey: 'sk-sec',
          model: 'sec-model',
        },
        memory: {
          enabled: true,
          baseUrl: 'https://memory.test/v1',
          apiKey: 'sk-mem',
          model: 'mem-model',
        },
      },
    }
    expect(resolveMemoryTraceTarget(settings)).toBe('memory')
  })

  it('does not silently fall back when memory enabled but incomplete', () => {
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      api: {
        ...DEFAULT_SETTINGS.api,
        baseUrl: 'https://primary.test/v1',
        apiKey: 'sk-primary',
        model: 'primary-model',
        memory: {
          enabled: true,
          baseUrl: '',
          apiKey: '',
          model: '',
        },
      },
    }
    expect(resolveMemoryTraceTarget(settings)).toBeNull()
  })

  it('falls back secondary → primary when memory not enabled', () => {
    const withSec: AppSettings = {
      ...DEFAULT_SETTINGS,
      api: {
        ...DEFAULT_SETTINGS.api,
        baseUrl: 'https://primary.test/v1',
        apiKey: 'sk-primary',
        model: 'primary-model',
        secondary: {
          enabled: true,
          baseUrl: 'https://secondary.test/v1',
          apiKey: 'sk-sec',
          model: 'sec-model',
        },
        memory: { enabled: false, baseUrl: '', apiKey: '', model: '' },
      },
    }
    expect(resolveMemoryTraceTarget(withSec)).toBe('secondary')

    const primaryOnly: AppSettings = {
      ...DEFAULT_SETTINGS,
      api: {
        ...DEFAULT_SETTINGS.api,
        baseUrl: 'https://primary.test/v1',
        apiKey: 'sk-primary',
        model: 'primary-model',
        memory: { enabled: false, baseUrl: '', apiKey: '', model: '' },
      },
    }
    expect(resolveMemoryTraceTarget(primaryOnly)).toBe('primary')
  })
})

describe('runMemoryTrace (shipped entry)', () => {
  it('applies Memory from mocked LLM via real apply path', async () => {
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      api: {
        ...DEFAULT_SETTINGS.api,
        baseUrl: 'https://example.test/v1',
        apiKey: 'sk-test',
        model: 'test-model',
      },
    }
    expect(resolveMemoryTraceTarget(settings)).toBe('primary')

    const fixture = `<Memory><!--
#角色档案
[陆承渊]|身份：内门剑修|当前位置：山门
#物品追踪
[掌门印]|持有者：掌门|状态：完好
--></Memory>`

    const outcome = await runMemoryTrace({
      userText: '问剑',
      maintext: '陆承渊在山门演武，掌门印在掌门腰间。',
      settings,
      postChat: async () => ({ ok: true as const, text: fixture }),
    })
    expect(outcome.status).toBe('applied')
    if (outcome.status === 'applied') {
      expect(outcome.count).toBeGreaterThanOrEqual(1)
    }
    const bank = loadTableMemory()
    const char = bank.records.character_profile?.find(
      (r) => r.values['角色名'] === '陆承渊',
    )
    expect(char?.values['当前位置']).toBe('山门')
  })

  it('routes postChat to memory target and uses memory model', async () => {
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      api: {
        ...DEFAULT_SETTINGS.api,
        baseUrl: 'https://primary.test/v1',
        apiKey: 'sk-primary',
        model: 'primary-model',
        memory: {
          enabled: true,
          baseUrl: 'https://memory.test/v1',
          apiKey: 'sk-mem',
          model: 'mem-model',
          temperature: 0.15,
          maxTokens: 900,
        },
      },
    }
    let seenTarget: string | null = null
    let seenModel: string | null = null
    let seenTemp: number | null = null
    const outcome = await runMemoryTrace({
      userText: 'u',
      maintext: '陆承渊路过',
      settings,
      postChat: async ({ target, body }) => {
        seenTarget = target
        seenModel = String(body.model || '')
        seenTemp = Number(body.temperature)
        return {
          ok: true as const,
          text: `<Memory>#角色档案\n[陆承渊]|身份：客卿</Memory>`,
        }
      },
    })
    expect(seenTarget).toBe('memory')
    expect(seenModel).toBe('mem-model')
    expect(seenTemp).toBeCloseTo(0.15)
    expect(outcome.status).toBe('applied')
  })

  it('buildMemoryTraceRequestBody is non-empty and pure', () => {
    const { messages, body } = buildMemoryTraceRequestBody({
      model: 'm',
      userText: 'u',
      maintext: 'story about 青岚宗',
    })
    expect(messages.length).toBeGreaterThan(2)
    expect(body.model).toBe('m')
    expect(body.stream).toBe(false)
  })

  it('skips when API not configured', async () => {
    const outcome = await runMemoryTrace({
      userText: 'x',
      maintext: 'y',
      settings: { ...DEFAULT_SETTINGS },
      postChat: async () => ({ ok: true as const, text: '' }),
    })
    expect(outcome.status).toBe('skipped')
  })

  it('skips with memory_api_not_ready when memory on but incomplete', async () => {
    const outcome = await runMemoryTrace({
      userText: 'x',
      maintext: 'y',
      settings: {
        ...DEFAULT_SETTINGS,
        api: {
          ...DEFAULT_SETTINGS.api,
          baseUrl: 'https://p.test/v1',
          apiKey: 'sk-p',
          model: 'p',
          memory: { enabled: true, baseUrl: '', apiKey: '', model: '' },
        },
      },
      postChat: async () => ({ ok: true as const, text: '' }),
    })
    expect(outcome.status).toBe('skipped')
    if (outcome.status === 'skipped') {
      expect(outcome.reason).toBe('memory_api_not_ready')
    }
  })
})

describe('tianji wires full table-memory pipeline', () => {
  it('useTianji sources call runTableMemoryPipeline', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const { dirname, join } = await import('node:path')
    const here = dirname(fileURLToPath(import.meta.url))
    const src = readFileSync(join(here, 'useTianji.ts'), 'utf8')
    expect(src).toMatch(/runTableMemoryPipeline/)
    expect(src).toMatch(/buildMainFormatMemoryHint/)
    expect(src).toMatch(/runManualMemoryTrace/)
  })
})
