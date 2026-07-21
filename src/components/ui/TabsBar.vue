<script setup lang="ts">
defineProps<{
  id: string
  tabs: { id: string; label: string; count?: number }[]
  modelValue: string
}>()

const emit = defineEmits<{ 'update:modelValue': [string] }>()
</script>

<template>
  <div :id="id" class="tabs-bar" role="tablist">
    <button
      v-for="tab in tabs"
      :id="`${id}-tab-${tab.id}`"
      :key="tab.id"
      type="button"
      role="tab"
      class="tabs-bar__item"
      :class="{ active: modelValue === tab.id }"
      :aria-selected="modelValue === tab.id"
      @click="emit('update:modelValue', tab.id)"
    >
      <span>{{ tab.label }}</span>
      <span v-if="tab.count !== undefined" class="tabs-bar__count">{{ tab.count }}</span>
    </button>
  </div>
</template>

<style scoped>
.tabs-bar {
  display: flex;
  gap: 0.25rem;
  padding: 0.25rem;
  background: rgba(255, 255, 255, 0.45);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  width: fit-content;
  max-width: 100%;
  overflow-x: auto;
}

.tabs-bar__item {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.9rem;
  border-radius: 8px;
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--ink-muted);
  transition:
    background var(--dur-fast) var(--ease-soft),
    color var(--dur-fast) var(--ease-soft),
    box-shadow var(--dur-fast) var(--ease-soft);
  white-space: nowrap;
}

.tabs-bar__item:hover {
  color: var(--ink-primary);
  background: rgba(255, 255, 255, 0.7);
}

.tabs-bar__item.active {
  color: var(--moon-deep);
  background: #fff;
  box-shadow: var(--shadow-sm);
}

.tabs-bar__count {
  font-size: 0.72rem;
  padding: 0.05rem 0.4rem;
  border-radius: var(--radius-full);
  background: var(--moon-glow);
  color: var(--moon-deep);
}
</style>
