<script setup lang="ts">
import { computed } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { useModal } from '@/composables/useModal'
import { useTianji } from '@/composables/useTianji'
import { useGameState } from '@/composables/useGameState'

const { open } = useModal()
const { injectContext } = useTianji()
const { focusTianji, alchemyRecipes, resources, pillStockTotal } = useGameState()

const herbStock = computed(() => resources.herb)
const recipes = computed(() => alchemyRecipes.value)
</script>

<template>
  <div id="view-alchemy" class="view">
    <div class="section-head">
      <div>
        <h2><span class="ornament" />炼丹房</h2>
        <p class="section-desc">赤铜鼎温火未熄。黄品稳供、玄品慎炼——丹是弟子续命与破境之资。</p>
      </div>
      <button
        id="btn-alchemy-tianji"
        class="btn btn-soft"
        type="button"
        @click="injectContext('炼丹', '丹房库存与配方'); focusTianji()"
      >
        <Icon name="scroll" :size="16" /> 注入天机
      </button>
    </div>

    <div class="furnace panel-card">
      <div class="furnace__visual" aria-hidden="true">
        <div class="flame" />
        <Icon name="alchemy" :size="36" />
      </div>
      <div>
        <h3>赤铜鼎 · 运转中</h3>
        <p class="muted">选择下方丹方可开炉：扣除丹材与灵石，成丹计入库存。</p>
      </div>
      <div class="furnace__stats">
        <div><span>丹材库存</span><strong>{{ herbStock }}</strong></div>
        <div><span>成丹保有</span><strong>{{ pillStockTotal }} 枚</strong></div>
      </div>
    </div>

    <div class="grid-2 stagger" style="margin-top: 1rem">
      <article
        v-for="r in recipes"
        :id="`alchemy-card-${r.id}`"
        :key="r.id"
        class="panel-card recipe interactive"
        @click="open('alchemy-craft', { recipeId: r.id })"
      >
        <header>
          <div>
            <h3>{{ r.name }}</h3>
            <span class="tag tag-moon">{{ r.grade }}</span>
          </div>
          <span class="stock">库存 {{ r.stock }}</span>
        </header>
        <p>{{ r.effect }}</p>
        <footer>
          <span>丹材 {{ r.cost.herb }} · 灵石 {{ r.cost.spiritStone }}</span>
          <span>成功率 {{ r.successRate }}% · {{ r.time }}</span>
        </footer>
        <div class="progress-track">
          <div class="progress-fill" :style="{ width: r.successRate + '%' }" />
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.furnace {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 1.1rem;
  align-items: center;
  padding: 1.15rem 1.25rem;
  background: linear-gradient(135deg, rgba(255, 250, 245, 0.9), rgba(255, 255, 255, 0.75));
}

.furnace__visual {
  width: 72px;
  height: 72px;
  border-radius: 20px;
  display: grid;
  place-items: center;
  position: relative;
  color: var(--amber);
  background: var(--amber-soft);
  border: 1px solid rgba(196, 149, 74, 0.25);
}

.flame {
  position: absolute;
  inset: -4px;
  border-radius: inherit;
  box-shadow: 0 0 20px rgba(196, 149, 74, 0.35);
  animation: pulse-soft 2s ease-in-out infinite;
  pointer-events: none;
}

.furnace h3 {
  font-size: 1.05rem;
  margin-bottom: 0.25rem;
}

.furnace__stats {
  display: flex;
  gap: 1.25rem;
}

.furnace__stats span {
  display: block;
  font-size: 0.72rem;
  color: var(--ink-muted);
}

.furnace__stats strong {
  font-family: var(--font-display);
  font-size: 1.1rem;
}

.recipe {
  padding: 1.05rem 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.recipe header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.recipe h3 {
  font-size: 1rem;
  margin-bottom: 0.35rem;
}

.stock {
  font-size: 0.78rem;
  color: var(--jade);
  font-weight: 600;
}

.recipe p {
  font-size: 0.86rem;
  color: var(--ink-secondary);
  line-height: 1.5;
  flex: 1;
}

.recipe footer {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
  color: var(--ink-muted);
  gap: 0.5rem;
  flex-wrap: wrap;
}

@media (max-width: 900px) {
  .furnace {
    grid-template-columns: 1fr;
  }
}
</style>
