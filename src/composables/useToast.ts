import { ref } from 'vue'
import type { ToastItem } from '@/types/game'

const toasts = ref<ToastItem[]>([])
let seq = 0

export function useToast() {
  function push( partial: Omit<ToastItem, 'id'> ) {
    const id = `toast-${++seq}-${Date.now()}`
    const item: ToastItem = {
      id,
      duration: partial.duration ?? 3600,
      ...partial,
    }
    toasts.value = [item, ...toasts.value].slice(0, 5)
    if (item.duration && item.duration > 0) {
      window.setTimeout(() => dismiss(id), item.duration)
    }
    return id
  }

  function dismiss(id: string) {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  function success(title: string, message?: string) {
    return push({ type: 'success', title, message })
  }

  function info(title: string, message?: string) {
    return push({ type: 'info', title, message })
  }

  function warn(title: string, message?: string) {
    return push({ type: 'warn', title, message })
  }

  function error(title: string, message?: string) {
    return push({ type: 'error', title, message })
  }

  return { toasts, push, dismiss, success, info, warn, error }
}
