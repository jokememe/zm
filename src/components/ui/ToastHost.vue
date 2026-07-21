<script setup lang="ts">
import { useToast } from '@/composables/useToast'
import Icon from './Icon.vue'

const { toasts, dismiss } = useToast()

const iconMap = {
  success: 'check',
  info: 'info',
  warn: 'warn',
  error: 'error',
} as const
</script>

<template>
  <div id="toast-host" class="toast-host" role="region" aria-label="通知提示" aria-live="polite">
    <TransitionGroup name="toast">
      <article
        v-for="t in toasts"
        :id="t.id"
        :key="t.id"
        class="toast"
        :class="`toast--${t.type}`"
        role="status"
      >
        <div class="toast__icon">
          <Icon :name="iconMap[t.type]" :size="18" />
        </div>
        <div class="toast__body">
          <h4>{{ t.title }}</h4>
          <p v-if="t.message">{{ t.message }}</p>
        </div>
        <button
          :id="`${t.id}-close`"
          class="toast__close"
          type="button"
          aria-label="关闭提示"
          @click="dismiss(t.id)"
        >
          <Icon name="close" :size="14" />
        </button>
      </article>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  top: calc(var(--topbar-height) + 12px);
  right: 20px;
  z-index: var(--z-toast);
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  width: min(360px, calc(100vw - 32px));
  pointer-events: none;
}

.toast {
  pointer-events: auto;
  display: flex;
  align-items: flex-start;
  gap: 0.7rem;
  padding: 0.85rem 0.95rem;
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(16px);
  border: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-lg);
  animation: toast-in var(--dur-mid) var(--ease-out);
}

.toast__icon {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.toast--success .toast__icon {
  background: var(--jade-soft);
  color: var(--jade);
}

.toast--info .toast__icon {
  background: var(--moon-glow);
  color: var(--moon-deep);
}

.toast--warn .toast__icon {
  background: var(--amber-soft);
  color: var(--amber);
}

.toast--error .toast__icon {
  background: var(--rose-soft);
  color: var(--rose);
}

.toast__body {
  flex: 1;
  min-width: 0;
}

.toast__body h4 {
  font-family: var(--font-body);
  font-size: 0.9rem;
  font-weight: 600;
  margin-bottom: 0.15rem;
}

.toast__body p {
  font-size: 0.8rem;
  color: var(--ink-secondary);
  line-height: 1.45;
}

.toast__close {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  color: var(--ink-muted);
  transition: background var(--dur-fast), color var(--dur-fast);
}

.toast__close:hover {
  background: rgba(0, 0, 0, 0.05);
  color: var(--ink-primary);
}

.toast-enter-active {
  animation: toast-in var(--dur-mid) var(--ease-out);
}

.toast-leave-active {
  animation: toast-out var(--dur-mid) var(--ease-out) forwards;
}

.toast-move {
  transition: transform var(--dur-mid) var(--ease-out);
}
</style>
