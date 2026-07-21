<script setup lang="ts">
import { computed } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { relationEdges } from '@/data/mock'
import { useModal } from '@/composables/useModal'
import { useTianji } from '@/composables/useTianji'
import { useGameState } from '@/composables/useGameState'

const { open } = useModal()
const { injectContext } = useTianji()
const { focusTianji, disciples, masterName } = useGameState()

const discIds = computed(() => new Set(disciples.value.map((d) => d.id)))

/** 仅展示双方仍在册（或涉及掌门）的关系 */
const edges = computed(() => {
  const ids = discIds.value
  const master = masterName.value
  return relationEdges.filter((e) => {
    const fromOk = e.from === '沈青岚' || e.from === master || ids.has(e.from)
    const toOk = e.to === '沈青岚' || e.to === master || ids.has(e.to)
    return fromOk && toOk
  })
})

function nameOf(id: string) {
  if (id === '沈青岚' || id === masterName.value) return masterName.value
  return disciples.value.find((d) => d.id === id)?.name ?? id
}

const typeClass: Record<string, string> = {
  师徒: 'tag-moon',
  道侣: 'tag-violet',
  结义: 'tag-jade',
  仇恨: 'tag-rose',
  竞争: 'tag-amber',
  血缘: 'tag-moon',
}
</script>

<template>
  <div id="view-relations" class="view">
    <div class="section-head">
      <div>
        <h2><span class="ornament" />关系网</h2>
        <p class="section-desc">嫁娶、仇恨、师徒与血缘交织。下一代的命运，往往从一丝情愫或一隙裂痕开始。</p>
      </div>
      <button
        id="btn-relations-tianji"
        class="btn btn-soft"
        type="button"
        @click="injectContext('弟子关系', '情仇与联姻'); focusTianji()"
      >
        <Icon name="scroll" :size="16" /> 注入天机
      </button>
    </div>

    <div class="legend panel-card">
      <span v-for="(cls, type) in typeClass" :key="type" class="tag" :class="cls">{{ type }}</span>
    </div>

    <div class="rel-grid stagger" style="margin-top: 1rem">
      <article
        v-for="r in edges"
        :id="`relation-card-${r.id}`"
        :key="r.id"
        class="panel-card rel-card interactive"
        @click="open('relation-detail', { relationId: r.id })"
      >
        <div class="rel-card__people">
          <span class="person">{{ nameOf(r.from) }}</span>
          <span class="link">
            <span class="tag" :class="typeClass[r.type]">{{ r.type }}</span>
          </span>
          <span class="person">{{ nameOf(r.to) }}</span>
        </div>
        <p>{{ r.note }}</p>
        <div class="intensity">
          <span>羁绊强度</span>
          <div class="progress-track">
            <div
              class="progress-fill"
              :style="{
                width: r.intensity + '%',
                background:
                  r.type === '仇恨'
                    ? 'linear-gradient(90deg, #d08090, #c06b7a)'
                    : r.type === '道侣'
                      ? 'linear-gradient(90deg, #b090c8, #7b6bb0)'
                      : undefined,
              }"
            />
          </div>
          <strong>{{ r.intensity }}</strong>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  padding: 0.75rem 1rem;
}

.rel-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.85rem;
}

.rel-card {
  padding: 1.05rem 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

.rel-card__people {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.person {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 0.98rem;
}

.link {
  flex-shrink: 0;
}

.rel-card p {
  font-size: 0.86rem;
  color: var(--ink-secondary);
  line-height: 1.55;
}

.intensity {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 0.55rem;
  align-items: center;
  font-size: 0.75rem;
  color: var(--ink-muted);
}

.intensity strong {
  font-size: 0.85rem;
  color: var(--ink-primary);
  font-variant-numeric: tabular-nums;
}

@media (max-width: 900px) {
  .rel-grid {
    grid-template-columns: 1fr;
  }
}
</style>
