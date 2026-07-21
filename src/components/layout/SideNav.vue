<script setup lang="ts">
import { computed } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { navItems } from '@/data/mock'
import { useGameState } from '@/composables/useGameState'
import type { ViewId } from '@/types/game'

const { currentView, navCollapsed, isCompact, navDrawerOpen, setView } = useGameState()

const groups = computed(() => {
  const map = new Map<string, typeof navItems>()
  for (const item of navItems) {
    if (!map.has(item.group)) map.set(item.group, [])
    map.get(item.group)!.push(item)
  }
  return [...map.entries()]
})

/** 紧凑模式抽屉内始终展示文字 */
const showLabels = computed(() => isCompact.value || !navCollapsed.value)

function go(id: ViewId) {
  setView(id)
}
</script>

<template>
  <nav
    id="side-nav"
    class="side-nav glass-strong"
    :class="{
      collapsed: navCollapsed && !isCompact,
      'is-compact': isCompact,
      'is-drawer-open': isCompact && navDrawerOpen,
    }"
    aria-label="宗门事务导航"
  >
    <header v-if="isCompact" class="side-nav__drawer-head">
      <strong>宗门事务</strong>
      <span class="muted">点选前往</span>
    </header>
    <div class="side-nav__inner scroll-y">
      <section v-for="[group, items] in groups" :key="group" class="nav-group">
        <h2 v-show="showLabels" class="nav-group__title">{{ group }}</h2>
        <ul>
          <li v-for="item in items" :key="item.id">
            <button
              :id="`nav-${item.id}`"
              type="button"
              class="nav-item"
              :class="{ active: currentView === item.id }"
              :title="item.label"
              :aria-current="currentView === item.id ? 'page' : undefined"
              @click="go(item.id)"
            >
              <span class="nav-item__icon">
                <Icon :name="item.icon" :size="18" />
              </span>
              <span v-show="showLabels" class="nav-item__label">{{ item.label }}</span>
              <span
                v-if="item.badge && showLabels"
                class="nav-item__badge"
              >{{ item.badge }}</span>
              <span
                v-else-if="item.badge && !showLabels"
                class="nav-item__dot"
                aria-hidden="true"
              />
            </button>
          </li>
        </ul>
      </section>
    </div>

    <footer v-show="showLabels" class="side-nav__foot">
      <div class="foot-card">
        <Icon name="spark" :size="16" />
        <div>
          <strong>天机可问</strong>
          <p>{{ isCompact ? '底栏打开天机卷轴' : '点选事务后注入右侧卷轴' }}</p>
        </div>
      </div>
    </footer>
  </nav>
</template>

<style scoped>
.side-nav {
  width: var(--nav-width);
  height: 100%;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border-subtle);
  transition:
    width var(--dur-mid) var(--ease-out),
    transform var(--dur-mid) var(--ease-out);
  z-index: var(--z-nav);
  overflow: hidden;
}

.side-nav.collapsed {
  width: var(--nav-collapsed);
}

.side-nav__drawer-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 0.9rem 1rem 0.5rem;
  border-bottom: 1px solid var(--border-subtle);
}

.side-nav__drawer-head strong {
  font-family: var(--font-display);
  font-size: 1.05rem;
}

.side-nav__drawer-head .muted {
  font-size: 0.75rem;
  color: var(--ink-muted);
}

/* 竖屏 / 窄屏：左侧抽屉 */
.side-nav.is-compact {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  width: min(82vw, 300px);
  height: auto;
  padding-top: env(safe-area-inset-top, 0);
  padding-bottom: env(safe-area-inset-bottom, 0);
  transform: translateX(-105%);
  border-right: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-lg);
  z-index: calc(var(--z-nav) + 5);
}

.side-nav.is-compact.is-drawer-open {
  transform: translateX(0);
}

.side-nav__inner {
  flex: 1;
  padding: 0.85rem 0.65rem;
}

.nav-group + .nav-group {
  margin-top: 1rem;
}

.nav-group__title {
  font-family: var(--font-body);
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  color: var(--ink-faint);
  padding: 0 0.55rem 0.45rem;
  text-transform: none;
}

.nav-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.55rem 0.6rem;
  border-radius: var(--radius-sm);
  color: var(--ink-secondary);
  position: relative;
  transition:
    background var(--dur-fast) var(--ease-soft),
    color var(--dur-fast) var(--ease-soft),
    box-shadow var(--dur-fast) var(--ease-soft),
    transform var(--dur-fast) var(--ease-out);
}

.nav-item:hover {
  background: rgba(255, 255, 255, 0.7);
  color: var(--ink-primary);
}

.nav-item.active {
  background: linear-gradient(135deg, rgba(91, 141, 239, 0.16), rgba(91, 141, 239, 0.06));
  color: var(--moon-deep);
  box-shadow: inset 0 0 0 1px var(--border-moon);
}

.nav-item.active .nav-item__icon {
  background: var(--moon-glow);
  color: var(--moon-deep);
}

.nav-item__icon {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  background: rgba(255, 255, 255, 0.55);
  flex-shrink: 0;
  transition: background var(--dur-fast), color var(--dur-fast);
}

.nav-item__label {
  flex: 1;
  text-align: left;
  font-size: 0.88rem;
  font-weight: 500;
  white-space: nowrap;
}

.nav-item__badge {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: var(--radius-full);
  background: var(--rose);
  color: #fff;
  font-size: 0.68rem;
  font-weight: 600;
  display: grid;
  place-items: center;
}

.nav-item__dot {
  position: absolute;
  top: 8px;
  right: 10px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--rose);
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.8);
}

.side-nav.collapsed .nav-item {
  justify-content: center;
  padding: 0.55rem;
}

.side-nav.collapsed .nav-item__icon {
  margin: 0;
}

.side-nav__foot {
  padding: 0.75rem;
  border-top: 1px solid var(--border-subtle);
}

.foot-card {
  display: flex;
  gap: 0.6rem;
  padding: 0.75rem;
  border-radius: var(--radius-sm);
  background: linear-gradient(145deg, rgba(91, 141, 239, 0.1), rgba(255, 255, 255, 0.5));
  border: 1px solid var(--border-subtle);
  color: var(--moon-deep);
}

.foot-card strong {
  display: block;
  font-size: 0.8rem;
  margin-bottom: 0.15rem;
  color: var(--ink-primary);
}

.foot-card p {
  font-size: 0.72rem;
  color: var(--ink-muted);
  line-height: 1.35;
}
</style>
