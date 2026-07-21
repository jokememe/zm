<script setup lang="ts">
import { ref, computed } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import TabsBar from '@/components/ui/TabsBar.vue'
import { manuals } from '@/data/mock'
import { useModal } from '@/composables/useModal'
import { useTianji } from '@/composables/useTianji'
import { useGameState } from '@/composables/useGameState'

const tab = ref('all')
const { open } = useModal()
const { injectContext } = useTianji()
const { focusTianji } = useGameState()

const tabs = [
  { id: 'all', label: '全部', count: manuals.length },
  { id: 'open', label: '可阅', count: manuals.filter((m) => !m.sealed).length },
  { id: 'sealed', label: '封印', count: manuals.filter((m) => m.sealed).length },
]

const list = computed(() => {
  if (tab.value === 'open') return manuals.filter((m) => !m.sealed)
  if (tab.value === 'sealed') return manuals.filter((m) => m.sealed)
  return manuals
})
</script>

<template>
  <div id="view-library" class="view">
    <div class="section-head">
      <div>
        <h2><span class="ornament" />藏经阁</h2>
        <p class="section-desc">残卷与心法并陈。封印之书需气运与机缘，切勿妄启。</p>
      </div>
      <button
        id="btn-library-tianji"
        class="btn btn-soft"
        type="button"
        @click="injectContext('藏经阁', '秘籍与封印'); focusTianji()"
      >
        <Icon name="scroll" :size="16" /> 注入天机
      </button>
    </div>

    <TabsBar id="library-tabs" v-model="tab" :tabs="tabs" />

    <div class="grid-3 stagger" style="margin-top: 1rem">
      <article
        v-for="m in list"
        :id="`manual-card-${m.id}`"
        :key="m.id"
        class="panel-card manual interactive"
        :class="{ sealed: m.sealed }"
        @click="open('manual-detail', { manualId: m.id })"
      >
        <div class="manual__spine" aria-hidden="true" />
        <div class="manual__body">
          <header>
            <h3>{{ m.name }}</h3>
            <span class="tag" :class="m.sealed ? 'tag-violet' : 'tag-moon'">{{ m.grade }}</span>
          </header>
          <p class="school">{{ m.school }}</p>
          <p class="insight">{{ m.insight }}</p>
          <footer>
            <span>{{ m.restriction }}</span>
            <span>{{ m.readers }} 人在研</span>
          </footer>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.manual {
  display: flex;
  overflow: hidden;
  min-height: 150px;
  padding: 0;
}

.manual__spine {
  width: 8px;
  background: linear-gradient(180deg, var(--moon), var(--moon-soft));
  flex-shrink: 0;
}

.manual.sealed .manual__spine {
  background: linear-gradient(180deg, var(--violet), #a090c8);
}

.manual__body {
  flex: 1;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.manual header {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  align-items: flex-start;
}

.manual h3 {
  font-size: 0.98rem;
}

.school {
  font-size: 0.78rem;
  color: var(--moon-deep);
}

.insight {
  font-size: 0.85rem;
  color: var(--ink-secondary);
  flex: 1;
  line-height: 1.5;
}

.manual footer {
  display: flex;
  justify-content: space-between;
  font-size: 0.72rem;
  color: var(--ink-muted);
  gap: 0.5rem;
}

.manual.sealed {
  background: linear-gradient(145deg, rgba(123, 107, 176, 0.06), rgba(255, 255, 255, 0.7));
}
</style>
