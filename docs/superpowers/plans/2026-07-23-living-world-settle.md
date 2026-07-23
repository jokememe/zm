# Living World Settle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the game world “alive”: after each Tianji story turn, a dedicated settle call produces a validated `WorldDelta` that updates disciples/factions/cities/resources, with user-controlled modes so secondary API is preferred and primary-API settle is optional (token-saving).

**Architecture:** Story (primary) never mutates world state. After story tags are shown, `runSettle` builds a compact snapshot + turn text, calls secondary (or primary fallback per `settlementMode`), parses strict JSON ops, validates against current state, applies only on full success, stores `stateAfter` on the assistant message for rollback, refreshes system lorebook. Local pure modules own parse/validate/apply; Vue state lives in `useGameState`.

**Tech Stack:** Vue 3 + TypeScript + Vite, Dexie (settings/chats), existing SillyTavern prompt/API helpers. Unit tests via Vitest for pure delta engine only.

**Spec:** `docs/superpowers/specs/2026-07-23-living-world-settle-design.md`

## Global Constraints

- Settlement authority: **settle + local validate only**; story `<vars>` must **not** write game state by default.
- `settlementMode`: `off` | `secondary_only` | `secondary_then_primary` (default `secondary_then_primary`).
- Invalid any op → **reject entire delta** (strict); retry settle once with error list; still fail → no apply + system message.
- Phase-1 writable: resources (6), disciple add/update/remove(soft), faction.update, city.update, notify.push.
- Do not migrate fields/alchemy/relations edges in this plan.
- Prefer small pure modules; do not bloat `useTianji.ts` beyond a thin `runSettle` call.
- After each task: `npm run build` must pass (or at least `vue-tsc` for the touched types).

## File map

| File | Responsibility |
|------|----------------|
| `src/types/world.ts` | WorldSnapshot, WorldDelta, ops, SettlementMode |
| `src/composables/world-delta.ts` | parse / validate / apply pure functions |
| `src/composables/world-state.ts` | snapshotWorldState, restoreWorldState, seed helpers wired to useGameState |
| `src/composables/useGameState.ts` | live `factions`, `cities`; reset/open seed; export mutators used by apply |
| `src/composables/game-bridge.ts` | live lore includes factions/cities; no story vars instruction for write |
| `src/composables/settle-runner.ts` | prompt build, call API, retry, return validated delta |
| `src/composables/useTianji.ts` | after story: runSettle; ignore story vars apply; persist stateAfter; rollback |
| `src/sillytavern/types.ts` | Task `settle`; AppSettings.settlementMode; ChatMessage.stateAfter |
| `src/sillytavern/api-router.ts` | already maps non-story → secondary; ensure settle works |
| `src/sillytavern/database.ts` | migrate default settlementMode if missing |
| `src/components/SillyTavern/SettingsModal.vue` | UI for settlement mode (次 API tab) |
| `src/views/DiplomacyView.vue` | read useGameState.factions |
| `src/views/CitiesView.vue` | read useGameState.cities |
| `src/components/modals/ModalHost.vue` | factions/cities from game state |
| `src/sillytavern/types.ts` DEFAULT_FORMAT_PROMPT | story: no vars write requirement |
| `vitest.config.ts` + `package.json` | unit tests for world-delta |
| `src/composables/world-delta.test.ts` | tests |

---

### Task 1: Types + Vitest scaffold

**Files:**
- Create: `src/types/world.ts`
- Create: `vitest.config.ts`
- Create: `src/composables/world-delta.test.ts` (stub first test)
- Modify: `package.json` (scripts + vitest devDependency)
- Modify: `src/sillytavern/types.ts` (`Task`, `AppSettings.settlementMode`, `ChatMessage.stateAfter`, `DEFAULT_SETTINGS`)

**Interfaces:**
- Produces:
  - `SettlementMode = 'off' | 'secondary_only' | 'secondary_then_primary'`
  - `WorldSnapshot`, `WorldDelta`, `WorldOp` union
  - `AppSettings.settlementMode: SettlementMode`
  - `ChatMessage.stateAfter?: WorldSnapshot`
  - `Task = 'story' | 'summary' | 'vars' | 'settle'`

- [ ] **Step 1: Add `src/types/world.ts`**

```ts
import type { CityState, Disciple, Faction, NotificationItem, Resources } from '@/types/game'

export type SettlementMode = 'off' | 'secondary_only' | 'secondary_then_primary'

export interface WorldSnapshot {
  resources: Resources
  calendar: { year: number; season: string; day: number }
  sectName: string
  masterName: string
  disciples: Disciple[]
  factions: Faction[]
  cities: CityState[]
  notifications: NotificationItem[]
}

export type ResourceCnName = '灵石' | '灵谷' | '丹材' | '矿铁' | '声望' | '气运'

export type WorldOp =
  | {
      op: 'disciple.add'
      name: string
      gender?: '男' | '女'
      age?: number
      realm?: string
      aptitude?: string
      role?: string
      loyalty?: number
      mood?: string
      talent?: string[]
      status?: Disciple['status']
      master?: string
    }
  | {
      op: 'disciple.update'
      id?: string
      name?: string
      patch: Partial<
        Pick<
          Disciple,
          | 'name'
          | 'gender'
          | 'age'
          | 'realm'
          | 'aptitude'
          | 'role'
          | 'loyalty'
          | 'mood'
          | 'talent'
          | 'status'
          | 'master'
          | 'spouse'
        >
      >
    }
  | {
      op: 'disciple.remove'
      id?: string
      name?: string
    }
  | {
      op: 'faction.update'
      id?: string
      name?: string
      patch: Partial<Pick<Faction, 'relation' | 'stance' | 'recent' | 'demand' | 'power'>>
    }
  | {
      op: 'city.update'
      id?: string
      name?: string
      patch: Partial<Pick<CityState, 'attitude' | 'influence' | 'notes' | 'governor'>>
    }
  | {
      op: 'notify.push'
      title: string
      body?: string
      category?: string
    }

export interface WorldDelta {
  resources?: Partial<Record<ResourceCnName, string | number>>
  ops?: WorldOp[]
  summary?: string
}

export interface ValidateResult {
  ok: boolean
  errors: string[]
  warnings: string[]
  delta?: WorldDelta
}

export interface ApplyResult {
  lines: string[]
  changed: boolean
}
```

- [ ] **Step 2: Extend sillytavern types**

In `src/sillytavern/types.ts`:

1. Change `export type Task = 'story' | 'summary' | 'vars' | 'settle'`
2. On `AppSettings` add: `settlementMode: import type { SettlementMode } from '@/types/world'` — or inline the union to avoid circular deps:  
   `settlementMode?: 'off' | 'secondary_only' | 'secondary_then_primary'`
3. On `ChatMessage` add: `stateAfter?: import('@/types/world').WorldSnapshot` (or loose `Record` if circular; prefer proper type)
4. In `DEFAULT_SETTINGS` add: `settlementMode: 'secondary_then_primary'`
5. Update `DEFAULT_FORMAT_PROMPT` so `<vars>` is no longer required for game write — e.g. remove the vars settlement claim or mark as ignored:

```ts
export const DEFAULT_FORMAT_PROMPT = `你必须严格按照以下 XML 标签格式输出回复，不要使用 Markdown 包裹：
<thinking>……</thinking>     ← 可选；内部任何字符都视为思考过程，不被解析
<maintext>……</maintext>     ← 必填；本回合的剧情正文，可多段，保留换行
<option>选项 A
选项 B
选项 C</option>              ← 必填；至少 2 项，每行一个
<sum>……</sum>               ← 必填；本回合一句话总结
说明：气数与名册由系统根据正文单独结算，不要依赖 <vars> 改档；正文事实须清晰（收徒、交恶、纳贡等写清楚人名与结果）。`;
```

- [ ] **Step 3: Add vitest**

```bash
npm i -D vitest
```

`package.json` scripts:

```json
"test": "vitest run",
"test:watch": "vitest"
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
```

- [ ] **Step 4: Placeholder test that will fail until Task 2**

`src/composables/world-delta.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseSettlePayload } from './world-delta'

describe('parseSettlePayload', () => {
  it('parses bare JSON', () => {
    const r = parseSettlePayload('{"resources":{},"ops":[],"summary":"无局面变更"}')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.delta.ops).toEqual([])
  })
})
```

- [ ] **Step 5: Run test — expect FAIL (module missing)**

```bash
npm test
```

Expected: cannot find module `./world-delta` or `parseSettlePayload` not exported.

- [ ] **Step 6: Commit**

```bash
git add src/types/world.ts src/sillytavern/types.ts package.json package-lock.json vitest.config.ts src/composables/world-delta.test.ts
git commit -m "feat: world settle types and vitest scaffold"
```

---

### Task 2: Pure world-delta engine (parse / validate / apply helpers)

**Files:**
- Create: `src/composables/world-delta.ts`
- Modify: `src/composables/world-delta.test.ts`
- Uses: `src/types/world.ts`, `RESOURCE_VAR_MAP` / `resolveNumericValue` from `game-bridge.ts`

**Interfaces:**
- Produces:
  - `parseSettlePayload(text: string): { ok: true; delta: WorldDelta } | { ok: false; error: string }`
  - `validateWorldDelta(delta: WorldDelta, snap: WorldSnapshot): ValidateResult`
  - `applyWorldDeltaToSnapshot(delta: WorldDelta, snap: WorldSnapshot): { snap: WorldSnapshot; result: ApplyResult }`  
    (pure apply on a clone — live apply in Task 3 wraps this or mutates game state from validated delta)

- [ ] **Step 1: Implement `parseSettlePayload`**

Rules:

- Trim; strip optional \`\`\`json ... \`\`\` fence
- `JSON.parse`
- Must be object; normalize `resources` object, `ops` array, `summary` string
- On failure return `{ ok: false, error }`

- [ ] **Step 2: Implement `validateWorldDelta`**

Rules (strict — any error → `ok: false`):

- `ops.length > 12` → error
- Count `disciple.add` > 3 → error
- Resource keys only in `灵石|灵谷|丹材|矿铁|声望|气运`
- Each op:
  - `disciple.add`: `name` non-empty string
  - `disciple.update` / `remove`: resolve by `id` first else unique `name` in snap.disciples; missing/ambiguous → error
  - `faction.update` / `city.update`: same id/name resolve
  - `notify.push`: `title` required
  - Unknown `op` → error
  - Enum checks: disciple status, faction stance, city attitude when present in patch
  - `relation` / `loyalty` / `influence`: finite numbers (clamp on apply, not validate fail unless NaN)

Return cleaned delta (optional) with same shape.

- [ ] **Step 3: Implement pure `applyWorldDeltaToSnapshot`**

- Deep clone snap (JSON)
- Apply resources via `resolveNumericValue` + RESOURCE_VAR_MAP keys on Resources
- Apply ops in order:
  - add: push Disciple with new id `d-${Date.now().toString(36)}-${random}` or sequential `d-gen-N`
  - update: Object.assign allowed fields
  - remove: **soft** — set `status: '叛离风险'` or filter out; **spec prefers soft** → set status to `'叛离风险'` and role note; also allow hard filter if op is remove — use soft: status `'叛离风险'`, mood `'离宗'`
  - faction/city: merge patch, clamp relation -100..100, influence 0..100, loyalty 0..100
  - notify: unshift notification with id `n-${...}`, time label short
- Collect Chinese `lines` for UI

- [ ] **Step 4: Expand tests**

Add cases:

- markdown fence JSON
- invalid JSON → ok false
- disciple.add then validate ok
- disciple.update unknown id → validate fail
- ops length 13 → fail
- apply resources relative `-30`
- apply disciple.add increases length

- [ ] **Step 5: Run tests**

```bash
npm test
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/composables/world-delta.ts src/composables/world-delta.test.ts
git commit -m "feat: world-delta parse validate apply engine"
```

---

### Task 3: Live factions/cities in useGameState + snapshot/restore

**Files:**
- Create: `src/composables/world-state.ts`
- Modify: `src/composables/useGameState.ts`
- Modify: `src/views/DiplomacyView.vue`
- Modify: `src/views/CitiesView.vue`
- Modify: `src/components/modals/ModalHost.vue` (city/faction lookups)

**Interfaces:**
- Produces:
  - `snapshotWorldState(): WorldSnapshot`
  - `restoreWorldState(snap: WorldSnapshot): void`
  - `applyValidatedDelta(delta: WorldDelta): ApplyResult` (validate again + apply to live state)
  - `useGameState().factions` / `.cities` as `ref`

- [ ] **Step 1: Seed state in useGameState**

Import `factions as initialFactions`, `cities as initialCities` from mock.

```ts
const factions = ref<Faction[]>(initialFactions.map((f) => ({ ...f })))
const cities = ref<CityState[]>(initialCities.map((c) => ({ ...c })))
```

On `applyOpeningConfig` / `resetGameToOpening`: re-seed from mock copies (same as disciples).

Export `factions`, `cities`.

Optional helpers used by apply:

```ts
function replaceDisciples(list: Disciple[]) { disciples.value = list }
function replaceFactions(list: Faction[]) { factions.value = list }
function replaceCities(list: CityState[]) { cities.value = list }
function replaceNotifications(list: NotificationItem[]) { notifications.value = list }
function setResourcesFrom(r: Resources) { Object.assign(resources, r) }
```

Or single `hydrateFromSnapshot(snap: WorldSnapshot)`.

- [ ] **Step 2: `world-state.ts`**

```ts
export function snapshotWorldState(): WorldSnapshot { /* read useGameState */ }
export function restoreWorldState(snap: WorldSnapshot): void { /* hydrate */ }
export function applyValidatedDelta(delta: WorldDelta): ApplyResult {
  const snap = snapshotWorldState()
  const v = validateWorldDelta(delta, snap)
  if (!v.ok) return { lines: [], changed: false }
  const { snap: next, result } = applyWorldDeltaToSnapshot(delta, snap)
  restoreWorldState(next)
  return result
}
```

Handle Ref unwrapping carefully (same pattern as game-bridge disciples).

- [ ] **Step 3: Wire Views**

`DiplomacyView.vue`: replace `import { factions } from mock` with `const { factions } = useGameState()` and `factions` in template as `factions` (unwrap ref auto).

`CitiesView.vue`: same for cities.

`ModalHost.vue`: resolve city/faction from game state lists.

- [ ] **Step 4: Build check**

```bash
npm run build
```

Expected: success.

- [ ] **Step 5: Commit**

```bash
git add src/composables/useGameState.ts src/composables/world-state.ts src/views/DiplomacyView.vue src/views/CitiesView.vue src/components/modals/ModalHost.vue
git commit -m "feat: live factions/cities state and world snapshot"
```

---

### Task 4: Expand live lore + stop story vars write

**Files:**
- Modify: `src/composables/game-bridge.ts` (`buildLiveLoreContent`)
- Modify: `src/composables/useTianji.ts` (`settleVariables` / callLlm path)

**Interfaces:**
- Consumes: snapshotWorldState or factions/cities from useGameState
- Produces: lore text with faction/city lines; story path no longer calls `applyVariablesToGame` on LLM vars

- [ ] **Step 1: Update `buildLiveLoreContent`**

After disciples line, add:

```
势力：赤焰谷(relation/stance)、…
城池：青石城(attitude)、…
```

Change settlement convention lines to:

```
结算约定：气数与名册/外交/城池由系统 settle 根据正文写入；请保证正文事实清楚。勿依赖 <vars> 改档。
记忆约定：须输出 <sum> 一句话总结。
```

- [ ] **Step 2: Disable story vars apply in `callLlm`**

In `useTianji.ts` after parsing:

- Still parse tags for display
- **Do not** call `settleVariables(nextVariables)` from story vars
- Keep `nextVariables` as `mergeSessionWithGame` snapshot only for session.variables resource display OR replace later with world snapshot vars

Replace:

```ts
const settled = settleVariables(nextVariables)
```

with:

```ts
// 局面写入改由 runSettle；此处仅同步只读气数快照到会话
const settled = mergeSessionWithGame({})
```

Remove or keep `settleVariables` for manual editor only (`commitVariablesFromEditor` still uses `applyVariablesToGame`).

- [ ] **Step 3: Manual气数簿 still works**

Ensure Variables UI still uses `commitVariablesFromEditor` / `applyVariablesToGame` for the 6 resources.

- [ ] **Step 4: Build**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/composables/game-bridge.ts src/composables/useTianji.ts
git commit -m "feat: lore reflects world; story no longer applies vars"
```

---

### Task 5: settle-runner + API routing

**Files:**
- Create: `src/composables/settle-runner.ts`
- Modify: `src/sillytavern/api-router.ts` if needed (task settle → secondary)
- Modify: `src/sillytavern/database.ts` ensure default settlementMode on load

**Interfaces:**
- Produces:

```ts
export type SettleOutcome =
  | { status: 'skipped'; reason: 'off' | 'secondary_only_unavailable' }
  | { status: 'empty'; summary?: string }
  | { status: 'applied'; lines: string[]; summary?: string; stateAfter: WorldSnapshot }
  | { status: 'failed'; error: string }

export async function runSettle(input: {
  userText: string
  maintext: string
  sum: string
  settings: AppSettings
  postChat: (args: {
    target: 'primary' | 'secondary'
    body: Record<string, unknown>
  }) => Promise<{ ok: true; text: string } | { ok: false; error: string }>
}): Promise<SettleOutcome>
```

- [ ] **Step 1: Settlement mode resolution**

```ts
function resolveSettleTarget(mode: SettlementMode, secondaryEnabled: boolean):
  | { kind: 'skip'; reason: ... }
  | { kind: 'call'; targets: Array<'secondary' | 'primary'> }
{
  if (mode === 'off') return { kind: 'skip', reason: 'off' }
  if (mode === 'secondary_only') {
    if (!secondaryEnabled) return { kind: 'skip', reason: 'secondary_only_unavailable' }
    return { kind: 'call', targets: ['secondary'] }
  }
  // secondary_then_primary
  if (secondaryEnabled) return { kind: 'call', targets: ['secondary', 'primary'] } // try secondary first, on fail primary
  return { kind: 'call', targets: ['primary'] }
}
```

- [ ] **Step 2: Build settle messages**

System/user content in Chinese, compact:

- Current snapshot text from helper `formatSnapshotForSettle(snap)`
- User text, maintext, sum
- Schema of allowed ops (short)
- Require pure JSON only
- temperature 0.2, max_tokens 1200

- [ ] **Step 3: Call loop**

For each target in order:

1. `postChat` with model from primary/secondary settings
2. parse + validate against **current** snapshot
3. if fail and retries left for this target: re-prompt with `errors.join('\n')` once
4. if still fail: try next target
5. if success: `applyValidatedDelta` → snapshot → return applied

If all fail: `{ status: 'failed', error }`

If delta empty ops and empty resources: `{ status: 'empty' }` still success path with stateAfter current.

- [ ] **Step 4: Wire postChat adapter in useTianji later (Task 6)** — for now unit-test resolve/format with pure functions if extracted.

Export `formatSnapshotForSettle` and `resolveSettleTarget` for tests.

- [ ] **Step 5: Add test for resolveSettleTarget**

In `world-delta.test.ts` or `settle-runner.test.ts`:

- off → skip
- secondary_only without secondary → skip
- secondary_then_primary without secondary → primary only
- secondary_then_primary with secondary → secondary then primary

- [ ] **Step 6: database migration**

When loading settings, if `settlementMode` undefined, set `'secondary_then_primary'`.

- [ ] **Step 7: Commit**

```bash
git add src/composables/settle-runner.ts src/sillytavern/database.ts src/composables/settle-runner.test.ts
git commit -m "feat: settle-runner with mode resolution and retry"
```

---

### Task 6: Integrate runSettle into useTianji + rollback stateAfter

**Files:**
- Modify: `src/composables/useTianji.ts`
- Uses: `settle-runner`, `world-state`, `postChatCompletion` (non-stream for settle)

**Interfaces:**
- After successful story LLM path (and after local mock path: skip settle or empty)
- Persist `stateAfter` on assistant ChatMessage
- `restoreVarsFromKept` also `restoreWorldState` from last `stateAfter`

- [ ] **Step 1: After story result in `callLlm` / `sendPlayer`**

Preferred: `callLlm` returns content/parsed; then `sendPlayer` calls:

```ts
const settle = await runSettle({
  userText: text,
  maintext: result.parsed?.maintext || result.content,
  sum: result.parsed?.sum || '',
  settings: settings.value!,
  postChat: async ({ target, body }) => {
    const api = settings.value!.api
    const ep = target === 'secondary' && api.secondary?.enabled
      ? { baseUrl: normalizeBaseUrl(api.secondary.baseUrl), apiKey: api.secondary.apiKey, model: api.secondary.model }
      : { baseUrl: normalizeBaseUrl(api.baseUrl), apiKey: api.apiKey, model: api.model }
    const completion = await postChatCompletion({ baseUrl: ep.baseUrl, apiKey: String(ep.apiKey||''), body: { ...body, model: ep.model, stream: false } })
    // extract text same as story path
  },
})
```

Handle outcomes:

- `skipped` + secondary_only_unavailable → system message once-friendly: `局面结算：仅次通灵，但未启用次 API，本回未改局面`
- `skipped` + off → no message (or first-time only; prefer silent)
- `failed` → `【局面结算失败】${error}（本回局面未变更）`
- `applied` → `【局面结算】${lines.join('；')}` + refresh lore
- `empty` → optional silent or `【局面结算】无变更`

- [ ] **Step 2: Save assistant message with `stateAfter: snapshotWorldState()` always after settle attempt** (even empty), so rollback is consistent. On skip/fail still save current state snapshot.

- [ ] **Step 3: Update `restoreVarsFromKept`**

```ts
for (let i = kept.length - 1; i >= 0; i--) {
  const m = kept[i]
  if (m.stateAfter) {
    restoreWorldState(m.stateAfter)
    return mergeSessionWithGame({})
  }
  // legacy variablesAfter resource-only fallback
  ...
}
```

- [ ] **Step 4: Offline mock replies**

Do not call settle (no API). stateAfter = current snapshot when appending assistant.

- [ ] **Step 5: Memory still from sum** — keep `recordTurnSum` after story; independent of settle.

- [ ] **Step 6: Build**

```bash
npm run build
```

- [ ] **Step 7: Commit**

```bash
git add src/composables/useTianji.ts
git commit -m "feat: tianji runSettle after story with stateAfter rollback"
```

---

### Task 7: 密匣 UI for settlementMode

**Files:**
- Modify: `src/components/SillyTavern/SettingsModal.vue`

- [ ] **Step 1: On secondary tab, add radio/select**

Label: `局面结算`

Options:

- `off` — 关闭（最省 token，对话不改局面）
- `secondary_only` — 仅次通灵（推荐正确率；未配置次 API 则不结算）
- `secondary_then_primary` — 次通灵优先，否则主通灵（默认）

Helper text: `结算为短 JSON 调用。关闭可避免每回合额外请求。`

Bind to `props.settings.settlementMode` via `patch({ settlementMode: '...' })`.

Secondary draft temperature default for settle is independent; optional note: “建议次 API 使用较低温度（≤0.3）”。

- [ ] **Step 2: Ensure boot merges default when old settings lack field** (Task 5 database + useTianji boot already).

- [ ] **Step 3: Manual UI check list in commit message**

- [ ] **Step 4: Commit**

```bash
git add src/components/SillyTavern/SettingsModal.vue
git commit -m "feat: settlement mode option in 密匣"
```

---

### Task 8: End-to-end hardening + docs touch

**Files:**
- Modify: `docs/superpowers/specs/2026-07-23-living-world-settle-design.md` only if implementation drift needs a one-line note
- Modify: any missed import of mock factions/cities for runtime mutation

- [ ] **Step 1: Grep for runtime consumers of mock cities/factions**

```bash
# use project grep tool
# pattern: from '@/data/mock' in views/modals
```

Ensure no remaining **write-path** assumes static mock for diplomacy/cities game truth. Read-only mock seed OK.

- [ ] **Step 2: Full test + build**

```bash
npm test
npm run build
```

Expected: both pass.

- [ ] **Step 3: Smoke checklist (manual)**

1. settlementMode=off → one API call per turn (story only); roster unchanged after “收徒” narrative  
2. secondary_only without secondary → system skip message; no apply  
3. secondary_then_primary without secondary → second call (settle JSON); valid add disciple appears in 弟子名册  
4. Delete message / regenerate restores roster  
5. 气数簿 manual edit still changes resources  

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: living world settle e2e hardening"
```

---

## Spec coverage check

| Spec requirement | Task |
|------------------|------|
| Unified writable state (disciples/factions/cities/resources) | 3 |
| Story/settle split; story no write | 4, 6 |
| Secondary settle preferred | 5, 6 |
| Mode off / secondary_only / secondary_then_primary | 5, 7 |
| Strict validate + 1 retry | 2, 5 |
| stateAfter rollback | 6 |
| Live lore update | 4 |
| 密匣 option for token | 7 |
| Phase-1 ops only | 2 |
| DEFAULT_FORMAT_PROMPT | 1 |

## Execution notes

- Prefer **subagent-driven-development**: one task per subagent, review before next.
- Do not enable settle on mock offline path.
- Keep `applyVariablesToGame` for manual editor and resource kernel inside apply snapshot.
