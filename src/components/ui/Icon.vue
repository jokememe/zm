<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    name: string
    size?: number | string
    stroke?: number
  }>(),
  { size: 20, stroke: 1.6 },
)

const box = computed(() => (typeof props.size === 'number' ? `${props.size}` : props.size))
</script>

<template>
  <svg
    class="icon"
    :width="box"
    :height="box"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <!-- 通用 -->
    <g v-if="name === 'hall'" :stroke-width="stroke" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V10.5z" />
      <path d="M9 21V12h6v9" />
    </g>
    <g v-else-if="name === 'fields'" :stroke-width="stroke" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 18h18" />
      <path d="M5 18c1-4 3-7 7-9" />
      <path d="M12 9c2 1 4 3 5 9" />
      <path d="M9 14c1.5-1 3-1.2 4.5 0" />
      <circle cx="12" cy="7" r="1.2" fill="currentColor" stroke="none" />
    </g>
    <g v-else-if="name === 'alchemy'" :stroke-width="stroke" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <path d="M8 3h8" />
      <path d="M10 3v3.5L6.5 18a3 3 0 0 0 2.8 4h5.4a3 3 0 0 0 2.8-4L14 6.5V3" />
      <path d="M8.5 14h7" />
    </g>
    <g v-else-if="name === 'forge'" :stroke-width="stroke" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 4l6 6-8 8H6v-6l8-8z" />
      <path d="M12 6l6 6" />
      <path d="M4 20l4-1" />
    </g>
    <g v-else-if="name === 'library'" :stroke-width="stroke" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <path d="M5 5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v14a1 1 0 0 1-1.4.9L12 16.5l-4.6 3.4A1 1 0 0 1 6 19V5z" />
      <path d="M9 8h5" />
      <path d="M9 11h3" />
    </g>
    <g v-else-if="name === 'treasury'" :stroke-width="stroke" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <rect x="4" y="8" width="16" height="12" rx="2" />
      <path d="M8 8V7a4 4 0 0 1 8 0v1" />
      <circle cx="12" cy="14" r="1.5" />
    </g>
    <g v-else-if="name === 'disciples'" :stroke-width="stroke" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.2" />
      <path d="M3.5 19c.8-3.2 2.8-5 5.5-5s4.7 1.8 5.5 5" />
      <path d="M14 14.5c1.6-.5 3.3-.2 4.8 1.2.6.6 1 1.4 1.2 2.3" />
    </g>
    <g v-else-if="name === 'relations'" :stroke-width="stroke" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="7" cy="8" r="2.5" />
      <circle cx="17" cy="7" r="2.5" />
      <circle cx="12" cy="17" r="2.5" />
      <path d="M9 9.5l5-1.5M9 10l2.2 5M15 9l-2 6" />
    </g>
    <g v-else-if="name === 'legacy'" :stroke-width="stroke" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 3l2.2 4.4 4.8.7-3.5 3.4.8 4.8L12 14.2 7.7 16.3l.8-4.8L5 8.1l4.8-.7L12 3z" />
      <path d="M12 16v5" />
    </g>
    <g v-else-if="name === 'cities'" :stroke-width="stroke" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 20V9l5-4 5 4v11" />
      <path d="M14 20V11h6v9" />
      <path d="M7 12h2M7 15h2M16 14h2" />
    </g>
    <g v-else-if="name === 'diplomacy'" :stroke-width="stroke" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="8" />
      <path d="M4 12h16" />
      <path d="M12 4a12 12 0 0 1 0 16 12 12 0 0 1 0-16" />
    </g>
    <g v-else-if="name === 'timeline'" :stroke-width="stroke" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7v5l3.5 2" />
    </g>
    <g v-else-if="name === 'stone'" :stroke-width="stroke" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <path d="M8 6h6l4 5-4 7H8L4 11l4-5z" />
      <path d="M9 11h4" />
    </g>
    <g v-else-if="name === 'grain'" :stroke-width="stroke" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 21V9" />
      <path d="M12 9c-3-1-5-3-5-6 3 0 5 2 5 6z" />
      <path d="M12 11c3-1 5-3 5-6-3 0-5 2-5 6z" />
      <path d="M12 14c-2.5-.8-4-2.5-4-5" />
      <path d="M12 14c2.5-.8 4-2.5 4-5" />
    </g>
    <g v-else-if="name === 'herb'" :stroke-width="stroke" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 21V10" />
      <path d="M12 14c-4 0-7-3-7-7 4 0 7 3 7 7z" />
      <path d="M12 12c3.5-1 6-4 6-7-3 0-5.5 2.5-6 7z" />
    </g>
    <g v-else-if="name === 'ore'" :stroke-width="stroke" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6 18l3-10h6l3 10H6z" />
      <path d="M9 8l1.5-3h3L15 8" />
    </g>
    <g v-else-if="name === 'prestige'" :stroke-width="stroke" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 4l1.8 3.6 4 .6-2.9 2.8.7 4L12 13.3 8.4 15l.7-4L6.2 8.2l4-.6L12 4z" />
      <path d="M7 20h10" />
    </g>
    <g v-else-if="name === 'destiny'" :stroke-width="stroke" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 3c2.5 3 4 5.5 4 8a4 4 0 1 1-8 0c0-2.5 1.5-5 4-8z" />
      <path d="M9 19h6" />
      <path d="M10 22h4" />
    </g>
    <g v-else-if="name === 'bell'" :stroke-width="stroke" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 13 6 9z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </g>
    <g v-else-if="name === 'close'" :stroke-width="stroke" stroke="currentColor" stroke-linecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </g>
    <g v-else-if="name === 'chevron-left'" :stroke-width="stroke" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 6l-6 6 6 6" />
    </g>
    <g v-else-if="name === 'chevron-right'" :stroke-width="stroke" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <path d="M10 6l6 6-6 6" />
    </g>
    <g v-else-if="name === 'chevron-down'" :stroke-width="stroke" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6 9l6 6 6-6" />
    </g>
    <g v-else-if="name === 'menu'" :stroke-width="stroke" stroke="currentColor" stroke-linecap="round">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </g>
    <g v-else-if="name === 'send'" :stroke-width="stroke" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 12l16-7-7 16-2.5-6.5L4 12z" />
    </g>
    <g v-else-if="name === 'spark'" :stroke-width="stroke" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18" />
    </g>
    <g v-else-if="name === 'check'" :stroke-width="stroke" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7" />
    </g>
    <g v-else-if="name === 'info'" :stroke-width="stroke" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 11v5" />
      <circle cx="12" cy="8" r="0.8" fill="currentColor" stroke="none" />
    </g>
    <g v-else-if="name === 'warn'" :stroke-width="stroke" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 4l9 16H3L12 4z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="17" r="0.8" fill="currentColor" stroke="none" />
    </g>
    <g v-else-if="name === 'error'" :stroke-width="stroke" stroke="currentColor" stroke-linecap="round">
      <circle cx="12" cy="12" r="8" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </g>
    <g v-else-if="name === 'plus'" :stroke-width="stroke" stroke="currentColor" stroke-linecap="round">
      <path d="M12 5v14M5 12h14" />
    </g>
    <g v-else-if="name === 'search'" :stroke-width="stroke" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="11" cy="11" r="6" />
      <path d="M16 16l4 4" />
    </g>
    <g v-else-if="name === 'link'" :stroke-width="stroke" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <path d="M9 12h6" />
      <path d="M10 8H8a3 3 0 0 0 0 8h2" />
      <path d="M14 8h2a3 3 0 0 1 0 8h-2" />
    </g>
    <g v-else-if="name === 'user'" :stroke-width="stroke" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="9" r="3.5" />
      <path d="M5.5 20c1-3.5 3.2-5 6.5-5s5.5 1.5 6.5 5" />
    </g>
    <g v-else-if="name === 'scroll'" :stroke-width="stroke" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <path d="M7 4h9a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z" />
      <path d="M9 9h6M9 13h5" />
    </g>
    <g v-else-if="name === 'moon'" :stroke-width="stroke" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 14.5A7 7 0 1 1 9.5 6 5.5 5.5 0 0 0 18 14.5z" />
    </g>
    <g v-else-if="name === 'filter'" :stroke-width="stroke" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 6h16l-6 7v5l-4 2v-7L4 6z" />
    </g>
    <g v-else-if="name === 'external'" :stroke-width="stroke" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 5h5v5" />
      <path d="M19 5l-8 8" />
      <path d="M17 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h5" />
    </g>
    <g v-else :stroke-width="stroke" stroke="currentColor" stroke-linecap="round">
      <circle cx="12" cy="12" r="7" />
    </g>
  </svg>
</template>

<style scoped>
.icon {
  flex-shrink: 0;
  display: block;
}
</style>
