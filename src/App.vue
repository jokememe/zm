<script setup lang="ts">
import { computed, markRaw, onBeforeUnmount, onErrorCaptured, onMounted, ref, type Component } from 'vue'
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

// —— 全局错误兜底：LLM 请求/异步任务失败不让整个应用白屏 ——
const appError = ref<string | null>(null)

function captureError(err: unknown, where = '应用') {
  const msg = err instanceof Error ? err.message : String(err ?? '未知错误')
  // 网络类错误太常见，合并为同一文案，避免刷屏
  if (/failed to fetch|networkerror|abort/i.test(msg)) {
    appError.value = `${where}：网络请求失败（Failed to fetch）。检查 API 端点/CORS，或按 F12 看控制台。`
  } else {
    appError.value = `${where}出错：${msg.slice(0, 160)}`
  }
}

function onWindowError(e: ErrorEvent) {
  captureError(e.error || e.message, '页面')
}

function onUnhandledRejection(e: PromiseRejectionEvent) {
  captureError(e.reason, '异步任务')
}

onErrorCaptured((err, _instance, info) => {
  captureError(err, info || '组件')
  return false // 吞掉，由兜底条提示，不触发全局崩溃
})

onMounted(() => {
  window.addEventListener('error', onWindowError)
  window.addEventListener('unhandledrejection', onUnhandledRejection)
})

onBeforeUnmount(() => {
  window.removeEventListener('error', onWindowError)
  window.removeEventListener('unhandledrejection', onUnhandledRejection)
})

function dismissAppError() {
  appError.value = null
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
          <div v-if="appError" class="app-error-bar" role="alert">
            <span>{{ appError }}</span>
            <button type="button" class="app-error-bar__close" aria-label="关闭" @click="dismissAppError">
              ×
            </button>
          </div>
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

/* 全局错误兜底条 */
.app-error-bar {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  justify-content: space-between;
  margin-bottom: 1rem;
  padding: 0.6rem 0.8rem;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--danger, #c25a5a) 10%, var(--bg-elevated));
  border: 1px solid color-mix(in srgb, var(--danger, #c25a5a) 35%, transparent);
  color: var(--ink-secondary);
  font-size: 0.84rem;
  line-height: 1.5;
  animation: slide-in-down var(--dur-mid) var(--ease-out) both;
}

.app-error-bar__close {
  flex: 0 0 auto;
  border: none;
  background: none;
  color: var(--ink-muted);
  font-size: 1.05rem;
  line-height: 1;
  cursor: pointer;
  padding: 0.1rem 0.3rem;
  border-radius: var(--radius-full);
  transition: color var(--dur-fast) var(--ease-soft);
}

.app-error-bar__close:hover {
  color: var(--danger, #c25a5a);
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
