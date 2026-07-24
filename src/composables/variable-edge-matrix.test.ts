/**
 * Edge-matrix stress tests for the variable / resource pipeline.
 * Imports ONLY shipped entry points — no reimplemented math.
 */
import { describe, it, expect } from 'vitest'
import {
  resolveNumericValue,
  resolveRelativeResourceValue,
  coerceEditorVarInput,
  RESOURCE_VAR_MAP,
  WRITABLE_VAR_NAMES,
} from './game-bridge'
import { applyWorldDeltaToSnapshot, emptyTestSnapshot, sanitizeWorldDelta } from './world-delta'
import {
  extractVariables,
  mergeVariables,
  applyParsedToChat,
  aggregateEvents,
} from '@/sillytavern/variables'
import { parseVarsBlock, applyVarsPatch, applyResourceScalar } from '@/sillytavern/vars-merger'
import { StreamTagParser } from '@/sillytavern/stream-parser'
import { DEFAULT_TAGS, DEFAULT_OPAQUE_TAGS } from '@/sillytavern/types'
import type { Resources } from '@/types/game'

const FULLWIDTH_MINUS = '\u2212' // −
const EN_DASH = '\u2013' // –
const EM_DASH = '\u2014' // —

function stock(over: Partial<Resources> = {}): Resources {
  return {
    spiritStone: 260,
    spiritGrain: 100,
    herb: 40,
    ore: 30,
    prestige: 20,
    destiny: 10,
    ...over,
  }
}

function snap(over: Partial<Resources> = {}) {
  return emptyTestSnapshot({ resources: stock(over) })
}

// ─── 1. Settle relative resolver matrix ───────────────────────────────────────

describe('edge matrix: resolveRelativeResourceValue', () => {
  const cases: Array<{
    name: string
    current: number
    incoming: string | number
    expected: number
  }> = [
    { name: 'neg number', current: 260, incoming: -10, expected: 250 },
    { name: 'pos number', current: 260, incoming: 15, expected: 275 },
    { name: 'zero delta', current: 260, incoming: 0, expected: 260 },
    { name: 'underflow', current: 5, incoming: -20, expected: 0 },
    { name: 'from zero add', current: 0, incoming: 12, expected: 12 },
    { name: 'from zero sub stays 0', current: 0, incoming: -5, expected: 0 },
    { name: 'string -10', current: 100, incoming: '-10', expected: 90 },
    { name: 'string +10', current: 100, incoming: '+10', expected: 110 },
    { name: 'bare string 10 relative', current: 100, incoming: '10', expected: 110 },
    { name: 'whitespace padded', current: 50, incoming: '  -5  ', expected: 45 },
    { name: 'fullwidth minus', current: 50, incoming: `${FULLWIDTH_MINUS}8`, expected: 42 },
    { name: 'en-dash minus', current: 50, incoming: `${EN_DASH}8`, expected: 42 },
    { name: 'em-dash minus', current: 50, incoming: `${EM_DASH}8`, expected: 42 },
    { name: 'float rounds', current: 10, incoming: 2.6, expected: 13 },
    { name: 'empty string keep', current: 77, incoming: '', expected: 77 },
    { name: 'whitespace keep', current: 77, incoming: '   ', expected: 77 },
    { name: 'junk keep', current: 77, incoming: 'abc', expected: 77 },
    { name: 'NaN-like keep', current: 77, incoming: 'NaN', expected: 77 },
    { name: 'Infinity keep', current: 77, incoming: 'Infinity', expected: 77 },
    { name: 'double minus junk keep', current: 77, incoming: '--10', expected: 77 },
    { name: 'plus only junk keep', current: 77, incoming: '+', expected: 77 },
  ]

  it.each(cases)('$name: $current + $incoming → $expected', ({ current, incoming, expected }) => {
    expect(resolveRelativeResourceValue(current, incoming)).toBe(expected)
  })

  it('NaN number keeps current', () => {
    expect(resolveRelativeResourceValue(77, Number.NaN)).toBe(77)
  })

  it('Infinity number is finite-check rejected → keep (or overflow clamp path)', () => {
    // Number.isFinite(Infinity) is false → should keep current
    expect(resolveRelativeResourceValue(77, Number.POSITIVE_INFINITY)).toBe(77)
  })
})

// ─── 2. Editor resolveNumericValue matrix ─────────────────────────────────────

describe('edge matrix: resolveNumericValue (气数簿)', () => {
  const cases: Array<{
    name: string
    current: number
    incoming: string | number
    expected: number
  }> = [
    { name: 'absolute positive number', current: 260, incoming: 100, expected: 100 },
    { name: 'absolute zero', current: 260, incoming: 0, expected: 0 },
    { name: 'relative neg number', current: 260, incoming: -10, expected: 250 },
    { name: 'relative string -10', current: 260, incoming: '-10', expected: 250 },
    { name: 'relative string +10', current: 260, incoming: '+10', expected: 270 },
    { name: 'absolute bare string', current: 260, incoming: '100', expected: 100 },
    { name: 'underflow relative', current: 3, incoming: -10, expected: 0 },
    { name: 'empty keep', current: 260, incoming: '', expected: 260 },
    { name: 'junk keep', current: 260, incoming: 'nope', expected: 260 },
    { name: 'fullwidth minus relative', current: 50, incoming: `${FULLWIDTH_MINUS}5`, expected: 45 },
    { name: 'whitespace absolute', current: 50, incoming: '  12  ', expected: 12 },
    { name: 'float absolute rounds', current: 50, incoming: 9.4, expected: 9 },
  ]

  it.each(cases)('$name', ({ current, incoming, expected }) => {
    expect(resolveNumericValue(current, incoming)).toBe(expected)
  })
})

// ─── 3. coerceEditorVarInput matrix ───────────────────────────────────────────

describe('edge matrix: coerceEditorVarInput', () => {
  it.each([
    { raw: '', expected: undefined },
    { raw: '   ', expected: undefined },
    { raw: null, expected: undefined },
    { raw: undefined, expected: undefined },
    { raw: '-30', expected: '-30' },
    { raw: '+100', expected: '+100' },
    { raw: '260', expected: 260 },
    { raw: 42, expected: 42 },
    { raw: `${FULLWIDTH_MINUS}7`, expected: '-7' },
    { raw: '  +3  ', expected: '+3' },
  ] as const)('coerce $raw → $expected', ({ raw, expected }) => {
    expect(coerceEditorVarInput(raw as never)).toBe(expected)
  })

  it('junk / sci / hex → undefined (do not write)', () => {
    expect(coerceEditorVarInput('xyz')).toBeUndefined()
    expect(coerceEditorVarInput('1e2')).toBeUndefined()
    expect(coerceEditorVarInput('0x10')).toBeUndefined()
  })

  it('negative bare without plus sign becomes relative string after fullwidth normalize', () => {
    // ASCII "-10" is relative string
    expect(coerceEditorVarInput('-10')).toBe('-10')
  })
})

// ─── 4. Settle applyWorldDelta — multi key + non-灵石 + junk ───────────────────

describe('edge matrix: applyWorldDeltaToSnapshot resources', () => {
  it('applies relative deltas on all whitelist keys at once', () => {
    const { snap: next } = applyWorldDeltaToSnapshot(
      {
        resources: {
          灵石: -10,
          灵谷: 5,
          丹材: -3,
          矿铁: 2,
          声望: -1,
          气运: 1,
        },
      },
      snap(),
    )
    expect(next.resources.spiritStone).toBe(250)
    expect(next.resources.spiritGrain).toBe(105)
    expect(next.resources.herb).toBe(37)
    expect(next.resources.ore).toBe(32)
    expect(next.resources.prestige).toBe(19)
    expect(next.resources.destiny).toBe(11)
  })

  it('underflow on 灵谷 and 气运 clamps independently', () => {
    const { snap: next } = applyWorldDeltaToSnapshot(
      { resources: { 灵谷: -999, 气运: -999 } },
      snap({ spiritGrain: 8, destiny: 2 }),
    )
    expect(next.resources.spiritGrain).toBe(0)
    expect(next.resources.destiny).toBe(0)
    // untouched
    expect(next.resources.spiritStone).toBe(260)
  })

  it('string deltas and fullwidth minus work on 丹材', () => {
    const { snap: next } = applyWorldDeltaToSnapshot(
      { resources: { 丹材: `${FULLWIDTH_MINUS}4` as unknown as number } },
      snap({ herb: 20 }),
    )
    expect(next.resources.herb).toBe(16)
  })

  it('illegal English key spiritStone is ignored (no corrupt)', () => {
    const { snap: next, result } = applyWorldDeltaToSnapshot(
      { resources: { spiritStone: -10 } as never },
      snap(),
    )
    expect(next.resources.spiritStone).toBe(260)
    expect(result.changed).toBe(false)
  })

  it('illegal 金币 key dropped by sanitize; legal 声望 kept', () => {
    const cleaned = sanitizeWorldDelta({
      resources: { 金币: 999, 声望: -2 } as never,
    })
    expect((cleaned.resources as Record<string, unknown>)['金币']).toBeUndefined()
    expect(cleaned.resources?.['声望']).toBe(-2)
    const { snap: next } = applyWorldDeltaToSnapshot(cleaned, snap())
    expect(next.resources.prestige).toBe(18)
  })

  it('junk resource value does not change stock', () => {
    const { snap: next } = applyWorldDeltaToSnapshot(
      { resources: { 灵石: 'not-a-number' as unknown as number } },
      snap(),
    )
    expect(next.resources.spiritStone).toBe(260)
  })

  it('empty resources object is no-op', () => {
    const { snap: next, result } = applyWorldDeltaToSnapshot({ resources: {} }, snap())
    expect(next.resources.spiritStone).toBe(260)
    expect(result.changed).toBe(false)
  })
})

// ─── 5. extractVariables + mergeVariables matrix ──────────────────────────────

describe('edge matrix: extractVariables / mergeVariables', () => {
  it('multi <var/> on 灵谷 and 声望', () => {
    const text = '<var name="灵谷" value="-20" /><var name="声望" value="+2" />正文'
    const { updates, cleanedText } = extractVariables(text)
    expect(updates['灵谷']).toBe('-20')
    expect(updates['声望']).toBe('+2')
    expect(cleanedText).toContain('正文')
    const next = mergeVariables({ 灵谷: 100, 声望: 10, 灵石: 260 }, updates)
    expect(next['灵谷']).toBe(80)
    expect(next['声望']).toBe(12)
    expect(next['灵石']).toBe(260)
  })

  it('absolute bare on 矿铁 sets stock', () => {
    const { updates } = extractVariables('<var name="矿铁" value="9" />')
    expect(mergeVariables({ 矿铁: 30 }, updates)['矿铁']).toBe(9)
  })

  it('empty and whitespace values do not zero stock', () => {
    const { updates } = extractVariables(
      '<var name="灵石" value="" /><var name="灵谷" value="   " />',
    )
    expect(Object.keys(updates)).toHaveLength(0)
    const next = mergeVariables({ 灵石: 260, 灵谷: 100 }, updates)
    expect(next['灵石']).toBe(260)
    expect(next['灵谷']).toBe(100)
  })

  it('fullwidth minus in value is relative', () => {
    const { updates } = extractVariables(`<var name="丹材" value="${FULLWIDTH_MINUS}6" />`)
    expect(updates['丹材']).toBe('-6')
    expect(mergeVariables({ 丹材: 40 }, updates)['丹材']).toBe(34)
  })

  it('junk value on whitelist key keeps numeric stock (not string overwrite, not 0)', () => {
    const { updates } = extractVariables('<var name="灵石" value="???" />')
    // extract may keep raw for non-numeric; merge must not corrupt stock
    const next = mergeVariables({ 灵石: 260 }, updates)
    expect(next['灵石']).toBe(260)
    expect(typeof next['灵石']).toBe('number')
  })

  it('percent / chinese / double-sign junk keep stock', () => {
    expect(mergeVariables({ 灵石: 100 }, { 灵石: '10%' })['灵石']).toBe(100)
    expect(mergeVariables({ 灵石: 100 }, { 灵石: '十' })['灵石']).toBe(100)
    expect(mergeVariables({ 灵石: 100 }, { 灵石: '--5' })['灵石']).toBe(100)
  })

  it('last of multi same-key <var/> wins', () => {
    const { updates } = extractVariables(
      '<var name="灵石" value="-5" /><var name="灵石" value="-3" />',
    )
    expect(updates['灵石']).toBe('-3')
    expect(mergeVariables({ 灵石: 20 }, updates)['灵石']).toBe(17)
  })

  it('scientific / hex strings are rejected (keep stock)', () => {
    // 不再把 Number("1e2") 当 100 写入
    const { updates } = extractVariables('<var name="灵石" value="1e2" />')
    expect(mergeVariables({ 灵石: 260 }, updates)['灵石']).toBe(260)
    expect(mergeVariables({ 灵石: 260 }, { 灵石: '0x10' })['灵石']).toBe(260)
    expect(resolveRelativeResourceValue(0, '1e2')).toBe(0)
    expect(resolveRelativeResourceValue(0, '0x10')).toBe(0)
    expect(resolveNumericValue(260, '1e2')).toBe(260)
  })

  it('non-whitelist key is shallow overwrite', () => {
    const next = mergeVariables({ 自定义: 'a', 灵石: 1 }, { 自定义: 'b' })
    expect(next['自定义']).toBe('b')
    expect(next['灵石']).toBe(1)
  })

  it('missing base key treats current as 0 for relative', () => {
    const next = mergeVariables({}, { 灵石: '-5' as string })
    // -5 relative from 0 → 0
    expect(next['灵石']).toBe(0)
  })

  it('missing base + positive absolute sets', () => {
    expect(mergeVariables({}, { 灵石: 50 })['灵石']).toBe(50)
  })
})

// ─── 6. applyVarsPatch multi-key + junk ───────────────────────────────────────

describe('edge matrix: applyVarsPatch / applyResourceScalar', () => {
  it('multi-key relative patch', () => {
    const next = applyVarsPatch(
      { 灵石: 260, 灵谷: 100, 声望: 20, 其他: 'x' },
      { merge: { 灵石: -10, 灵谷: 5, 声望: -3 } },
    )
    expect(next['灵石']).toBe(250)
    expect(next['灵谷']).toBe(105)
    expect(next['声望']).toBe(17)
    expect(next['其他']).toBe('x')
  })

  it('bare positive string is relative add (vars path), not set', () => {
    // settle-like: "10" means +10
    expect(applyResourceScalar(100, '10')).toBe(110)
    const next = applyVarsPatch({ 矿铁: 30 }, { merge: { 矿铁: '10' } })
    expect(next['矿铁']).toBe(40)
  })

  it('junk keeps base stock', () => {
    expect(applyResourceScalar(77, 'nope')).toBe(77)
    const next = applyVarsPatch({ 气运: 10 }, { merge: { 气运: '??' } })
    expect(next['气运']).toBe(10)
  })

  it('null/undefined current treated as 0', () => {
    expect(applyResourceScalar(undefined, 5)).toBe(5)
    expect(applyResourceScalar(null, -3)).toBe(0)
  })

  it('fullwidth minus', () => {
    expect(applyResourceScalar(20, `${FULLWIDTH_MINUS}4`)).toBe(16)
  })

  it('empty patch merge is identity', () => {
    const base = { 灵石: 1 }
    expect(applyVarsPatch(base, { merge: {} })).toEqual(base)
  })

  it('parseVarsBlock multi + applyParsedToChat', () => {
    const raw =
      '<maintext>x</maintext><vars>{"灵谷":-15,"丹材":3,"声望":-1}</vars><sum>s</sum>'
    const parser = new StreamTagParser([...DEFAULT_TAGS], [...DEFAULT_OPAQUE_TAGS])
    const events = [...parser.feed(raw), ...parser.finish()]
    const parsed = aggregateEvents(events)
    const { nextVariables } = applyParsedToChat(
      { 灵谷: 100, 丹材: 40, 声望: 20 },
      parsed,
    )
    expect(nextVariables['灵谷']).toBe(85)
    expect(nextVariables['丹材']).toBe(43)
    expect(nextVariables['声望']).toBe(19)
  })

  it('broken JSON vars yields empty merge (no throw, no wipe)', () => {
    const p = parseVarsBlock('{not json')
    expect(p.merge).toEqual({})
    const next = applyVarsPatch({ 灵石: 260 }, p)
    expect(next['灵石']).toBe(260)
  })

  it('object/array resource values do not wipe stock', () => {
    expect(applyResourceScalar(260, { x: 1 } as never)).toBe(260)
    expect(applyResourceScalar(260, [1, 2] as never)).toBe(260)
    const next = applyVarsPatch({ 灵石: 260 }, { merge: { 灵石: { delta: -10 } as never } })
    expect(next['灵石']).toBe(260)
  })

  it('boolean coerced via String then Number is junk-safe', () => {
    // String(true)="true" → not finite → keep
    expect(applyResourceScalar(10, true as never)).toBe(10)
    expect(applyResourceScalar(10, false as never)).toBe(10)
  })

  it('null patch.merge treated as empty', () => {
    const next = applyVarsPatch({ 灵石: 1 }, { merge: null as never })
    expect(next['灵石']).toBe(1)
  })
})

// ─── 8. Cross-path consistency probes ─────────────────────────────────────────

describe('edge matrix: cross-path consistency', () => {
  it('settle relative +10 on 声望 matches applyResourceScalar', () => {
    const a = resolveRelativeResourceValue(20, 10)
    const b = applyResourceScalar(20, 10)
    expect(a).toBe(b)
    expect(a).toBe(30)
  })

  it('editor absolute 10 differs from settle relative 10', () => {
    expect(resolveNumericValue(20, 10)).toBe(10) // set
    expect(resolveRelativeResourceValue(20, 10)).toBe(30) // add
  })

  it('editor relative string -10 matches settle number -10', () => {
    expect(resolveNumericValue(50, '-10')).toBe(40)
    expect(resolveRelativeResourceValue(50, -10)).toBe(40)
  })

  it('leading zeros: editor bare "010" is absolute 10', () => {
    expect(resolveNumericValue(100, '010')).toBe(10)
  })

  it('hex / sci rejected on relative path (keep stock)', () => {
    expect(resolveRelativeResourceValue(0, '0x10')).toBe(0)
    expect(resolveRelativeResourceValue(50, '1e2')).toBe(50)
  })
})

// ─── 7. Whitelist completeness ────────────────────────────────────────────────

describe('edge matrix: whitelist coverage', () => {
  it('all WRITABLE_VAR_NAMES map to Resources keys', () => {
    const eng = Object.values(RESOURCE_VAR_MAP)
    expect(WRITABLE_VAR_NAMES).toHaveLength(6)
    for (const cn of WRITABLE_VAR_NAMES) {
      expect(RESOURCE_VAR_MAP[cn]).toBeTruthy()
      expect(eng).toContain(RESOURCE_VAR_MAP[cn])
    }
  })

  it.each(WRITABLE_VAR_NAMES)('settle apply works for key %s', (cn) => {
    const eng = RESOURCE_VAR_MAP[cn]
    const base = stock()
    const before = base[eng]
    const { snap: next } = applyWorldDeltaToSnapshot(
      { resources: { [cn]: -1 } as never },
      emptyTestSnapshot({ resources: base }),
    )
    expect(next.resources[eng]).toBe(Math.max(0, before - 1))
  })
})
