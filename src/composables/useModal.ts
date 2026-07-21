import { ref, shallowRef } from 'vue'

export type ModalId =
  | 'event-detail'
  | 'disciple-detail'
  | 'alchemy-craft'
  | 'forge-detail'
  | 'manual-detail'
  | 'treasure-detail'
  | 'field-assign'
  | 'city-detail'
  | 'faction-talk'
  | 'heir-confirm'
  | 'relation-detail'
  | 'season-advance'
  | 'confirm'

export interface ModalPayload {
  id: ModalId
  props?: Record<string, unknown>
}

const stack = ref<ModalPayload[]>([])
const leaving = shallowRef(false)

export function useModal() {
  const current = () => stack.value[stack.value.length - 1] ?? null

  function open(id: ModalId, props?: Record<string, unknown>) {
    stack.value = [...stack.value, { id, props }]
  }

  function close() {
    if (!stack.value.length) return
    stack.value = stack.value.slice(0, -1)
  }

  function closeAll() {
    stack.value = []
  }

  function replace(id: ModalId, props?: Record<string, unknown>) {
    if (!stack.value.length) {
      open(id, props)
      return
    }
    const next = [...stack.value]
    next[next.length - 1] = { id, props }
    stack.value = next
  }

  return { stack, current, open, close, closeAll, replace, leaving }
}
