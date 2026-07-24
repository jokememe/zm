<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import Icon from './Icon.vue'

const props = withDefaults(
  defineProps<{
    id: string
    title: string
    subtitle?: string
    width?: string
    hideFooter?: boolean
  }>(),
  { width: '560px', hideFooter: false },
)

const emit = defineEmits<{ close: [] }>()

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => {
  document.addEventListener('keydown', onKey)
  document.body.style.overflow = 'hidden'
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
})
</script>

<template>
  <div
    :id="`${id}-backdrop`"
    class="modal-backdrop"
    role="presentation"
    @click.self="emit('close')"
  >
    <div
      :id="id"
      class="modal-panel"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="`${id}-title`"
      :style="{ maxWidth: props.width }"
    >
      <header class="modal-panel__head">
        <div>
          <h2 :id="`${id}-title`">{{ title }}</h2>
          <p v-if="subtitle" class="modal-panel__sub">{{ subtitle }}</p>
        </div>
        <button
          :id="`${id}-close`"
          class="btn btn-icon btn-ghost"
          type="button"
          aria-label="关闭"
          @click="emit('close')"
        >
          <Icon name="close" :size="18" />
        </button>
      </header>
      <div class="modal-panel__body scroll-y">
        <slot />
      </div>
      <footer v-if="!hideFooter" class="modal-panel__foot">
        <slot name="footer">
          <button :id="`${id}-ok`" class="btn btn-primary" type="button" @click="emit('close')">
            知道了
          </button>
        </slot>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  background: rgba(30, 45, 70, 0.28);
  backdrop-filter: blur(6px);
  display: grid;
  place-items: center;
  padding: 1.5rem;
  animation: modal-backdrop var(--dur-mid) var(--ease-out);
  /* 避免背后滚动穿透 */
  overscroll-behavior: contain;
}

.modal-panel {
  width: min(100%, 560px);
  max-height: min(86vh, 820px);
  max-height: min(86dvh, 820px);
  display: flex;
  flex-direction: column;
  background: rgba(252, 253, 255, 0.96);
  border: 1px solid var(--border-medium);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-float);
  animation: modal-panel var(--dur-slow) var(--ease-out);
  overflow: hidden;
}

.modal-panel__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.15rem 1.25rem 0.85rem;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.modal-panel__head h2 {
  font-size: 1.15rem;
}

.modal-panel__sub {
  margin-top: 0.25rem;
  font-size: 0.82rem;
  color: var(--ink-muted);
}

.modal-panel__body {
  padding: 1.15rem 1.25rem;
  flex: 1;
  min-height: 0;
  -webkit-overflow-scrolling: touch;
}

.modal-panel__foot {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0.6rem;
  padding: 0.85rem 1.25rem 1.1rem;
  border-top: 1px solid var(--border-subtle);
  background: rgba(245, 248, 252, 0.65);
  flex-shrink: 0;
}

/* 竖屏 / 窄屏：底部 sheet 式弹窗，拇指可达 */
@media (max-width: 900px), ((orientation: portrait) and (max-width: 1100px)) {
  .modal-backdrop {
    place-items: end center;
    padding: 0;
    align-items: flex-end;
  }

  .modal-panel {
    width: 100%;
    max-width: 100% !important;
    max-height: min(88dvh, 900px);
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
    border-left: none;
    border-right: none;
    border-bottom: none;
    animation: modal-sheet var(--dur-mid) var(--ease-out);
  }

  .modal-panel__head {
    padding: 0.85rem 1rem 0.7rem;
    /* 顶部拖拽暗示 */
    position: relative;
  }

  .modal-panel__head::before {
    content: '';
    position: absolute;
    top: 0.4rem;
    left: 50%;
    transform: translateX(-50%);
    width: 36px;
    height: 4px;
    border-radius: 999px;
    background: rgba(120, 145, 180, 0.35);
  }

  .modal-panel__head h2 {
    font-size: 1.05rem;
    padding-top: 0.35rem;
  }

  .modal-panel__body {
    padding: 0.9rem 1rem;
  }

  .modal-panel__foot {
    padding: 0.75rem 1rem calc(0.85rem + env(safe-area-inset-bottom, 0px));
    gap: 0.5rem;
  }

  .modal-panel__foot .btn {
    min-height: var(--touch-min);
    flex: 1 1 auto;
    justify-content: center;
  }
}

@keyframes modal-sheet {
  from {
    opacity: 0.6;
    transform: translateY(12%);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
