<script setup lang="ts">
import { computed, markRaw, type Component } from 'vue'
import TopBar from '@/components/layout/TopBar.vue'
import SideNav from '@/components/layout/SideNav.vue'
import TianjiPanel from '@/components/layout/TianjiPanel.vue'
import ToastHost from '@/components/ui/ToastHost.vue'
import ModalHost from '@/components/modals/ModalHost.vue'
import OpeningOverlay from '@/components/OpeningOverlay.vue'
import Icon from '@/components/ui/Icon.vue'
import { useGameState } from '@/composables/useGameState'
import type { ViewId } from '@/types/game'
// 同步引入各视图，避免生产分包循环依赖 / 异步样式丢失
import HallView from '@/views/HallView.vue'
import FieldsView from '@/views/FieldsView.vue'
import AlchemyView from '@/views/AlchemyView.vue'
import ForgeView from '@/views/ForgeView.vue'
import LibraryView from '@/views/LibraryView.vue'
import TreasuryView from '@/views/TreasuryView.vue'
import DisciplesView from '@/views/DisciplesView.vue'
import RelationsView from '@/views/RelationsView.vue'
import MemoryGraphView from '@/views/MemoryGraphView.vue'
import LegacyView from '@/views/LegacyView.vue'
import CitiesView from '@/views/CitiesView.vue'
import DiplomacyView from '@/views/DiplomacyView.vue'
import TimelineView from '@/views/TimelineView.vue'
import StoryView from '@/views/StoryView.vue'

const {
  currentView,
  isCompact,
  navDrawerOpen,
  tianjiCollapsed,
  closeNavDrawer,
  toggleTianji,
  focusTianji,
  closeTianjiSheet,
  toggleNav,
} = useGameState()

// markRaw：防止组件被做成响应式导致生产环境渲染失败
const viewMap: Record<ViewId, Component> = {
  hall: markRaw(HallView),
  fields: markRaw(FieldsView),
  alchemy: markRaw(AlchemyView),
  forge: markRaw(ForgeView),
  library: markRaw(LibraryView),
  treasury: markRaw(TreasuryView),
  disciples: markRaw(DisciplesView),
  relations: markRaw(RelationsView),
  'memory-graph': markRaw(MemoryGraphView),
  legacy: markRaw(LegacyView),
  cities: markRaw(CitiesView),
  diplomacy: markRaw(DiplomacyView),
  timeline: markRaw(TimelineView),
  story: markRaw(StoryView),
}

const ActiveView = computed(() => viewMap[currentView.value] ?? viewMap.hall)

const showNavBackdrop = computed(() => isCompact.value && navDrawerOpen.value)
const showTianjiBackdrop = computed(
  () => isCompact.value && !tianjiCollapsed.value,
)

function onNavBackdrop() {
  closeNavDrawer()
}

function onTianjiBackdrop() {
  closeTianjiSheet()
}
</script>

<template>
  <div
    id="app-root"
    class="app-root"
    :class="{ 'is-compact': isCompact, 'nav-open': navDrawerOpen, 'tianji-open': !tianjiCollapsed }"
  >
    <div class="app-atmosphere" aria-hidden="true" />

    <TopBar />

    <div class="app-body">
      <div
        v-if="showNavBackdrop"
        class="drawer-backdrop drawer-backdrop--nav"
        @click="onNavBackdrop"
      />
      <SideNav />

      <main id="main-stage" class="main-stage scroll-y" role="main">
        <div class="main-stage__inner">
          <component :is="ActiveView" :key="currentView" class="view-enter-active" />
        </div>
      </main>

      <div
        v-if="showTianjiBackdrop"
        class="drawer-backdrop drawer-backdrop--tianji"
        @click="onTianjiBackdrop"
      />
      <TianjiPanel />
    </div>

    <!-- 竖屏底栏：导航 + 天机 -->
    <nav v-if="isCompact" class="mobile-dock" aria-label="快捷入口">
      <button
        type="button"
        class="mobile-dock__btn"
        :class="{ 'is-on': navDrawerOpen }"
        @click="toggleNav"
      >
        <Icon name="menu" :size="18" />
        <span>事务</span>
      </button>
      <button
        type="button"
        class="mobile-dock__btn"
        :class="{ 'is-on': !tianjiCollapsed }"
        @click="toggleTianji"
      >
        <Icon name="scroll" :size="18" />
        <span>天机</span>
      </button>
      <button
        type="button"
        class="mobile-dock__btn"
        @click="focusTianji"
      >
        <Icon name="spark" :size="18" />
        <span>问询</span>
      </button>
    </nav>

    <ToastHost />
    <ModalHost />
    <OpeningOverlay />
  </div>
</template>

<style scoped>
.app-root {
  height: 100vh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
}

.app-body {
  flex: 1;
  min-height: 0;
  display: flex;
  position: relative;
  z-index: 1;
}

.main-stage {
  flex: 1;
  min-width: 0;
  position: relative;
  /* iOS 惯性滚动 */
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
}

.main-stage__inner {
  padding: 1.15rem 1.25rem 1.5rem;
  min-height: 100%;
  position: relative;
}

.view-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.85rem;
  min-height: 40vh;
  color: var(--ink-muted);
  font-size: 0.9rem;
}

.view-loading__pulse {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 2px solid var(--border-moon);
  border-top-color: var(--moon);
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.drawer-backdrop {
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-nav) - 1);
  background: rgba(26, 36, 51, 0.35);
  backdrop-filter: blur(2px);
  animation: fade-in 0.2s ease;
  /* 点按抽屉遮罩时避免误触主内容滚动 */
  touch-action: none;
}

.drawer-backdrop--tianji {
  z-index: calc(var(--z-tianji) - 1);
}

@keyframes fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.mobile-dock {
  flex-shrink: 0;
  display: flex;
  align-items: stretch;
  justify-content: space-around;
  gap: 0.15rem;
  /* safe-area 只由底栏承担，不在 app-root 再叠一层 */
  padding: 0.3rem 0.4rem calc(0.3rem + env(safe-area-inset-bottom, 0px));
  min-height: calc(var(--mobile-dock-height) + env(safe-area-inset-bottom, 0px));
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(18px) saturate(1.2);
  -webkit-backdrop-filter: blur(18px) saturate(1.2);
  border-top: 1px solid var(--border-subtle);
  z-index: var(--z-top);
  box-shadow: 0 -4px 20px rgba(40, 60, 100, 0.06);
}

.mobile-dock__btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.12rem;
  min-height: var(--touch-min);
  padding: 0.35rem 0.2rem;
  border-radius: var(--radius-sm);
  color: var(--ink-muted);
  font-size: 0.7rem;
  font-weight: 500;
  letter-spacing: 0.02em;
  transition: background 0.15s, color 0.15s;
  /* 避免双击缩放 */
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}

.mobile-dock__btn.is-on {
  color: var(--moon-deep);
  background: var(--moon-glow);
}

/* 紧凑布局：主区全宽，底栏已占 flex 行，无需再给 app-root 加 safe padding */
.app-root.is-compact .main-stage__inner {
  padding: 0.75rem 0.75rem 1.1rem;
}

/* 极窄：再收一点内边距 */
@media (max-width: 380px) {
  .app-root.is-compact .main-stage__inner {
    padding: 0.65rem 0.6rem 1rem;
  }

  .mobile-dock__btn {
    font-size: 0.65rem;
  }
}
</style>
