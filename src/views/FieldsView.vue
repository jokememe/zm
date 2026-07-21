<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import TabsBar from '@/components/ui/TabsBar.vue'
import { fieldPlots } from '@/data/mock'
import { useModal } from '@/composables/useModal'
import { useTianji } from '@/composables/useTianji'
import { useGameState } from '@/composables/useGameState'

const tab = ref('all')
const { open } = useModal()
const { injectContext } = useTianji()
const { focusTianji } = useGameState()

const tabs = [
  { id: 'all', label: '全部', count: fieldPlots.length },
  { id: 'growing', label: '生长中', count: fieldPlots.filter((f) => f.status === 'growing').length },
  { id: 'harvest', label: '可收', count: fieldPlots.filter((f) => f.status === 'harvest').length },
  { id: 'idle', label: '闲置/荒', count: fieldPlots.filter((f) => f.status === 'idle' || f.status === 'barren').length },
]

const filtered = computed(() => {
  if (tab.value === 'all') return fieldPlots
  if (tab.value === 'idle') return fieldPlots.filter((f) => f.status === 'idle' || f.status === 'barren')
  return fieldPlots.filter((f) => f.status === tab.value)
})

const statusLabel: Record<string, string> = {
  growing: '生长中',
  harvest: '可收获',
  idle: '待播种',
  barren: '荒芜',
}

const statusTag: Record<string, string> = {
  growing: 'tag-moon',
  harvest: 'tag-jade',
  idle: 'tag-amber',
  barren: 'tag-rose',
}
</script>

<template>
  <div id="view-fields" class="view">
    <div class="section-head">
      <div>
        <h2><span class="ornament" />灵田</h2>
        <p class="section-desc">东坡灵谷将熟，北崖仍荒。指派弟子、调节灵润，是宗门粮本。</p>
      </div>
      <div class="head-actions">
        <button
          id="btn-fields-tianji"
          class="btn btn-soft"
          type="button"
          @click="injectContext('灵田', '东坡将熟，北崖荒芜'); focusTianji()"
        >
          <Icon name="scroll" :size="16" /> 注入天机
        </button>
      </div>
    </div>

    <TabsBar id="fields-tabs" v-model="tab" :tabs="tabs" />

    <div class="summary-row">
      <div class="panel-card mini">
        <span class="muted">预计本季灵谷</span>
        <strong class="stat-value">810</strong>
      </div>
      <div class="panel-card mini">
        <span class="muted">药圃产出</span>
        <strong class="stat-value">丹材 +48</strong>
      </div>
      <div class="panel-card mini">
        <span class="muted">护田压力</span>
        <strong class="stat-value" style="color: var(--amber)">中</strong>
      </div>
    </div>

    <div class="grid-3 stagger" style="margin-top: 1rem">
      <article
        v-for="f in filtered"
        :id="`field-card-${f.id}`"
        :key="f.id"
        class="panel-card field-card interactive"
        @click="open('field-assign', { fieldId: f.id })"
      >
        <header>
          <div>
            <h3>{{ f.name }}</h3>
            <span class="tag" :class="statusTag[f.status]">{{ statusLabel[f.status] }}</span>
          </div>
          <span class="grade">{{ f.grade }}</span>
        </header>
        <dl>
          <div><dt>作物</dt><dd>{{ f.crop }}</dd></div>
          <div><dt>季产</dt><dd>{{ f.yieldPerSeason || '—' }}</dd></div>
          <div><dt>管事</dt><dd>{{ f.assigned ?? '无人' }}</dd></div>
          <div><dt>余日</dt><dd>{{ f.seasonLeft ? f.seasonLeft + ' 日' : '—' }}</dd></div>
        </dl>
        <div class="moist">
          <div class="moist__label">
            <span>灵润</span>
            <span>{{ f.moisture }}%</span>
          </div>
          <div class="progress-track">
            <div
              class="progress-fill"
              :style="{
                width: f.moisture + '%',
                background:
                  f.moisture < 30
                    ? 'linear-gradient(90deg, #c06b7a, #d08090)'
                    : undefined,
              }"
            />
          </div>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.head-actions {
  display: flex;
  gap: 0.5rem;
}

.summary-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.75rem;
  margin-top: 1rem;
}

.mini {
  padding: 0.85rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.mini strong {
  font-size: 1.15rem;
}

.field-card {
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.field-card header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.5rem;
}

.field-card h3 {
  font-size: 1rem;
  margin-bottom: 0.35rem;
}

.grade {
  font-size: 0.75rem;
  color: var(--moon-deep);
  font-weight: 600;
  padding: 0.2rem 0.5rem;
  border-radius: var(--radius-full);
  background: var(--moon-glow);
}

.field-card dl {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.45rem 0.75rem;
}

.field-card dt {
  font-size: 0.7rem;
  color: var(--ink-muted);
}

.field-card dd {
  font-size: 0.88rem;
  font-weight: 500;
}

.moist__label {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
  color: var(--ink-muted);
  margin-bottom: 0.3rem;
}

@media (max-width: 900px) {
  .summary-row {
    grid-template-columns: 1fr;
  }
}
</style>
