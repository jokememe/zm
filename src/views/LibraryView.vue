<script setup lang="ts">
import { ref, computed } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import TabsBar from '@/components/ui/TabsBar.vue'
import { useModal } from '@/composables/useModal'
import { useTianji } from '@/composables/useTianji'
import { useGameState } from '@/composables/useGameState'

const tab = ref('all')
const { open } = useModal()
const { injectContext } = useTianji()
const { focusTianji, manuals } = useGameState()

const tabs = computed(() => [
  { id: 'all', label: '全部', count: manuals.value.length },
  { id: 'open', label: '可阅', count: manuals.value.filter((m) => !m.sealed).length },
  { id: 'sealed', label: '封印', count: manuals.value.filter((m) => m.sealed).length },
])

const list = computed(() => {
  if (tab.value === 'open') return manuals.value.filter((m) => !m.sealed)
  if (tab.value === 'sealed') return manuals.value.filter((m) => m.sealed)
  return manuals.value
})
</script>

<template>
  <div id="view-library" class="view">
    <div class="section-head">
      <div>
        <h2><span class="ornament" />藏经阁</h2>
        <p class="section-desc">残卷与心法并陈。封印之书需气运与机缘，切勿妄启。正文新获秘籍会入册。</p>
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

    <div v-if="!list.length" class="empty muted" style="margin-top: 1rem">
      阁中暂无秘籍。
    </div>
    <div v-else class="grid-3 stagger" style="margin-top: 1rem">
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

.manual.sealed {
  opacity: 0.88;
}

.manual__spine {
  width: 12px;
  flex-shrink: 0;
  background: linear-gradient(180deg, rgba(91, 141, 239, 0.45), rgba(91, 141, 239, 0.12));
}

.manual.sealed .manual__spine {
  background: linear-gradient(180deg, rgba(120, 90, 160, 0.5), rgba(120, 90, 160, 0.15));
}

.manual__body {
  flex: 1;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  min-width: 0;
}

.manual__body header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
}

.manual__body h3 {
  font-size: 1rem;
}

.school {
  font-size: 0.78rem;
  color: var(--ink-muted);
}

.insight {
  font-size: 0.86rem;
  color: var(--ink-secondary);
  flex: 1;
  line-height: 1.45;
}

.manual__body footer {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.75rem;
  color: var(--ink-faint);
}
</style>
