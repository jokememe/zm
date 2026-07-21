<script setup lang="ts">
import TianjiStage from '@/components/SillyTavern/TianjiStage.vue'
</script>

<template>
  <section id="view-story" class="story-view" aria-labelledby="story-title">
    <header class="story-view__head">
      <div>
        <p class="eyebrow">决策 · 叙事</p>
        <h1 id="story-title">天机推演</h1>
        <p class="sub">
          与右侧天机卷轴为同一会话。秘闻典籍、推演心法、气数簿均在此调度；变量结算同步宗门资源。
        </p>
      </div>
    </header>
    <TianjiStage />
  </section>
</template>

<style scoped>
.story-view__head {
  margin-bottom: 1rem;
}

.eyebrow {
  margin: 0 0 0.25rem;
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  color: var(--ink-muted);
  text-transform: uppercase;
}

.story-view__head h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.45rem;
  font-weight: 600;
  color: var(--ink-primary);
}

.sub {
  margin: 0.35rem 0 0;
  font-size: 0.88rem;
  color: var(--ink-secondary);
  line-height: 1.5;
  max-width: 42rem;
}
</style>
