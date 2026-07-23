<script setup lang="ts">
import Icon from '@/components/ui/Icon.vue'
import { useModal } from '@/composables/useModal'
import { useTianji } from '@/composables/useTianji'
import { useGameState } from '@/composables/useGameState'

const { open } = useModal()
const { injectContext } = useTianji()
const { focusTianji, cities } = useGameState()

const attitudeClass: Record<string, string> = {
  恭顺: 'tag-jade',
  中立: 'tag-moon',
  犹豫: 'tag-amber',
  敌视: 'tag-rose',
}
</script>

<template>
  <div id="view-cities" class="view">
    <div class="section-head">
      <div>
        <h2><span class="ornament" />城池纳贡</h2>
        <p class="section-desc">山门之威，延及城坞。影响力决定纳贡厚薄与商旅归属。</p>
      </div>
      <button
        id="btn-cities-tianji"
        class="btn btn-soft"
        type="button"
        @click="injectContext('城池', '影响力与纳贡'); focusTianji()"
      >
        <Icon name="scroll" :size="16" /> 注入天机
      </button>
    </div>

    <div class="grid-2 stagger">
      <article
        v-for="c in cities"
        :id="`city-card-${c.id}`"
        :key="c.id"
        class="panel-card city interactive"
        @click="open('city-detail', { cityId: c.id })"
      >
        <header>
          <div>
            <h3>{{ c.name }}</h3>
            <span class="muted">{{ c.distance }} · {{ c.governor }}</span>
          </div>
          <span class="tag" :class="attitudeClass[c.attitude]">{{ c.attitude }}</span>
        </header>
        <p>{{ c.notes }}</p>
        <div class="tribute">
          <Icon name="grain" :size="15" />
          <span>
            纳贡：{{ c.tribute.type }}
            <strong>{{ c.tribute.amount }}</strong>
            / {{ c.tribute.period }}
          </span>
        </div>
        <div class="inf">
          <div class="inf__label">
            <span>宗门影响力</span>
            <span>{{ c.influence }}</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" :style="{ width: c.influence + '%' }" />
          </div>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.city {
  padding: 1.15rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.city header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.75rem;
}

.city h3 {
  font-size: 1.08rem;
  margin-bottom: 0.2rem;
}

.city p {
  font-size: 0.88rem;
  color: var(--ink-secondary);
  line-height: 1.55;
}

.tribute {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.84rem;
  color: var(--ink-secondary);
  padding: 0.55rem 0.7rem;
  border-radius: var(--radius-sm);
  background: rgba(91, 141, 239, 0.06);
  border: 1px solid var(--border-subtle);
}

.tribute strong {
  color: var(--moon-deep);
  margin: 0 0.15rem;
}

.inf__label {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
  color: var(--ink-muted);
  margin-bottom: 0.3rem;
}
</style>
