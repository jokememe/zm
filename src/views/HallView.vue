<script setup lang="ts">
import { computed } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { heirs } from '@/data/mock'
import { useModal } from '@/composables/useModal'
import { useGameState } from '@/composables/useGameState'
import { useTianji } from '@/composables/useTianji'
import {
  buildHallChronicle,
  buildHallShortcuts,
  buildHallStats,
} from '@/composables/hall-overview'
import type { ViewId } from '@/types/game'

const { open } = useModal()
const {
  setView,
  focusTianji,
  replayOpening,
  resetGameToOpening,
  sectName,
  masterName,
  disciples,
  difficultyLabel,
  openUrgentEvents,
  factions,
  cities,
  fieldPlots,
  alchemyRecipes,
  designatedHeirId,
  calendar,
  resources,
} = useGameState()
const { injectContext, startOpeningRun } = useTianji()

const discipleCount = computed(() => disciples.value.length)
const pendingEvents = openUrgentEvents

const overviewInput = computed(() => {
  const heir = heirs.find((h) => h.id === designatedHeirId.value)
  const heirDisc = heir ? disciples.value.find((d) => d.id === heir.discipleId) : null
  return {
    era: calendar.era,
    year: calendar.year,
    season: calendar.season,
    sectName: sectName.value,
    masterName: masterName.value,
    disciples: disciples.value,
    factions: factions.value,
    cities: cities.value,
    fieldPlots: fieldPlots.value,
    openUrgents: openUrgentEvents.value,
    alchemyRecipes: alchemyRecipes.value,
    designatedHeirId: designatedHeirId.value,
    heirName: heirDisc?.name || heir?.name || null,
    resources: {
      prestige: resources.prestige,
      destiny: resources.destiny,
      herb: resources.herb,
    },
  }
})

const hallStats = computed(() => buildHallStats(overviewInput.value))
const shortcuts = computed(() => buildHallShortcuts(overviewInput.value))
const hallChronicle = computed(() => buildHallChronicle(overviewInput.value))

async function startFromBeginning() {
  if (
    !confirm(
      '从头开局将重置资源、历法、通知、存档与天机会话。当前推演进度会清空，是否继续？',
    )
  ) {
    return
  }
  resetGameToOpening()
  await startOpeningRun()
  replayOpening()
}

function openEvent(id: string) {
  open('event-detail', { eventId: id })
}

function go(id: ViewId) {
  setView(id)
}
</script>

<template>
  <div id="view-hall" class="view hall-view">
    <header class="hero panel-card">
      <div class="hero__glow" aria-hidden="true" />
      <div class="hero__content">
        <span class="tag tag-moon">破败中兴 · {{ difficultyLabel }}</span>
        <h1>{{ sectName }} · 大殿</h1>
        <p>
          掌门 {{ masterName }} 独守残峰，在册弟子 {{ discipleCount }} 人。灵脉未绝，人心未散——从亲力亲为到弟子成林，复兴之路始于今日一念。
        </p>
        <div class="hero__actions">
          <button
            v-if="pendingEvents.length"
            id="btn-hall-urgent"
            class="btn btn-primary"
            type="button"
            @click="openEvent(pendingEvents[0].id)"
          >
            <Icon name="warn" :size="16" /> 处理紧急事务
          </button>
          <button
            v-else
            id="btn-hall-urgent-done"
            class="btn btn-soft"
            type="button"
            disabled
          >
            <Icon name="spark" :size="16" /> 暂无待决
          </button>
          <button
            id="btn-hall-tianji"
            class="btn btn-ghost"
            type="button"
            @click="injectContext('宗门大殿', '总览现状与威胁'); focusTianji()"
          >
            <Icon name="scroll" :size="16" /> 问天机总览
          </button>
          <button
            id="btn-hall-newgame"
            class="btn btn-soft"
            type="button"
            @click="startFromBeginning"
          >
            <Icon name="spark" :size="16" /> 从头开局
          </button>
        </div>
      </div>
      <div class="hero__ornament" aria-hidden="true">
        <div class="moon-ring">
          <Icon name="moon" :size="48" />
        </div>
      </div>
    </header>

    <section class="stats grid-4 stagger" aria-label="关键指标">
      <article
        v-for="s in hallStats"
        :id="`hall-stat-${s.id}`"
        :key="s.id"
        class="stat-card panel-card"
      >
        <div class="stat-card__icon" :class="`tone-${s.tone}`">
          <Icon :name="s.icon" :size="18" />
        </div>
        <div>
          <span class="stat-card__label">{{ s.label }}</span>
          <strong class="stat-value">{{ s.value }}</strong>
          <p>{{ s.sub }}</p>
        </div>
      </article>
    </section>

    <div class="hall-grid">
      <section class="panel-card block" id="hall-urgent-list">
        <div class="section-head">
          <h2><span class="ornament" />紧急与待决</h2>
          <span class="tag" :class="pendingEvents.length ? 'tag-rose' : 'tag-jade'">
            {{ pendingEvents.length ? `${pendingEvents.length} 件` : '已清' }}
          </span>
        </div>
        <ul v-if="pendingEvents.length" class="event-list">
          <li
            v-for="e in pendingEvents"
            :id="`hall-event-${e.id}`"
            :key="e.id"
            class="event-item interactive"
            @click="openEvent(e.id)"
          >
            <div class="event-item__bar" :class="e.severity" />
            <div class="event-item__body">
              <div class="event-item__top">
                <strong>{{ e.title }}</strong>
                <time>{{ e.timeLabel }}</time>
              </div>
              <p>{{ e.summary }}</p>
              <span class="muted">{{ e.source }} · 点击处理</span>
            </div>
            <Icon name="chevron-right" :size="16" class="chev" />
          </li>
        </ul>
        <p v-else class="empty-urgent muted">
          当前无待决事务。天机推演中的风闻与决议会出现在通知铃铛中。
        </p>
      </section>

      <section class="panel-card block" id="hall-shortcuts">
        <div class="section-head">
          <h2><span class="ornament" />事务捷径</h2>
        </div>
        <div class="shortcut-grid">
          <button
            v-for="s in shortcuts"
            :id="`hall-shortcut-${s.id}`"
            :key="s.id"
            type="button"
            class="shortcut panel-card interactive"
            @click="go(s.id)"
          >
            <span class="shortcut__icon"><Icon :name="s.icon" :size="18" /></span>
            <strong>{{ s.label }}</strong>
            <span>{{ s.desc }}</span>
          </button>
        </div>

        <div class="divider" />

        <div class="section-head">
          <h2><span class="ornament" />宗门简史</h2>
        </div>
        <ol class="chronicle">
          <li v-for="c in hallChronicle" :key="c.id">
            <time>{{ c.year }}</time>
            <p>{{ c.text }}</p>
          </li>
        </ol>
      </section>
    </div>
  </div>
</template>

<style scoped>
.hall-view {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}

.hero {
  position: relative;
  overflow: hidden;
  padding: 1.5rem 1.6rem;
  display: flex;
  justify-content: space-between;
  gap: 1.5rem;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.88), rgba(230, 240, 252, 0.75));
  border: 1px solid var(--border-medium);
}

.hero__glow {
  position: absolute;
  width: 280px;
  height: 280px;
  right: -40px;
  top: -80px;
  background: radial-gradient(circle, rgba(91, 141, 239, 0.22), transparent 65%);
  pointer-events: none;
}

.hero__content {
  position: relative;
  max-width: 640px;
}

.hero h1 {
  margin: 0.55rem 0 0.5rem;
  font-size: 1.65rem;
  letter-spacing: 0.06em;
}

.hero p {
  color: var(--ink-secondary);
  line-height: 1.7;
  font-size: 0.92rem;
  margin-bottom: 1.1rem;
}

.hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
}

@media (max-width: 900px), ((orientation: portrait) and (max-width: 1100px)) {
  .hero__actions .btn {
    flex: 1 1 auto;
    min-width: calc(50% - 0.4rem);
    justify-content: center;
  }

  .hero__ornament {
    display: none;
  }

  .stats.grid-4 {
    grid-template-columns: repeat(2, 1fr);
  }
}

.hero__ornament {
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.moon-ring {
  width: 110px;
  height: 110px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--moon-deep);
  background: radial-gradient(circle at 35% 35%, #fff, rgba(200, 220, 245, 0.5));
  border: 1px solid var(--border-moon);
  box-shadow: 0 0 0 8px rgba(91, 141, 239, 0.08), var(--shadow-md);
  animation: float-y 5s ease-in-out infinite;
}

.stat-card {
  display: flex;
  gap: 0.75rem;
  padding: 1rem;
  align-items: flex-start;
}

.stat-card__icon {
  width: 38px;
  height: 38px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.tone-moon { background: var(--moon-glow); color: var(--moon-deep); }
.tone-amber { background: var(--amber-soft); color: var(--amber); }
.tone-rose { background: var(--rose-soft); color: var(--rose); }
.tone-jade { background: var(--jade-soft); color: var(--jade); }

.stat-card__label {
  display: block;
  font-size: 0.75rem;
  color: var(--ink-muted);
  margin-bottom: 0.15rem;
}

.stat-card strong {
  font-size: 1.25rem;
  display: block;
}

.stat-card p {
  font-size: 0.75rem;
  color: var(--ink-muted);
  margin-top: 0.2rem;
}

.hall-grid {
  display: grid;
  grid-template-columns: 1.15fr 0.85fr;
  gap: 1.1rem;
}

.block {
  padding: 1.1rem 1.15rem 1.2rem;
}

.event-list {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.empty-urgent {
  margin: 0.5rem 0 0.25rem;
  font-size: 0.88rem;
  line-height: 1.6;
}

.event-item {
  display: flex;
  align-items: stretch;
  gap: 0;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  background: rgba(255, 255, 255, 0.55);
  overflow: hidden;
  cursor: pointer;
  transition: all var(--dur-mid) var(--ease-out);
}

.event-item:hover {
  border-color: var(--border-moon);
  box-shadow: var(--shadow-glow);
  transform: translateY(-1px);
}

.event-item__bar {
  width: 4px;
  flex-shrink: 0;
}

.event-item__bar.critical { background: var(--rose); }
.event-item__bar.warn { background: var(--amber); }
.event-item__bar.info { background: var(--moon); }

.event-item__body {
  flex: 1;
  padding: 0.85rem 0.9rem;
  min-width: 0;
}

.event-item__top {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.3rem;
}

.event-item__top time {
  font-size: 0.72rem;
  color: var(--ink-faint);
  white-space: nowrap;
}

.event-item p {
  font-size: 0.84rem;
  color: var(--ink-secondary);
  line-height: 1.55;
  margin-bottom: 0.35rem;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.event-item .chev {
  align-self: center;
  margin-right: 0.65rem;
  color: var(--ink-faint);
}

.shortcut-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.55rem;
}

.shortcut {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.25rem;
  padding: 0.75rem;
  text-align: left;
  border: 1px solid var(--border-subtle);
}

.shortcut__icon {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  background: var(--moon-glow);
  color: var(--moon-deep);
  margin-bottom: 0.2rem;
}

.shortcut strong {
  font-size: 0.88rem;
}

.shortcut span {
  font-size: 0.72rem;
  color: var(--ink-muted);
}

.chronicle {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.chronicle li {
  padding-left: 0.85rem;
  border-left: 2px solid var(--border-moon);
}

.chronicle time {
  font-size: 0.72rem;
  color: var(--moon-deep);
  font-weight: 600;
}

.chronicle p {
  font-size: 0.84rem;
  color: var(--ink-secondary);
  margin-top: 0.15rem;
  line-height: 1.5;
}

@media (max-width: 1100px) {
  .hall-grid {
    grid-template-columns: 1fr;
  }
  .hero__ornament {
    display: none;
  }
}
</style>
