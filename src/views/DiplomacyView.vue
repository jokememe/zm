<script setup lang="ts">
import Icon from '@/components/ui/Icon.vue'
import { factions } from '@/data/mock'
import { useModal } from '@/composables/useModal'
import { useTianji } from '@/composables/useTianji'
import { useGameState } from '@/composables/useGameState'

const { open } = useModal()
const { injectContext } = useTianji()
const { focusTianji } = useGameState()

const stanceClass: Record<string, string> = {
  同盟: 'tag-jade',
  友好: 'tag-moon',
  中立: '',
  敌对: 'tag-rose',
  觊觎: 'tag-amber',
}

function relColor(n: number) {
  if (n >= 30) return 'var(--jade)'
  if (n <= -20) return 'var(--rose)'
  return 'var(--ink-secondary)'
}
</script>

<template>
  <div id="view-diplomacy" class="view">
    <div class="section-head">
      <div>
        <h2><span class="ornament" />势力外交</h2>
        <p class="section-desc">合作、排挤、侵略与同盟皆有可能。辞令与实力，缺一不可。</p>
      </div>
      <button
        id="btn-diplomacy-tianji"
        class="btn btn-soft"
        type="button"
        @click="injectContext('外交', '多方势力博弈'); focusTianji()"
      >
        <Icon name="scroll" :size="16" /> 注入天机
      </button>
    </div>

    <div class="grid-2 stagger">
      <article
        v-for="f in factions"
        :id="`faction-card-${f.id}`"
        :key="f.id"
        class="panel-card faction interactive"
        @click="open('faction-talk', { factionId: f.id })"
      >
        <header>
          <div class="faction__icon">
            <Icon name="diplomacy" :size="18" />
          </div>
          <div class="meta">
            <h3>{{ f.name }}</h3>
            <span class="muted">{{ f.power }}</span>
          </div>
          <span class="tag" :class="stanceClass[f.stance]">{{ f.stance }}</span>
        </header>

        <p>{{ f.recent }}</p>
        <p v-if="f.demand" class="demand">诉求：{{ f.demand }}</p>

        <div class="rel">
          <span>关系值</span>
          <strong :style="{ color: relColor(f.relation) }">
            {{ f.relation > 0 ? '+' : '' }}{{ f.relation }}
          </strong>
          <div class="rel-bar">
            <div
              class="rel-bar__fill"
              :style="{
                left: f.relation >= 0 ? '50%' : `${50 + f.relation / 2}%`,
                width: `${Math.abs(f.relation) / 2}%`,
                background: f.relation >= 0 ? 'var(--jade)' : 'var(--rose)',
              }"
            />
            <div class="rel-bar__mid" />
          </div>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.faction {
  padding: 1.15rem;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

.faction header {
  display: flex;
  align-items: flex-start;
  gap: 0.7rem;
}

.faction__icon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: var(--moon-glow);
  color: var(--moon-deep);
  flex-shrink: 0;
}

.meta {
  flex: 1;
  min-width: 0;
}

.meta h3 {
  font-size: 1.05rem;
}

.faction > p {
  font-size: 0.88rem;
  color: var(--ink-secondary);
  line-height: 1.55;
}

.demand {
  padding: 0.5rem 0.7rem;
  border-radius: var(--radius-sm);
  background: var(--amber-soft);
  color: var(--amber);
  font-size: 0.84rem !important;
  border: 1px solid rgba(196, 149, 74, 0.22);
}

.rel {
  display: grid;
  grid-template-columns: auto auto 1fr;
  gap: 0.55rem;
  align-items: center;
  font-size: 0.78rem;
  color: var(--ink-muted);
}

.rel strong {
  font-size: 0.95rem;
  font-variant-numeric: tabular-nums;
}

.rel-bar {
  position: relative;
  height: 6px;
  border-radius: var(--radius-full);
  background: rgba(120, 150, 190, 0.12);
  overflow: hidden;
}

.rel-bar__mid {
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 1px;
  background: rgba(100, 130, 160, 0.35);
}

.rel-bar__fill {
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: inherit;
}
</style>
