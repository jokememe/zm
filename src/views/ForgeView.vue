<script setup lang="ts">
import Icon from '@/components/ui/Icon.vue'
import { forgeQueue } from '@/data/mock'
import { useModal } from '@/composables/useModal'
import { useTianji } from '@/composables/useTianji'
import { useGameState } from '@/composables/useGameState'

const { open } = useModal()
const { injectContext } = useTianji()
const { focusTianji } = useGameState()
</script>

<template>
  <div id="view-forge" class="view">
    <div class="section-head">
      <div>
        <h2><span class="ornament" />锻器坊</h2>
        <p class="section-desc">韩铁山独撑炉火。飞剑重修过半，掌门令残片尚待秘银。</p>
      </div>
      <button
        id="btn-forge-tianji"
        class="btn btn-soft"
        type="button"
        @click="injectContext('锻器', '队列与材料'); focusTianji()"
      >
        <Icon name="scroll" :size="16" /> 注入天机
      </button>
    </div>

    <div class="grid-2 stagger">
      <article
        v-for="g in forgeQueue"
        :id="`forge-card-${g.id}`"
        :key="g.id"
        class="panel-card forge-card interactive"
        @click="open('forge-detail', { forgeId: g.id })"
      >
        <header>
          <div class="type-icon"><Icon name="forge" :size="18" /></div>
          <div class="meta">
            <h3>{{ g.name }}</h3>
            <div class="tags">
              <span class="tag">{{ g.type }}</span>
              <span class="tag tag-amber">{{ g.grade }}</span>
            </div>
          </div>
        </header>
        <dl>
          <div><dt>匠人</dt><dd>{{ g.craftsman ?? '待指派' }}</dd></div>
          <div><dt>材料</dt><dd>{{ g.materials }}</dd></div>
          <div><dt>特性</dt><dd>{{ g.power }}</dd></div>
        </dl>
        <div class="prog">
          <div class="prog__label">
            <span>锻造进度</span>
            <span>{{ g.progress }}%</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" :style="{ width: g.progress + '%' }" />
          </div>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.forge-card {
  padding: 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.forge-card header {
  display: flex;
  gap: 0.75rem;
}

.type-icon {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: linear-gradient(145deg, rgba(196, 149, 74, 0.18), rgba(255, 255, 255, 0.6));
  color: var(--amber);
  border: 1px solid rgba(196, 149, 74, 0.22);
}

.meta h3 {
  font-size: 1rem;
  margin-bottom: 0.35rem;
}

.tags {
  display: flex;
  gap: 0.35rem;
}

.forge-card dl {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.forge-card dt {
  font-size: 0.7rem;
  color: var(--ink-muted);
}

.forge-card dd {
  font-size: 0.88rem;
}

.prog__label {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
  color: var(--ink-muted);
  margin-bottom: 0.3rem;
}
</style>
