import { describe, it, expect } from 'vitest'
import {
  resolveNumericValue,
  resolveRelativeResourceValue,
  coerceEditorVarInput,
  RESOURCE_VAR_MAP,
  WRITABLE_VAR_NAMES,
} from './game-bridge'
import { applyWorldDeltaToSnapshot, emptyTestSnapshot } from './world-delta'
import { SETTLE_CONTRACT_HINT } from './settle-runner'
import {
  extractVariables,
  mergeVariables,
  applyParsedToChat,
  aggregateEvents,
} from '@/sillytavern/variables'
import { parseVarsBlock, applyVarsPatch, applyResourceScalar } from '@/sillytavern/vars-merger'
import { StreamTagParser } from '@/sillytavern/stream-parser'
import { DEFAULT_TAGS, DEFAULT_OPAQUE_TAGS } from '@/sillytavern/types'

/**
 * Variable-system numeric semantics (full pipeline).
 *
 * Settle / secondary API → resolveRelativeResourceValue (via applyWorldDeltaToSnapshot)
 * 气数簿手改 / session restore → resolveNumericValue (via applyVariablesToGame)
 * ST &lt;vars&gt; / &lt;var/&gt; → extractVariables + mergeVariables / applyVarsPatch
 */
describe('resolveRelativeResourceValue (settle resources)', () => {
  it('JSON number -10 subtracts from stock (260 → 250), never clamps to 0 as absolute', () => {
    expect(resolveRelativeResourceValue(260, -10)).toBe(250)
  })

  it('string "-10" is relative', () => {
    expect(resolveRelativeResourceValue(260, '-10')).toBe(250)
  })

  it('bare string "10" is relative add (not set-to-10)', () => {
    expect(resolveRelativeResourceValue(260, '10')).toBe(270)
  })

  it('positive JSON number adds relatively', () => {
    expect(resolveRelativeResourceValue(260, 30)).toBe(290)
  })

  it('underflow clamps at 0 after relative apply', () => {
    expect(resolveRelativeResourceValue(5, -10)).toBe(0)
  })
})

describe('resolveNumericValue (气数簿 / session variables)', () => {
  it('non-negative bare number is absolute (editor path)', () => {
    expect(resolveNumericValue(260, 100)).toBe(100)
  })

  it('bare string "100" is absolute', () => {
    expect(resolveNumericValue(260, '100')).toBe(100)
  })

  it('signed string "+10" / "-5" is relative', () => {
    expect(resolveNumericValue(260, '+10')).toBe(270)
    expect(resolveNumericValue(260, '-5')).toBe(255)
  })

  it('negative number is relative subtract (not clamp-to-0 absolute)', () => {
    // Was: Math.max(0, -10) → 0. Now: 260 + (-10) → 250
    expect(resolveNumericValue(260, -10)).toBe(250)
    expect(resolveNumericValue(260, '-10')).toBe(250)
  })

  it('empty string keeps current', () => {
    expect(resolveNumericValue(260, '')).toBe(260)
  })
})

describe('coerceEditorVarInput (气数簿 UI)', () => {
  it('empty / whitespace → undefined (do not write 0)', () => {
    expect(coerceEditorVarInput('')).toBeUndefined()
    expect(coerceEditorVarInput('   ')).toBeUndefined()
  })

  it('keeps +N / -N as relative strings', () => {
    expect(coerceEditorVarInput('-30')).toBe('-30')
    expect(coerceEditorVarInput('+100')).toBe('+100')
  })

  it('bare positive becomes number absolute', () => {
    expect(coerceEditorVarInput('260')).toBe(260)
  })

  it('junk / sci / hex skipped', () => {
    expect(coerceEditorVarInput('xyz')).toBeUndefined()
    expect(coerceEditorVarInput('1e2')).toBeUndefined()
    expect(coerceEditorVarInput('0x10')).toBeUndefined()
  })
})

describe('extractVariables / mergeVariables (ST tags)', () => {
  it('preserves signed value as string so merge can subtract', () => {
    const { updates } = extractVariables('<var name="灵石" value="-10" />')
    expect(updates['灵石']).toBe('-10')
    expect(typeof updates['灵石']).toBe('string')
    const next = mergeVariables({ 灵石: 260 }, updates)
    expect(next['灵石']).toBe(250)
  })

  it('absolute bare value sets stock', () => {
    const { updates } = extractVariables('<var name="灵石" value="100" />')
    expect(updates['灵石']).toBe(100)
    expect(mergeVariables({ 灵石: 260 }, updates)['灵石']).toBe(100)
  })

  it('ignores empty value (no Number("") → 0)', () => {
    const { updates } = extractVariables('<var name="灵石" value="" />')
    expect(updates['灵石']).toBeUndefined()
  })
})

describe('<vars> JSON patch (vars-merger)', () => {
  it('{"灵石":-10} subtracts from session stock', () => {
    expect(applyResourceScalar(260, -10)).toBe(250)
    const next = applyVarsPatch({ 灵石: 260, 声望: 5 }, { merge: { 灵石: -10 } })
    expect(next['灵石']).toBe(250)
    expect(next['声望']).toBe(5)
  })

  it('parseVarsBlock + applyParsedToChat end-to-end (relative like settle)', () => {
    const raw = `<maintext>耗灵石</maintext><vars>{"灵石":-10,"声望":1}</vars><sum>耗</sum>`
    const parser = new StreamTagParser([...DEFAULT_TAGS], [...DEFAULT_OPAQUE_TAGS])
    const events = [...parser.feed(raw), ...parser.finish()]
    const parsed = aggregateEvents(events)
    expect(parsed.varsCommands.merge['灵石']).toBe(-10)
    const { nextVariables } = applyParsedToChat({ 灵石: 260, 声望: 3 }, parsed)
    expect(nextVariables['灵石']).toBe(250)
    expect(nextVariables['声望']).toBe(4) // +1 relative
  })

  it('parseVarsBlock handles single-quoted loose JSON', () => {
    const p = parseVarsBlock("{'灵石':-10}")
    expect(p.merge['灵石']).toBe(-10)
  })
})

describe('shipped settle apply path uses relative resolver', () => {
  it('applyWorldDeltaToSnapshot: 260 + {"灵石":-10} → 250', () => {
    const snap = emptyTestSnapshot({
      resources: {
        spiritStone: 260,
        spiritGrain: 0,
        herb: 0,
        ore: 0,
        prestige: 0,
        destiny: 0,
      },
    })
    const { snap: next } = applyWorldDeltaToSnapshot({ resources: { 灵石: -10 } }, snap)
    expect(next.resources.spiritStone).toBe(250)
  })

  it('whitelist keys match RESOURCE_VAR_MAP', () => {
    expect(WRITABLE_VAR_NAMES).toEqual(
      expect.arrayContaining(['灵石', '灵谷', '丹材', '矿铁', '声望', '气运']),
    )
    expect(RESOURCE_VAR_MAP['灵石']).toBe('spiritStone')
  })

  it('SETTLE_CONTRACT_HINT documents relative-only resources', () => {
    expect(SETTLE_CONTRACT_HINT).toMatch(/相对变化/)
    expect(SETTLE_CONTRACT_HINT).toMatch(/\{"灵石":-30/)
  })
})
