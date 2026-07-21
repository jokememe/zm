<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { useGameState } from '@/composables/useGameState'
import { resourceMeta, resourceDelta, SECT_MOTTO } from '@/data/mock'

const {
  resources,
  calendar,
  sectName,
  masterName,
  unreadCount,
  navCollapsed,
  isCompact,
  navDrawerOpen,
  toggleNav,
  markAllNotificationsRead,
  notifications,
  markNotificationRead,
} = useGameState()

const notifOpen = ref(false)
const panelRef = ref<HTMLElement | null>(null)

function formatNum(n: number) {
  return n.toLocaleString('zh-CN')
}

function onDocClick(e: MouseEvent) {
  if (!panelRef.value) return
  if (!panelRef.value.contains(e.target as Node)) notifOpen.value = false
}

onMounted(() => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))

function toggleNotif(e: MouseEvent) {
  e.stopPropagation()
  notifOpen.value = !notifOpen.value
  if (notifOpen.value) markAllNotificationsRead()
}
</script>

<template>
  <header
    id="top-bar"
    class="top-bar glass-strong"
    :class="{ 'is-compact': isCompact }"
  >
    <div class="top-bar__left">
      <button
        id="btn-toggle-nav"
        class="btn btn-icon btn-ghost"
        type="button"
        :aria-label="
          isCompact
            ? navDrawerOpen
              ? '关闭导航'
              : '打开导航'
            : navCollapsed
              ? '展开导航'
              : '收起导航'
        "
        :aria-expanded="isCompact ? navDrawerOpen : !navCollapsed"
        @click="toggleNav"
      >
        <Icon
          :name="isCompact ? 'menu' : navCollapsed ? 'menu' : 'chevron-left'"
          :size="18"
        />
      </button>

      <div class="brand" id="sect-brand">
        <div class="brand__mark" aria-hidden="true">
          <Icon name="moon" :size="20" />
        </div>
        <div class="brand__text">
          <strong>{{ sectName }}</strong>
          <span v-if="!isCompact">{{ SECT_MOTTO }}</span>
        </div>
      </div>
    </div>

    <div class="top-bar__center" id="resource-bar" role="group" aria-label="宗门资源">
      <div
        v-for="meta in resourceMeta"
        :id="`resource-${meta.key}`"
        :key="meta.key"
        class="res-chip"
        :class="{ 'res-chip--compact': isCompact }"
        :title="meta.label"
      >
        <span class="res-chip__icon"><Icon :name="meta.icon" :size="15" /></span>
        <div class="res-chip__meta">
          <span v-if="!isCompact" class="res-chip__label">{{ meta.label }}</span>
          <span class="res-chip__value stat-value">{{ formatNum(resources[meta.key]) }}</span>
        </div>
        <span
          v-if="resourceDelta[meta.key] && !isCompact"
          class="res-chip__delta"
          :class="(resourceDelta[meta.key] ?? 0) >= 0 ? 'delta-up' : 'delta-down'"
        >
          {{ (resourceDelta[meta.key] ?? 0) > 0 ? '+' : '' }}{{ resourceDelta[meta.key] }}
        </span>
      </div>
    </div>

    <div class="top-bar__right">
      <div id="calendar-chip" class="calendar-chip">
        <Icon name="timeline" :size="15" />
        <span v-if="!isCompact">
          {{ calendar.era }} {{ calendar.year }} · {{ calendar.season }} · {{ calendar.hour }}
        </span>
        <span v-else class="calendar-chip__short">
          {{ calendar.season }} · {{ calendar.hour }}
        </span>
        <span v-if="!isCompact" class="calendar-chip__weather">{{ calendar.weather }}</span>
      </div>

      <div ref="panelRef" class="notif-wrap">
        <button
          id="btn-notifications"
          class="btn btn-icon btn-ghost notif-btn"
          type="button"
          aria-label="通知"
          :aria-expanded="notifOpen"
          @click="toggleNotif"
        >
          <Icon name="bell" :size="18" />
          <span v-if="unreadCount" id="notification-badge" class="notif-badge">{{ unreadCount }}</span>
        </button>

        <Transition name="drop">
          <div
            v-if="notifOpen"
            id="notification-panel"
            class="notif-panel glass-strong"
            role="menu"
          >
            <header>
              <h3>宗门通报</h3>
              <span class="muted">共 {{ notifications.length }} 条</span>
            </header>
            <ul class="scroll-y">
              <li
                v-for="n in notifications"
                :id="`notification-item-${n.id}`"
                :key="n.id"
                :class="{ unread: !n.read }"
                @click="markNotificationRead(n.id)"
              >
                <div class="notif-item__top">
                  <span class="tag tag-moon">{{ n.category }}</span>
                  <time>{{ n.time }}</time>
                </div>
                <strong>{{ n.title }}</strong>
                <p>{{ n.body }}</p>
              </li>
            </ul>
          </div>
        </Transition>
      </div>

      <div id="master-chip" class="master-chip">
        <div class="master-chip__avatar" aria-hidden="true">
          <Icon name="user" :size="16" />
        </div>
        <div>
          <strong>{{ masterName }}</strong>
          <span>掌门</span>
        </div>
      </div>
    </div>
  </header>
</template>

<style scoped>
.top-bar {
  height: var(--topbar-height);
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0 1rem 0 0.75rem;
  border-bottom: 1px solid var(--border-subtle);
  position: relative;
  z-index: var(--z-top);
}

.top-bar__left,
.top-bar__right {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  flex-shrink: 0;
}

.top-bar__center {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  min-width: 0;
  overflow-x: auto;
  mask-image: linear-gradient(90deg, transparent, #000 8px, #000 calc(100% - 8px), transparent);
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}

.brand__mark {
  width: 38px;
  height: 38px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  color: var(--moon-deep);
  background: linear-gradient(145deg, rgba(255, 255, 255, 0.95), rgba(210, 225, 245, 0.7));
  border: 1px solid var(--border-moon);
  box-shadow: 0 2px 10px var(--moon-glow);
}

.brand__text {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}

.brand__text strong {
  font-family: var(--font-display);
  font-size: 1rem;
  letter-spacing: 0.08em;
}

.brand__text span {
  font-size: 0.7rem;
  color: var(--ink-muted);
  letter-spacing: 0.06em;
}

.res-chip {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.55rem;
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid var(--border-subtle);
  transition: border-color var(--dur-fast), box-shadow var(--dur-fast), transform var(--dur-fast);
}

.res-chip:hover {
  border-color: var(--border-moon);
  box-shadow: 0 2px 10px var(--moon-glow);
  transform: translateY(-1px);
}

.res-chip__icon {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  background: var(--moon-glow);
  color: var(--moon-deep);
}

.res-chip__meta {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
}

.res-chip__label {
  font-size: 0.65rem;
  color: var(--ink-muted);
}

.res-chip__value {
  font-size: 0.88rem;
}

.res-chip__delta {
  font-size: 0.68rem;
  font-weight: 600;
  margin-left: 0.1rem;
}

.calendar-chip {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.75rem;
  border-radius: var(--radius-full);
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid var(--border-subtle);
  font-size: 0.78rem;
  color: var(--ink-secondary);
  white-space: nowrap;
}

.calendar-chip__weather {
  color: var(--ink-muted);
  padding-left: 0.4rem;
  border-left: 1px solid var(--border-subtle);
}

.notif-wrap {
  position: relative;
}

.notif-btn {
  position: relative;
}

.notif-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: var(--radius-full);
  background: var(--rose);
  color: #fff;
  font-size: 0.65rem;
  font-weight: 600;
  display: grid;
  place-items: center;
  animation: badge-pop var(--dur-mid) var(--ease-spring);
}

.notif-panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 340px;
  border-radius: var(--radius-md);
  overflow: hidden;
  z-index: var(--z-tooltip);
}

.notif-panel header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.85rem 1rem;
  border-bottom: 1px solid var(--border-subtle);
}

.notif-panel header h3 {
  font-size: 0.95rem;
}

.notif-panel ul {
  max-height: 360px;
}

.notif-panel li {
  padding: 0.85rem 1rem;
  border-bottom: 1px solid var(--border-subtle);
  cursor: pointer;
  transition: background var(--dur-fast);
}

.notif-panel li:hover {
  background: rgba(91, 141, 239, 0.06);
}

.notif-panel li.unread {
  background: rgba(91, 141, 239, 0.05);
}

.notif-item__top {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.3rem;
}

.notif-item__top time {
  font-size: 0.72rem;
  color: var(--ink-faint);
}

.notif-panel strong {
  font-size: 0.88rem;
  display: block;
  margin-bottom: 0.2rem;
}

.notif-panel p {
  font-size: 0.8rem;
  color: var(--ink-secondary);
  line-height: 1.45;
}

.master-chip {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.3rem 0.7rem 0.3rem 0.3rem;
  border-radius: var(--radius-full);
  background: rgba(255, 255, 255, 0.65);
  border: 1px solid var(--border-subtle);
}

.master-chip__avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: linear-gradient(145deg, #d4e2f7, #b8cceb);
  color: var(--moon-deep);
  border: 1px solid var(--border-moon);
}

.master-chip strong {
  display: block;
  font-size: 0.85rem;
  line-height: 1.2;
}

.master-chip span {
  font-size: 0.68rem;
  color: var(--ink-muted);
}

.drop-enter-active,
.drop-leave-active {
  transition: opacity var(--dur-mid) var(--ease-out), transform var(--dur-mid) var(--ease-out);
}

.drop-enter-from,
.drop-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

/* 竖屏 / 窄屏顶栏 */
.top-bar.is-compact {
  height: auto;
  min-height: var(--topbar-height);
  flex-wrap: wrap;
  row-gap: 0.35rem;
  padding: 0.45rem 0.65rem;
  padding-top: calc(0.45rem + env(safe-area-inset-top, 0));
}

.top-bar.is-compact .top-bar__center {
  order: 3;
  flex: 1 1 100%;
  justify-content: flex-start;
  gap: 0.35rem;
  padding-bottom: 0.15rem;
  mask-image: linear-gradient(90deg, #000 0%, #000 calc(100% - 24px), transparent);
}

.top-bar.is-compact .res-chip {
  padding: 0.28rem 0.45rem;
  gap: 0.3rem;
}

.top-bar.is-compact .res-chip__value {
  font-size: 0.82rem;
}

.top-bar.is-compact .calendar-chip {
  max-width: 42vw;
}

.top-bar.is-compact .calendar-chip__short {
  font-size: 0.78rem;
  white-space: nowrap;
}

.top-bar.is-compact .master-chip span {
  display: none;
}

.top-bar.is-compact .brand__text strong {
  font-size: 0.92rem;
}
</style>
