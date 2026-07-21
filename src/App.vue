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
  padding-bottom: env(safe-area-inset-bottom, 0);
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
  gap: 0.25rem;
  padding: 0.35rem 0.5rem calc(0.35rem + env(safe-area-inset-bottom, 0));
  background: rgba(255, 255, 255, 0.88);
  backdrop-filter: blur(16px) saturate(1.15);
  border-top: 1px solid var(--border-subtle);
  z-index: var(--z-top);
}

.mobile-dock__btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.15rem;
  padding: 0.4rem 0.25rem;
  border-radius: var(--radius-sm);
  color: var(--ink-muted);
  font-size: 0.68rem;
  font-weight: 500;
  transition: background 0.15s, color 0.15s;
}

.mobile-dock__btn.is-on {
  color: var(--moon-deep);
  background: var(--moon-glow);
}

/* 紧凑布局：主区全宽，给底栏留空 */
.app-root.is-compact .main-stage__inner {
  padding: 0.85rem 0.85rem 1rem;
}

.app-root.is-compact .app-body {
  /* 底栏约 56px */
}
</style>
