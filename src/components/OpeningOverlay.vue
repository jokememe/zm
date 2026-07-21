<script setup lang="ts">
import { ref, computed } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import {
  openingSlides,
  DIFFICULTY_OPTIONS,
  DEFAULT_SECT_NAME,
  DEFAULT_MASTER_NAME,
  type DifficultyId,
} from '@/data/opening'
import { useGameState } from '@/composables/useGameState'
import { useTianji } from '@/composables/useTianji'

const {
  showOpening,
  markOpeningDone,
  resetGameToOpening,
  applyOpeningConfig,
  focusTianji,
  setView,
  sectName: liveSect,
  masterName: liveMaster,
  difficulty: liveDiff,
} = useGameState()
const { startOpeningRun } = useTianji()

const step = ref(0)
const busy = ref(false)
const enterError = ref<string | null>(null)

/** 开场草稿（最后一页提交） */
const draftSect = ref(liveSect.value || DEFAULT_SECT_NAME)
const draftMaster = ref(liveMaster.value || DEFAULT_MASTER_NAME)
const draftDiff = ref<DifficultyId>(liveDiff.value || 'standard')

const slide = computed(() => openingSlides[step.value] ?? openingSlides[0])
const isLast = computed(() => step.value >= openingSlides.length - 1)
const brandName = computed(() => draftSect.value.trim() || DEFAULT_SECT_NAME)

const selectedDiff = computed(
  () => DIFFICULTY_OPTIONS.find((d) => d.id === draftDiff.value) ?? DIFFICULTY_OPTIONS[0],
)

function next() {
  if (isLast.value) return
  step.value += 1
  enterError.value = null
}

function prev() {
  if (step.value > 0) step.value -= 1
  enterError.value = null
}

function commitConfig() {
  applyOpeningConfig({
    sectName: draftSect.value.trim() || DEFAULT_SECT_NAME,
    masterName: draftMaster.value.trim() || DEFAULT_MASTER_NAME,
    difficulty: draftDiff.value,
  })
}

/**
 * 先进游戏、后刷天机。
 * 绝不能 await 天机 DB 初始化再关叠层——IndexedDB 失败时会永远卡在开场。
 */
function enterNow() {
  if (busy.value) return
  busy.value = true
  enterError.value = null
  try {
    commitConfig()
    // ★ 先关叠层，保证一定能进大殿
    markOpeningDone()
    setView('hall')
    focusTianji()
    // 天机卷首后台写，失败不影响开局
    void startOpeningRun().catch((e) => {
      console.warn('[开局] 天机卷首写入失败', e)
    })
  } catch (e) {
    console.error('[开局] 失败', e)
    enterError.value = (e as Error)?.message || '开局失败，请再试一次'
    // 兜底：即便配置异常也尽量进游戏
    try {
      markOpeningDone()
      setView('hall')
    } catch {
      /* ignore */
    }
  } finally {
    busy.value = false
  }
}

/** 踏入山门 */
function beginJourney() {
  enterNow()
}

/** 跳过序章 */
function enterGame() {
  enterNow()
}

/** 真正从头：重置经营（不卡在天机） */
function startFresh() {
  if (
    !confirm(
      '将重置资源、历法、通知与天机会话到开局状态，当前推演进度会清空。是否从头开始？',
    )
  ) {
    return
  }
  busy.value = true
  enterError.value = null
  try {
    resetGameToOpening()
    draftSect.value = DEFAULT_SECT_NAME
    draftMaster.value = DEFAULT_MASTER_NAME
    draftDiff.value = 'standard'
    step.value = 0
    void startOpeningRun().catch(() => {})
    step.value = openingSlides.length - 1
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="showOpening"
      class="opening"
      role="dialog"
      aria-modal="true"
      aria-labelledby="opening-title"
    >
      <div class="opening__bg" aria-hidden="true" />
      <div class="opening__card" :class="{ 'opening__card--wide': isLast }">
        <header class="opening__head">
          <span class="tag" :class="`tag-${slide.tone || 'moon'}`">{{ slide.eyebrow }}</span>
          <p class="opening__brand">{{ brandName }} · 开局</p>
        </header>

        <div class="opening__body">
          <h1 id="opening-title">{{ isLast ? '立宗继位' : slide.title }}</h1>
          <p v-if="!isLast" class="opening__text">{{ slide.body }}</p>

          <div v-else class="opening__setup">
            <p class="opening__text">
              先师已逝。你将接过掌门印——写下宗门之名与你的名讳，并选定开局难度。
            </p>

            <div class="setup-fields">
              <label class="field">
                <span class="field__label">宗门之名</span>
                <input
                  v-model="draftSect"
                  type="text"
                  maxlength="24"
                  class="field__input"
                  placeholder="如：青岚宗"
                  autocomplete="off"
                />
              </label>
              <label class="field">
                <span class="field__label">掌门之名</span>
                <input
                  v-model="draftMaster"
                  type="text"
                  maxlength="16"
                  class="field__input"
                  placeholder="如：沈青岚"
                  autocomplete="off"
                />
              </label>
            </div>

            <p class="setup-diff-label">开局难度</p>
            <div class="diff-grid" role="radiogroup" aria-label="开局难度">
              <button
                v-for="opt in DIFFICULTY_OPTIONS"
                :key="opt.id"
                type="button"
                class="diff-card"
                :class="[
                  `diff-card--${opt.tone}`,
                  { 'diff-card--on': draftDiff === opt.id },
                ]"
                role="radio"
                :aria-checked="draftDiff === opt.id"
                @click="draftDiff = opt.id"
              >
                <strong>{{ opt.label }}</strong>
                <span>{{ opt.blurb }}</span>
              </button>
            </div>

            <p class="opening__you">
              你将以掌门
              <strong>{{ draftMaster.trim() || DEFAULT_MASTER_NAME }}</strong>
              之名，执掌
              <strong>{{ draftSect.trim() || DEFAULT_SECT_NAME }}</strong>
              ·
              <span class="tag" :class="`tag-${selectedDiff.tone}`">{{ selectedDiff.label }}</span>
            </p>

            <p v-if="enterError" class="opening__err">{{ enterError }}</p>
          </div>
        </div>

        <div class="opening__dots" aria-hidden="true">
          <span
            v-for="(s, i) in openingSlides"
            :key="s.id"
            class="dot"
            :class="{ on: i === step }"
          />
        </div>

        <footer class="opening__foot">
          <button
            v-if="step > 0"
            type="button"
            class="btn btn-ghost"
            :disabled="busy"
            @click="prev"
          >
            上一页
          </button>
          <div class="opening__foot-right">
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              :disabled="busy"
              @click="startFresh"
            >
              重置
            </button>
            <button
              v-if="!isLast"
              type="button"
              class="btn btn-primary"
              :disabled="busy"
              @click="next"
            >
              续页
              <Icon name="chevron-right" :size="16" />
            </button>
            <button
              v-else
              type="button"
              class="btn btn-primary"
              :disabled="busy"
              @click="beginJourney"
            >
              <Icon name="scroll" :size="16" />
              踏入山门 · 开局
            </button>
          </div>
        </footer>

        <button type="button" class="opening__skip" :disabled="busy" @click="enterGame">
          跳过序章，直接开局
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.opening {
  position: fixed;
  inset: 0;
  z-index: 300;
  display: grid;
  place-items: center;
  padding: 1.25rem;
  padding-bottom: max(1.25rem, env(safe-area-inset-bottom, 0px));
}

.opening__bg {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 80% 60% at 50% 20%, rgba(91, 141, 239, 0.2), transparent 55%),
    radial-gradient(ellipse 60% 50% at 80% 80%, rgba(123, 107, 176, 0.12), transparent 50%),
    rgba(26, 36, 51, 0.55);
  backdrop-filter: blur(10px);
}

.opening__card {
  position: relative;
  width: min(560px, 100%);
  max-height: min(92vh, 900px);
  overflow-y: auto;
  padding: 1.5rem 1.6rem 1.25rem;
  border-radius: var(--radius-xl);
  border: 1px solid var(--border-medium);
  background: rgba(252, 253, 255, 0.96);
  box-shadow: var(--shadow-float);
  animation: open-in var(--dur-slow) var(--ease-out);
}

.opening__card--wide {
  width: min(640px, 100%);
}

@keyframes open-in {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.opening__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.opening__brand {
  margin: 0;
  font-size: 0.78rem;
  color: var(--ink-muted);
  letter-spacing: 0.06em;
}

.opening__body h1 {
  margin: 0 0 0.75rem;
  font-family: var(--font-display);
  font-size: 1.55rem;
  font-weight: 600;
  color: var(--ink-primary);
}

.opening__text {
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.75;
  color: var(--ink-secondary);
}

.opening__setup {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.setup-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.65rem;
}

@media (max-width: 520px) {
  .setup-fields {
    grid-template-columns: 1fr;
  }
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.field__label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--ink-muted);
  letter-spacing: 0.04em;
}

.field__input {
  padding: 0.55rem 0.7rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-medium);
  background: var(--bg-elevated, #fff);
  color: var(--ink-primary);
  transition: border-color var(--dur-fast);
}

.field__input:focus {
  border-color: var(--moon);
  box-shadow: 0 0 0 3px var(--moon-glow);
}

.setup-diff-label {
  margin: 0.25rem 0 0;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--ink-muted);
  letter-spacing: 0.04em;
}

.diff-grid {
  display: grid;
  gap: 0.5rem;
}

.diff-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.25rem;
  text-align: left;
  padding: 0.7rem 0.85rem;
  border-radius: var(--radius-md, 10px);
  border: 1px solid var(--border-medium);
  background: rgba(255, 255, 255, 0.6);
  transition:
    border-color var(--dur-fast),
    background var(--dur-fast),
    box-shadow var(--dur-fast);
}

.diff-card strong {
  font-size: 0.9rem;
  color: var(--ink-primary);
}

.diff-card span {
  font-size: 0.78rem;
  line-height: 1.45;
  color: var(--ink-muted);
}

.diff-card:hover {
  border-color: var(--moon);
}

.diff-card--on {
  border-color: var(--moon);
  background: var(--moon-glow);
  box-shadow: 0 0 0 1px var(--moon);
}

.diff-card--on.diff-card--rose {
  border-color: var(--rose);
  background: var(--rose-soft);
  box-shadow: 0 0 0 1px var(--rose);
}

.diff-card--on.diff-card--amber {
  border-color: var(--amber);
  background: var(--amber-soft);
  box-shadow: 0 0 0 1px var(--amber);
}

.diff-card--on.diff-card--jade {
  border-color: var(--jade);
  background: var(--jade-soft);
  box-shadow: 0 0 0 1px var(--jade);
}

.opening__you {
  margin: 0;
  padding: 0.65rem 0.75rem;
  border-radius: var(--radius-sm);
  background: var(--moon-glow);
  color: var(--moon-deep);
  font-size: 0.88rem;
  line-height: 1.5;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
}

.opening__err {
  margin: 0;
  padding: 0.5rem 0.65rem;
  border-radius: var(--radius-sm);
  background: var(--rose-soft);
  color: var(--rose);
  font-size: 0.82rem;
}

.opening__dots {
  display: flex;
  gap: 0.4rem;
  justify-content: center;
  margin: 1.25rem 0 1rem;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ink-faint);
  transition:
    background var(--dur-fast),
    transform var(--dur-fast);
}

.dot.on {
  background: var(--moon);
  transform: scale(1.25);
}

.opening__foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem;
  position: sticky;
  bottom: 0;
  padding-top: 0.35rem;
  background: linear-gradient(180deg, transparent, rgba(252, 253, 255, 0.95) 30%);
}

.opening__foot-right {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin-left: auto;
}

.opening__skip {
  appearance: none;
  border: none;
  background: none;
  color: var(--ink-muted);
  font-size: 0.78rem;
  cursor: pointer;
  margin-top: 0.85rem;
  width: 100%;
  text-align: center;
  font-family: inherit;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.opening__skip:hover {
  color: var(--ink-secondary);
}

.opening__skip:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.tag-moon {
  background: var(--moon-glow);
  color: var(--moon-deep);
}
.tag-jade {
  background: var(--jade-soft);
  color: var(--jade);
}
.tag-rose {
  background: var(--rose-soft);
  color: var(--rose);
}
.tag-amber {
  background: var(--amber-soft);
  color: var(--amber);
}

.tag {
  display: inline-flex;
  padding: 0.2rem 0.55rem;
  border-radius: var(--radius-full);
  font-size: 0.72rem;
  font-weight: 600;
}
</style>
