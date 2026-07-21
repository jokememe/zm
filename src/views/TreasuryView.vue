<script setup lang="ts">
import Icon from '@/components/ui/Icon.vue'
import { treasures } from '@/data/mock'
import { useModal } from '@/composables/useModal'
import { useTianji } from '@/composables/useTianji'
import { useGameState } from '@/composables/useGameState'

const { open } = useModal()
const { injectContext } = useTianji()
const { focusTianji } = useGameState()
</script>

<template>
  <div id="view-treasury" class="view">
    <div class="section-head">
      <div>
        <h2><span class="ornament" />宝库</h2>
        <p class="section-desc">法宝、信物与残阵盘。绑定之物不可轻授，库藏可择缘分转交。</p>
      </div>
      <button
        id="btn-treasury-tianji"
        class="btn btn-soft"
        type="button"
        @click="injectContext('宝库', '法宝与重器'); focusTianji()"
      >
        <Icon name="scroll" :size="16" /> 注入天机
      </button>
    </div>

    <div class="grid-3 stagger">
      <article
        v-for="t in treasures"
        :id="`treasure-card-${t.id}`"
        :key="t.id"
        class="panel-card treasure interactive"
        @click="open('treasure-detail', { treasureId: t.id })"
      >
        <div class="treasure__icon">
          <Icon name="treasury" :size="22" />
        </div>
        <h3>{{ t.name }}</h3>
        <div class="tags">
          <span class="tag">{{ t.type }}</span>
          <span class="tag tag-amber">{{ t.grade }}</span>
          <span v-if="t.bound" class="tag tag-rose">绑定</span>
        </div>
        <p>{{ t.desc }}</p>
        <footer>
          <span>{{ t.owner ?? '库藏未授' }}</span>
          <Icon name="chevron-right" :size="14" />
        </footer>
      </article>
    </div>
  </div>
</template>

<style scoped>
.treasure {
  padding: 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.treasure__icon {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  color: var(--amber);
  background: linear-gradient(145deg, rgba(196, 149, 74, 0.15), rgba(255, 255, 255, 0.7));
  border: 1px solid rgba(196, 149, 74, 0.2);
  margin-bottom: 0.2rem;
}

.treasure h3 {
  font-size: 1.02rem;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.treasure p {
  font-size: 0.84rem;
  color: var(--ink-secondary);
  line-height: 1.55;
  flex: 1;
}

.treasure footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.78rem;
  color: var(--ink-muted);
  padding-top: 0.35rem;
  border-top: 1px solid var(--border-subtle);
}
</style>
