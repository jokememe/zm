<script setup lang="ts">
import { computed } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { heirs } from '@/data/mock'
import { useModal } from '@/composables/useModal'
import { useGameState } from '@/composables/useGameState'
import { useTianji } from '@/composables/useTianji'

const { open } = useModal()
const { designatedHeirId, focusTianji, disciples } = useGameState()
const { injectContext } = useTianji()

const visibleHeirs = computed(() => {
  const ids = new Set(disciples.value.map((d) => d.id))
  return heirs.filter((h) => ids.has(h.discipleId))
})

function isDesignated(id: string) {
  return designatedHeirId.value === id
}
</script>

<template>
  <div id="view-legacy" class="view">
    <div class="section-head">
      <div>
        <h2><span class="ornament" />传承继位</h2>
        <p class="section-desc">掌门可传。储君之争关乎人心与外敌观感，宜早布、慎言。</p>
      </div>
      <button
        id="btn-legacy-tianji"
        class="btn btn-soft"
        type="button"
        @click="injectContext('继位', '继承人选与支持度'); focusTianji()"
      >
        <Icon name="scroll" :size="16" /> 注入天机
      </button>
    </div>

    <div class="banner panel-card">
      <Icon name="legacy" :size="22" />
      <div>
        <strong>当前观察储君</strong>
        <p>
          {{ visibleHeirs.find((h) => h.id === designatedHeirId)?.name ?? '未指定' }}
          — 指定后不会立即交权，但会影响弟子站队与外交辞令。
        </p>
      </div>
    </div>

    <div class="grid-2 stagger" style="margin-top: 1rem">
      <article
        v-for="h in visibleHeirs"
        :id="`heir-card-${h.id}`"
        :key="h.id"
        class="panel-card heir"
        :class="{ designated: isDesignated(h.id) }"
      >
        <header>
          <div>
            <h3>{{ h.name }}</h3>
            <span v-if="isDesignated(h.id)" class="tag tag-jade">储君观察</span>
          </div>
          <div class="score">
            <span>综合</span>
            <strong class="stat-value">{{ h.score }}</strong>
          </div>
        </header>

        <div class="support">
          <div class="support__label">
            <span>门内支持度</span>
            <span>{{ h.support }}%</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" :style="{ width: h.support + '%' }" />
          </div>
        </div>

        <div class="cols">
          <div>
            <h4>长处</h4>
            <ul>
              <li v-for="s in h.strengths" :key="s">{{ s }}</li>
            </ul>
          </div>
          <div>
            <h4>隐患</h4>
            <ul>
              <li v-for="r in h.risks" :key="r">{{ r }}</li>
            </ul>
          </div>
        </div>

        <footer>
          <button
            :id="`btn-heir-detail-${h.id}`"
            class="btn btn-ghost btn-sm"
            type="button"
            @click="open('heir-confirm', { heirId: h.id })"
          >
            {{ isDesignated(h.id) ? '重审指定' : '指定为储君' }}
          </button>
          <button
            :id="`btn-heir-tianji-${h.id}`"
            class="btn btn-soft btn-sm"
            type="button"
            @click="injectContext(h.name, `继位候选，评分 ${h.score}`); focusTianji()"
          >
            推演此人
          </button>
        </footer>
      </article>
    </div>
  </div>
</template>

<style scoped>
.banner {
  display: flex;
  gap: 0.85rem;
  align-items: flex-start;
  padding: 1rem 1.15rem;
  color: var(--moon-deep);
  background: linear-gradient(135deg, rgba(91, 141, 239, 0.1), rgba(255, 255, 255, 0.7));
}

.banner strong {
  display: block;
  color: var(--ink-primary);
  margin-bottom: 0.2rem;
}

.banner p {
  font-size: 0.86rem;
  color: var(--ink-secondary);
  line-height: 1.55;
}

.heir {
  padding: 1.15rem;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  transition: box-shadow var(--dur-mid), border-color var(--dur-mid);
}

.heir.designated {
  border-color: var(--border-moon);
  box-shadow: var(--shadow-glow);
}

.heir header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.heir h3 {
  font-size: 1.1rem;
  margin-bottom: 0.35rem;
}

.score {
  text-align: right;
}

.score span {
  display: block;
  font-size: 0.7rem;
  color: var(--ink-muted);
}

.score strong {
  font-size: 1.4rem;
  color: var(--moon-deep);
}

.support__label {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
  color: var(--ink-muted);
  margin-bottom: 0.3rem;
}

.cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.85rem;
}

.cols h4 {
  font-size: 0.8rem;
  color: var(--ink-muted);
  margin-bottom: 0.35rem;
}

.cols li {
  font-size: 0.84rem;
  padding: 0.25rem 0;
  color: var(--ink-secondary);
  border-bottom: 1px dashed var(--border-subtle);
}

.heir footer {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  padding-top: 0.25rem;
}
</style>
