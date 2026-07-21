<script setup lang="ts">
import { ref, computed } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import TabsBar from '@/components/ui/TabsBar.vue'
import { useModal } from '@/composables/useModal'
import { useTianji } from '@/composables/useTianji'
import { useGameState } from '@/composables/useGameState'

const tab = ref('all')
const q = ref('')
const { open } = useModal()
const { injectContext } = useTianji()
const { focusTianji, disciples } = useGameState()

const tabs = computed(() => [
  { id: 'all', label: '全部', count: disciples.value.length },
  {
    id: '在宗',
    label: '在宗',
    count: disciples.value.filter((d) => d.status === '在宗').length,
  },
  {
    id: '外勤',
    label: '外勤',
    count: disciples.value.filter((d) => d.status === '外勤').length,
  },
  {
    id: '闭关',
    label: '闭关',
    count: disciples.value.filter((d) => d.status === '闭关').length,
  },
])

const list = computed(() => {
  let rows = disciples.value
  if (tab.value !== 'all') rows = rows.filter((d) => d.status === tab.value)
  if (q.value.trim()) {
    const s = q.value.trim()
    rows = rows.filter(
      (d) => d.name.includes(s) || d.role.includes(s) || d.realm.includes(s),
    )
  }
  return rows
})

function resolveSpouse(id?: string) {
  if (!id) return null
  return disciples.value.find((d) => d.id === id)?.name
}
</script>

<template>
  <div id="view-disciples" class="view">
    <div class="section-head">
      <div>
        <h2><span class="ornament" />弟子名册</h2>
        <p class="section-desc">从杂役到筑基，忠诚与心境同样决定宗门存续。</p>
      </div>
      <button
        id="btn-disciples-tianji"
        class="btn btn-soft"
        type="button"
        @click="injectContext('弟子', '名册与人事安排'); focusTianji()"
      >
        <Icon name="scroll" :size="16" /> 注入天机
      </button>
    </div>

    <div class="toolbar">
      <TabsBar id="disciples-tabs" v-model="tab" :tabs="tabs" />
      <div class="search">
        <Icon name="search" :size="16" />
        <input
          id="disciples-search"
          v-model="q"
          type="search"
          placeholder="搜索姓名、职责、境界…"
        />
      </div>
    </div>

    <div class="table-wrap panel-card" style="margin-top: 1rem">
      <table class="data-table" id="disciples-table">
        <thead>
          <tr>
            <th>弟子</th>
            <th>境界</th>
            <th>职责</th>
            <th>忠诚</th>
            <th>心境</th>
            <th>状态</th>
            <th>道侣</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="d in list"
            :id="`disciple-row-${d.id}`"
            :key="d.id"
            class="row-click"
            @click="open('disciple-detail', { discipleId: d.id })"
          >
            <td>
              <div class="name-cell">
                <span
                  class="avatar"
                  :style="{
                    background: `linear-gradient(145deg, hsl(${d.avatarHue} 45% 78%), hsl(${d.avatarHue} 35% 90%))`,
                  }"
                >{{ d.name.slice(0, 1) }}</span>
                <div>
                  <strong>{{ d.name }}</strong>
                  <span class="sub">{{ d.gender }} · {{ d.age }}岁 · {{ d.aptitude }}</span>
                </div>
              </div>
            </td>
            <td>{{ d.realm }}</td>
            <td>{{ d.role }}</td>
            <td>
              <div class="loyalty">
                <div class="progress-track">
                  <div
                    class="progress-fill"
                    :style="{
                      width: d.loyalty + '%',
                      background:
                        d.loyalty < 65
                          ? 'linear-gradient(90deg, #c06b7a, #d09090)'
                          : undefined,
                    }"
                  />
                </div>
                <span>{{ d.loyalty }}</span>
              </div>
            </td>
            <td>{{ d.mood }}</td>
            <td>
              <span
                class="tag"
                :class="{
                  'tag-jade': d.status === '在宗',
                  'tag-moon': d.status === '外勤',
                  'tag-violet': d.status === '闭关',
                  'tag-rose': d.status === '受伤' || d.status === '叛离风险',
                }"
              >{{ d.status }}</span>
            </td>
            <td>{{ resolveSpouse(d.spouse) ?? '—' }}</td>
            <td>
              <button
                :id="`btn-disciple-open-${d.id}`"
                class="btn btn-ghost btn-sm"
                type="button"
                @click.stop="open('disciple-detail', { discipleId: d.id })"
              >
                详情
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.search {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.45rem 0.75rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-medium);
  background: rgba(255, 255, 255, 0.75);
  color: var(--ink-muted);
  min-width: 220px;
}

.search input {
  flex: 1;
  border: none;
  background: transparent;
  min-width: 0;
}

.search input:focus {
  box-shadow: none;
}

.table-wrap {
  overflow: auto;
}

.name-cell {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}

.avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 0.85rem;
  font-weight: 600;
  border: 1px solid rgba(255, 255, 255, 0.8);
  flex-shrink: 0;
}

.name-cell strong {
  display: block;
  font-size: 0.9rem;
}

.sub {
  font-size: 0.72rem;
  color: var(--ink-muted);
}

.loyalty {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 100px;
}

.loyalty .progress-track {
  flex: 1;
  min-width: 60px;
}

.loyalty span {
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
  width: 1.6rem;
}

.row-click {
  cursor: pointer;
}
</style>
