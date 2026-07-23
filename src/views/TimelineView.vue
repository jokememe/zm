<script setup lang="ts">
import { computed } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { useModal } from '@/composables/useModal'
import { useGameState } from '@/composables/useGameState'
import { buildTimelineSeasons } from '@/composables/timeline-seasons'

const { open } = useModal()
const { calendar } = useGameState()

/** 随历法推进刷新，不再读死 mock 四季卡 */
const timelineSeasons = computed(() =>
  buildTimelineSeasons(calendar.year, calendar.season, 4),
)
</script>

<template>
  <div id="view-timeline" class="view">
    <div class="section-head">
      <div>
        <h2><span class="ornament" />岁月流转</h2>
        <p class="section-desc">
          当前：{{ calendar.era }} {{ calendar.year }} 年 · {{ calendar.season }} · {{ calendar.day }} 日 · {{ calendar.hour }}
        </p>
      </div>
      <button
        id="btn-advance-season"
        class="btn btn-primary"
        type="button"
        @click="open('season-advance')"
      >
        <Icon name="timeline" :size="16" /> 推进季节
      </button>
    </div>

    <div class="timeline">
      <article
        v-for="(s, i) in timelineSeasons"
        :id="`season-card-${s.id}`"
        :key="s.id"
        class="panel-card season"
        :class="s.status"
      >
        <div class="season__index">{{ String(i + 1).padStart(2, '0') }}</div>
        <div class="season__body">
          <header>
            <h3>{{ s.label }}</h3>
            <span
              class="tag"
              :class="{
                'tag-jade': s.status === 'current',
                'tag-moon': s.status === 'next',
              }"
            >
              {{ s.status === 'current' ? '当前' : s.status === 'next' ? '将至' : '更远' }}
            </span>
          </header>
          <ul>
            <li v-for="(e, j) in s.events" :key="j">{{ e }}</li>
          </ul>
        </div>
      </article>
    </div>

    <section class="panel-card note" id="timeline-note">
      <Icon name="info" :size="18" />
      <div>
        <strong>关于时间推进</strong>
        <p>
          每季本地汇总：灵田产出与生长、城池纳贡、弟子修炼/外勤、外交关系漂移、宗门维护开销；明细写入天机。随后由<strong>主
          API</strong>生成本季大殿「紧急与待决」。剧情回合的局面补丁仍走 settle，不在每回刷待决。
        </p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.timeline {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  position: relative;
  padding-left: 0.25rem;
}

.timeline::before {
  content: '';
  position: absolute;
  left: 28px;
  top: 12px;
  bottom: 12px;
  width: 2px;
  background: linear-gradient(180deg, var(--moon), transparent);
  opacity: 0.35;
}

.season {
  display: flex;
  gap: 1rem;
  padding: 1.1rem 1.2rem;
  position: relative;
  transition: border-color var(--dur-mid), box-shadow var(--dur-mid);
}

.season.current {
  border-color: var(--border-moon);
  box-shadow: var(--shadow-glow);
}

.season__index {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  font-family: var(--font-display);
  font-weight: 600;
  color: var(--moon-deep);
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid var(--border-moon);
  flex-shrink: 0;
  z-index: 1;
}

.season__body {
  flex: 1;
}

.season header {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  margin-bottom: 0.55rem;
}

.season h3 {
  font-size: 1.02rem;
}

.season li {
  font-size: 0.88rem;
  color: var(--ink-secondary);
  padding: 0.25rem 0 0.25rem 0.85rem;
  position: relative;
}

.season li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0.65rem;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--moon-soft);
}

.note {
  margin-top: 1.1rem;
  display: flex;
  gap: 0.85rem;
  padding: 1.1rem 1.2rem;
  color: var(--moon-deep);
}

.note strong {
  display: block;
  color: var(--ink-primary);
  margin-bottom: 0.3rem;
}

.note p {
  font-size: 0.86rem;
  color: var(--ink-secondary);
  line-height: 1.65;
}
</style>
