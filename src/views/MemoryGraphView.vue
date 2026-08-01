<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { useTianji } from '@/composables/useTianji'
import { useGameState } from '@/composables/useGameState'
import {
  appendNodeBeat,
  ensureMemoryGraphHydrated,
  formatMemoryGraphSliceBrief,
  getMemoryGraphSlice,
  removeNodeBeat,
  renameMemoryGraphNode,
  seedRosterNodes,
  selectMemoryGraphForTurn,
  setMasterName,
  type MemoryGraphNode,
  type MemoryGraphState,
} from '@/composables/memory-graph'
import { getArchiveCount, hydrateMemoryArchive } from '@/composables/memory-archive'
import { DEFAULT_MASTER_NAME } from '@/data/opening'
import { useToast } from '@/composables/useToast'
import { pendingTurnCount } from '@/composables/memory-batch'

const { injectContext, settings } = useTianji()
const { focusTianji, disciples, masterName, calendar } = useGameState()
const toast = useToast()

const tick = ref(0)
const search = ref('')
const selectedId = ref<string | null>(null)
const showExtras = ref(false)
const draftBeat = ref('')

void hydrateMemoryArchive().then(() => {
  setMasterName(masterName.value)
  // 名册种子：至少有角色壳
  seedRosterNodes(
    disciples.value
      .map((d) => d.name)
      .concat(masterName.value ? [String(masterName.value)] : []),
  )
  // 清理：把历史遗留的「掌门/本座/宗主」以及默认全名「沈青岚」节点合并到自定义名
  if (masterName.value) {
    for (const t of ['掌门', '本座', '宗主', DEFAULT_MASTER_NAME]) {
      if (t === masterName.value) continue
      try {
        renameMemoryGraphNode(t, masterName.value)
      } catch {
        /* 节点不存在则忽略 */
      }
    }
  }
  tick.value++
})

// 掌门改名后，确保记忆图谱使用自定义名（解决默认名残留问题）
watch(
  masterName,
  (newName, oldName) => {
    if (newName) setMasterName(newName)
    // 旧名节点合并到新名，防止图谱中残留默认名（如"沈青岚"）
    if (oldName && newName && oldName !== newName) {
      try {
        renameMemoryGraphNode(oldName, newName)
      } catch {
        /* ignore */
      }
    }
    // 称呼节点与默认全名也一并归一
    if (newName) {
      for (const t of ['掌门', '本座', '宗主', DEFAULT_MASTER_NAME]) {
        if (t === newName) continue
        try {
          renameMemoryGraphNode(t, newName)
        } catch {
          /* ignore */
        }
      }
      seedRosterNodes([newName])
      tick.value++ // 强制重新计算图谱列表
    }
  },
  { immediate: false },
)

function bump() {
  tick.value++
}

const typeClass: Record<string, string> = {
  师徒: 'tag-moon',
  道侣: 'tag-violet',
  结义: 'tag-jade',
  仇恨: 'tag-rose',
  竞争: 'tag-amber',
  血缘: 'tag-moon',
  约定: 'tag-jade',
  人际: 'tag-moon',
  其他: 'tag-rose',
}

const graph = computed((): MemoryGraphState => {
  void tick.value
  return ensureMemoryGraphHydrated()
})

const characters = computed(() => {
  return graph.value.nodes
    .filter((n) => n.kind === 'character')
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
})

const extras = computed(() => {
  return graph.value.nodes
    .filter((n) => n.kind !== 'character')
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
})

const stats = computed(() => {
  void tick.value
  const g = graph.value
  const chars = characters.value
  return {
    characters: chars.length,
    edges: g.edges.length,
    beats: chars.reduce((s, n) => s + (n.beats?.length || 0), 0),
    archive: getArchiveCount(),
    extras: extras.value.length,
  }
})

/** 批量统一记忆窗口（仅 LLM 摘要引擎且 ≥2 时显示） */
const batchWindow = computed(() => {
  if (!settings.value?.memoryLlmSummary) return 0
  return Math.max(0, Math.floor(Number(settings.value?.memoryBatchSize) || 0))
})

/** 批量攒批进度（0-100） */
const pendingPct = computed(() => {
  if (batchWindow.value < 2) return 0
  return Math.min(100, Math.round((pendingTurnCount() / batchWindow.value) * 100))
})

/** 字徽配色：掌门朱印、地点玉、物品琥珀、其余月蓝 */
function avatarClass(n: MemoryGraphNode): string {
  if (n.name === masterName.value) return 'avatar-seal'
  if (n.kind !== 'character') {
    if (n.kind === 'place') return 'avatar-jade'
    if (n.kind === 'item') return 'avatar-amber'
    return 'avatar-silver'
  }
  return 'avatar-moon'
}

/** 角色卡片副题：身份 + 近事时间 */
function cardSub(n: MemoryGraphNode): string {
  const idn = n.attrs?.['身份']
  if (idn) return String(idn)
  return '无载'
}

const filteredCharacters = computed(() => {
  const q = search.value.trim().toLowerCase()
  let list = [...characters.value]
  if (q) {
    list = list.filter((n) => {
      if (n.name.toLowerCase().includes(q)) return true
      if (Object.values(n.attrs || {}).some((v) => String(v).toLowerCase().includes(q)))
        return true
      if ((n.beats || []).some((b) => b.text.toLowerCase().includes(q))) return true
      return false
    })
  }
  return list
})

const selectedNode = computed((): MemoryGraphNode | null => {
  if (!selectedId.value) return null
  return graph.value.nodes.find((n) => n.id === selectedId.value) || null
})

const selectedSlice = computed(() => {
  const n = selectedNode.value
  if (!n) return null
  return getMemoryGraphSlice(graph.value, n.name)
})

const selectedAttrs = computed(() => {
  const n = selectedNode.value
  if (!n?.attrs) return [] as Array<{ k: string; v: string }>
  return Object.entries(n.attrs)
    .filter(([, v]) => String(v || '').trim())
    .map(([k, v]) => ({ k, v: String(v) }))
})

watch(filteredCharacters, (list) => {
  if (!list.length) {
    if (!showExtras.value) selectedId.value = null
    return
  }
  if (!selectedId.value || !list.some((n) => n.id === selectedId.value)) {
    // keep selection if it's an extra node
    const still = graph.value.nodes.some((n) => n.id === selectedId.value)
    if (!still) selectedId.value = list[0].id
  }
})

function selectNode(n: MemoryGraphNode) {
  selectedId.value = n.id
  draftBeat.value = ''
}

function addBeat() {
  const n = selectedNode.value
  const t = draftBeat.value.trim()
  if (!n || !t) {
    toast.warn('请填写近事', '')
    return
  }
  appendNodeBeat(n.name, t, {
    year: Number(calendar.year) || 0,
    season: String(calendar.season || ''),
  })
  draftBeat.value = ''
  bump()
  toast.success('近事已写入', n.name)
}

function dropBeat(beatId: string) {
  const n = selectedNode.value
  if (!n) return
  if (!confirm('删除这条热近事？')) return
  removeNodeBeat(n.name, beatId)
  bump()
}

function injectSelected() {
  const n = selectedNode.value
  if (!n) {
    toast.warn('未选角色', '请先点选一个角色')
    return
  }
  const slice = getMemoryGraphSlice(graph.value, n.name)
  const brief = formatMemoryGraphSliceBrief(slice) || n.name
  const lines: string[] = [`【角色记忆】${n.name}`]
  for (const a of selectedAttrs.value.slice(0, 8)) {
    lines.push(`${a.k}：${a.v}`)
  }
  for (const e of slice.edges.slice(0, 6)) {
    lines.push(
      `关系 ${e.direction === 'out' ? '→' : '←'} ${e.otherName}〔${e.type}〕${e.note ? ` · ${e.note}` : ''}`,
    )
  }
  for (const b of (n.beats || []).slice(0, 8)) {
    const cal = b.year != null ? `（${b.year}年${b.season || ''}）` : ''
    lines.push(`近事：${b.text}${cal}`)
  }
  injectContext(`角色记忆 · ${n.name}`, lines.join('\n').slice(0, 1800) || brief)
  focusTianji()
  toast.success('已注入天机', n.name)
}

function injectTurnPick() {
  const roster = [
    ...disciples.value.map((d) => d.name),
    String(masterName.value || ''),
  ].filter(Boolean)
  const picked = selectMemoryGraphForTurn({
    graph: graph.value,
    query: search.value || roster.slice(0, 6).join(' '),
    rosterNames: roster,
    maxNodes: 5,
    maxChars: 1600,
    currentYear: Number(calendar.year) || undefined,
    flashbackTopK: 6,
  })
  if (!picked.nodeCount && !picked.flashbackCount) {
    toast.warn('暂无命中', '图谱为空或无法选取')
    return
  }
  injectContext(
    `角色记忆 · 选取 ${picked.names.slice(0, 4).join('、')}`,
    picked.text,
  )
  focusTianji()
  toast.success(
    '已注入选取',
    `${picked.nodeCount} 人` +
      (picked.flashbackCount ? ` · 闪回 ${picked.flashbackCount}` : '') +
      `：${picked.names.slice(0, 6).join('、')}`,
  )
}

function cardBrief(n: MemoryGraphNode): string {
  const beats = n.beats || []
  if (beats[0]?.text) return beats[0].text
  return (
    formatMemoryGraphSliceBrief(getMemoryGraphSlice(graph.value, n.name)) ||
    Object.values(n.attrs || {}).slice(0, 2).join(' · ') ||
    '暂无近事'
  )
}
</script>

<template>
  <div id="view-memory-graph" class="view">
    <div class="section-head">
      <div>
        <h2><span class="ornament" />角色记忆</h2>
        <p class="section-desc">
          人物近事与关系（L1）。推演前系统预取注入；可手改近事与触发词。长线摘要在短/中/长，不在本页。
        </p>
      </div>
      <div class="section-actions">
        <button
          id="btn-mg-inject-pick"
          class="btn btn-soft"
          type="button"
          @click="injectTurnPick"
        >
          <Icon name="scroll" :size="16" /> 注入选取
        </button>
        <button
          id="btn-mg-inject-node"
          class="btn btn-primary"
          type="button"
          :disabled="!selectedNode"
          @click="injectSelected"
        >
          <Icon name="send" :size="16" /> 注入本角色
        </button>
      </div>
    </div>

    <!-- 铭文统计 -->
    <div class="stats-row">
      <div class="stat">
        <strong>{{ stats.characters }}</strong>
        <span>在册角色</span>
      </div>
      <span class="stat-divider" />
      <div class="stat">
        <strong>{{ stats.beats }}</strong>
        <span>热近事</span>
      </div>
      <span class="stat-divider" />
      <div class="stat">
        <strong>{{ stats.archive }}</strong>
        <span>冷档案</span>
      </div>
      <span class="stat-divider" />
      <div class="stat">
        <strong>{{ stats.edges }}</strong>
        <span>关系脉</span>
      </div>
      <template v-if="stats.extras">
        <span class="stat-divider" />
        <div class="stat">
          <strong>{{ stats.extras }}</strong>
          <span>物·地·事</span>
        </div>
      </template>
      <template v-if="batchWindow >= 2">
        <span class="stat-divider" />
        <div class="stat stat-pending-wrap" title="攒满后自动统一记账">
          <strong class="stat-pending">{{ pendingTurnCount() }}/{{ batchWindow }}</strong>
          <span>待统一记忆</span>
          <div class="mini-progress" aria-hidden="true">
            <i :style="{ width: pendingPct + '%' }" />
          </div>
        </div>
      </template>
    </div>

    <!-- 工具栏 -->
    <div class="toolbar">
      <div class="search-wrap">
        <span class="search-glyph">⌕</span>
        <input
          id="mg-search"
          v-model="search"
          type="search"
          class="filter-search"
          placeholder="搜角色名、属性、近事…"
        />
        <span v-if="search" class="search-clear" role="button" tabindex="0" @click="search = ''">
          ×
        </span>
      </div>
      <span class="count">{{ filteredCharacters.length }} / {{ characters.length }} 位角色</span>
      <button
        v-if="stats.extras"
        type="button"
        class="tab"
        :class="{ active: showExtras }"
        @click="showExtras = !showExtras"
      >
        {{ showExtras ? '只看角色' : `物/地/事 ${stats.extras}` }}
      </button>
    </div>

    <!-- 空状态 -->
    <div v-if="!stats.characters" class="empty-state">
      <span class="avatar avatar-silver">册</span>
      <div>
        <strong>山门犹在，名册空空</strong>
        <p class="muted">
          待弟子入册、或通灵叙事之后，此处自会浮起人物近事与因缘。可写
          &lt;memory&gt;角色名|做了什么&lt;/memory&gt; 先行立册。
        </p>
      </div>
    </div>

    <!-- 主区 -->
    <div v-else class="mg-layout">
      <div class="mg-list stagger">
        <article
          v-for="n in filteredCharacters"
          :id="`mg-node-${n.id}`"
          :key="n.id"
          class="node-card"
          :class="{ active: selectedId === n.id }"
          @click="selectNode(n)"
        >
          <span class="avatar" :class="avatarClass(n)">{{ n.name.slice(0, 1) }}</span>
          <div class="card-body">
            <header>
              <h3>{{ n.name }}</h3>
              <span v-if="n.name === masterName" class="seal" title="掌门">主</span>
            </header>
            <p class="card-sub">{{ cardSub(n) }}</p>
            <p class="card-brief">{{ cardBrief(n) }}</p>
            <footer>
              <span class="meta">{{ (n.beats || []).length }} 近事</span>
              <span class="meta-dot" />
              <span class="meta">{{ getMemoryGraphSlice(graph, n.name).edges.length }} 关系</span>
            </footer>
          </div>
        </article>
        <p v-if="!filteredCharacters.length" class="muted pad">无匹配角色</p>

        <template v-if="showExtras && extras.length">
          <p class="list-sep muted">物 · 地 · 事</p>
          <article
            v-for="n in extras"
            :id="`mg-node-${n.id}`"
            :key="n.id"
            class="node-card extra"
            :class="{ active: selectedId === n.id }"
            @click="selectNode(n)"
          >
            <span class="avatar" :class="avatarClass(n)">{{ n.name.slice(0, 1) }}</span>
            <div class="card-body">
              <header>
                <h3>{{ n.name }}</h3>
              </header>
              <p class="card-sub">{{ n.kind }}</p>
              <p class="card-brief">{{ cardBrief(n) }}</p>
            </div>
          </article>
        </template>
      </div>

      <!-- 详情 -->
      <aside v-if="selectedNode && selectedSlice" class="mg-detail" id="mg-detail">
        <header class="detail-head">
          <div class="detail-title">
            <h3>{{ selectedNode.name }}</h3>
            <span v-if="selectedNode.name === masterName" class="seal">主</span>
            <span
              v-if="selectedNode.attrs?.['身份']"
              class="tag tag-jade"
            >
              {{ selectedNode.attrs['身份'] }}
            </span>
          </div>
          <button class="btn btn-primary btn-sm" type="button" @click="injectSelected">
            <Icon name="send" :size="14" /> 注入
          </button>
        </header>

        <section class="detail-block">
          <h4>近事 · {{ selectedNode.beats?.length || 0 }}</h4>
          <ul v-if="selectedNode.beats?.length" class="timeline">
            <li v-for="b in selectedNode.beats" :key="b.id">
              <span class="tl-dot" />
              <div class="tl-body">
                <span v-if="b.year != null" class="tl-cal">{{ b.year }}年{{ b.season || '' }}</span>
                <p>{{ b.text }}</p>
              </div>
              <button type="button" class="btn btn-ghost btn-sm tl-del" @click="dropBeat(b.id)">
                删
              </button>
            </li>
          </ul>
          <p v-else class="muted">尚无近事。可下方手写，或通灵 &lt;memory&gt; / 正文兜底。</p>
          <div class="edit-row">
            <input
              v-model="draftBeat"
              type="text"
              class="filter-search"
              placeholder="手写一条近事…"
              @keydown.enter.prevent="addBeat"
            />
            <button type="button" class="btn btn-soft btn-sm" @click="addBeat">写入</button>
          </div>
        </section>

        <section v-if="selectedSlice.edges.length" class="detail-block">
          <h4>关系 · {{ selectedSlice.edges.length }}</h4>
          <ul class="edge-list">
            <li v-for="e in selectedSlice.edges" :key="e.id">
              <span class="tag" :class="typeClass[e.type] || 'tag-rose'">{{ e.type }}</span>
              <span class="arrow">{{ e.direction === 'out' ? '→' : '←' }}</span>
              <button
                type="button"
                class="person-link"
                @click="selectedId = e.direction === 'out' ? e.to : e.from"
              >
                {{ e.otherName }}
              </button>
              <span v-if="e.note" class="muted"> · {{ e.note }}</span>
            </li>
          </ul>
        </section>

        <section v-if="selectedAttrs.length" class="detail-block">
          <h4>档案</h4>
          <div class="attrs">
            <div v-for="a in selectedAttrs" :key="a.k" class="attr">
              <label>{{ a.k }}</label>
              <span>{{ a.v }}</span>
            </div>
          </div>
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
/* 页面云纹氛围（极淡，不抢内容） */
#view-memory-graph::before {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  width: 340px;
  height: 260px;
  pointer-events: none;
  background:
    radial-gradient(circle at 70% 40%, rgba(91, 141, 239, 0.07), transparent 62%),
    radial-gradient(circle at 88% 70%, rgba(196, 149, 74, 0.05), transparent 55%);
  border-radius: 50%;
  filter: blur(6px);
  z-index: 0;
}

#view-memory-graph {
  position: relative;
}

#view-memory-graph > * {
  position: relative;
  z-index: 1;
}

.section-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

/* —— 铭文统计（菱形分隔，节奏更分明） —— */
.stats-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.7rem 1.35rem;
  padding: 1rem 0.35rem;
  margin-top: 0.05rem;
  border-bottom: 1px solid var(--border-subtle);
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 0.22rem;
  min-width: 3.6rem;
  transition: transform var(--dur-fast) var(--ease-out);
}

.stat:hover {
  transform: translateY(-2px);
}

.stat strong {
  font-family: var(--font-display);
  font-size: 1.5rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  line-height: 1.05;
  color: var(--ink-primary);
}

.stat span {
  font-size: 0.72rem;
  color: var(--ink-muted);
  letter-spacing: 0.14em;
}

.stat-divider {
  width: 5px;
  height: 5px;
  background: linear-gradient(135deg, var(--moon-soft), var(--moon));
  transform: rotate(45deg);
  border-radius: 1px;
  opacity: 0.55;
}

.stat-pending {
  font-size: 1.05rem !important;
  color: var(--moon-deep) !important;
}

.stat-pending-wrap {
  min-width: 5.2rem;
}

.mini-progress {
  width: 100%;
  max-width: 5.5rem;
  height: 4px;
  border-radius: var(--radius-full);
  background: var(--bg-mist);
  overflow: hidden;
  margin-top: 0.15rem;
}

.mini-progress i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--moon-soft), var(--moon));
  transition: width var(--dur-mid) var(--ease-out);
}

/* —— 工具栏 —— */
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.7rem;
  padding: 0.7rem 1rem;
  margin-top: 0.9rem;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
}

.search-wrap {
  position: relative;
  flex: 1;
  max-width: 24rem;
  display: flex;
  align-items: center;
}

.search-glyph {
  position: absolute;
  left: 0.7rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--ink-faint);
  font-size: 1rem;
  pointer-events: none;
}

.search-clear {
  position: absolute;
  right: 0.55rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--ink-faint);
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
  padding: 0.1rem 0.25rem;
  border-radius: var(--radius-full);
  transition: color var(--dur-fast) var(--ease-soft);
}

.search-clear:hover {
  color: var(--ink-primary);
}

.filter-search {
  width: 100%;
  border: 1px solid color-mix(in srgb, var(--ink-muted) 28%, transparent);
  background: color-mix(in srgb, var(--panel, #1a1624) 40%, transparent);
  color: var(--ink-primary);
  border-radius: 0.55rem;
  padding: 0.45rem 1.7rem 0.45rem 2rem;
  font-size: 0.86rem;
  transition:
    border-color var(--dur-fast) var(--ease-soft),
    box-shadow var(--dur-fast) var(--ease-soft);
}

.filter-search:focus {
  border-color: var(--moon);
  box-shadow: 0 0 0 3px var(--moon-glow);
}

.toolbar .count {
  font-size: 0.76rem;
  color: var(--ink-muted);
  white-space: nowrap;
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
}

.tab {
  border: 1px solid transparent;
  background: transparent;
  color: var(--ink-secondary);
  padding: 0.35rem 0.8rem;
  border-radius: var(--radius-full);
  font-size: 0.85rem;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-soft),
    color var(--dur-fast) var(--ease-soft),
    border-color var(--dur-fast) var(--ease-soft);
}

.tab.active {
  background: color-mix(in srgb, var(--accent, #7b6bb0) 14%, transparent);
  border-color: color-mix(in srgb, var(--accent, #7b6bb0) 35%, transparent);
  color: var(--ink-primary);
  font-weight: 600;
}

/* —— 空状态 —— */
.empty-state {
  margin-top: 1rem;
  display: flex;
  gap: 1rem;
  align-items: flex-start;
  padding: 1.4rem 1.5rem;
  background:
    linear-gradient(160deg, rgba(91, 141, 239, 0.05), transparent 55%),
    var(--bg-elevated);
  border: 1px dashed var(--border-medium);
  border-radius: var(--radius-md);
}

.empty-state p {
  margin: 0.4rem 0 0;
  line-height: 1.6;
  font-size: 0.9rem;
  max-width: 46rem;
}

/* —— 主布局 —— */
.mg-layout {
  margin-top: 1rem;
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.85fr);
  gap: 1.1rem;
  align-items: start;
}

.mg-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: min(74vh, 860px);
  overflow: auto;
  padding: 0.15rem;
}

.list-sep {
  margin: 0.55rem 0 0.15rem;
  font-size: 0.74rem;
  letter-spacing: 0.18em;
  text-align: center;
}

.list-sep::before,
.list-sep::after {
  content: '·';
  margin: 0 0.7rem;
  color: var(--ink-faint);
}

.pad {
  padding: 0.75rem;
}

/* —— 字徽（双环玉印） —— */
.avatar {
  flex: 0 0 auto;
  width: 2.8rem;
  height: 2.8rem;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-family: var(--font-display);
  font-size: 1.18rem;
  font-weight: 600;
  border: 1px solid;
  position: relative;
  user-select: none;
  transition:
    transform var(--dur-mid) var(--ease-spring),
    box-shadow var(--dur-mid) var(--ease-out);
}

.avatar::after {
  content: '';
  position: absolute;
  inset: 3px;
  border-radius: 50%;
  border: 1px dashed currentColor;
  opacity: 0.3;
}

.avatar-moon {
  color: var(--moon-deep);
  background: linear-gradient(145deg, var(--moon-glow), rgba(91, 141, 239, 0.06));
  border-color: var(--border-moon);
}

.avatar-seal {
  color: #fff;
  background: linear-gradient(145deg, #d9876a, #b8502e);
  border-color: rgba(184, 80, 46, 0.5);
  box-shadow: 0 2px 10px rgba(184, 80, 46, 0.28);
}

.avatar-jade {
  color: var(--jade);
  background: linear-gradient(145deg, var(--jade-soft), rgba(90, 154, 150, 0.05));
  border-color: rgba(90, 154, 150, 0.35);
}

.avatar-amber {
  color: #a3722e;
  background: linear-gradient(145deg, var(--amber-soft), rgba(196, 149, 74, 0.04));
  border-color: rgba(196, 149, 74, 0.4);
}

.avatar-silver {
  color: var(--silver);
  background: linear-gradient(145deg, rgba(154, 171, 192, 0.16), rgba(154, 171, 192, 0.05));
  border-color: rgba(154, 171, 192, 0.35);
}

/* —— 名册笺（角色卡片） —— */
.node-card {
  display: flex;
  gap: 0.85rem;
  align-items: flex-start;
  padding: 0.9rem 1rem;
  border-radius: var(--radius-md);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.5), transparent 70%),
    var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  position: relative;
  transition:
    transform var(--dur-mid) var(--ease-out),
    box-shadow var(--dur-mid) var(--ease-out),
    border-color var(--dur-fast) var(--ease-soft);
}

.node-card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 18%;
  bottom: 18%;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: linear-gradient(180deg, var(--moon), var(--moon-soft));
  opacity: 0;
  transform: scaleY(0.4);
  transition:
    opacity var(--dur-fast) var(--ease-soft),
    transform var(--dur-mid) var(--ease-out);
}

.node-card:hover {
  transform: translateY(-2px);
  border-color: var(--border-moon);
  box-shadow: var(--shadow-md);
}

.node-card:hover .avatar {
  transform: translateY(-1px) scale(1.06);
  box-shadow: 0 4px 14px var(--moon-glow);
}

.node-card.extra {
  opacity: 0.94;
}

.node-card.active {
  border-color: var(--border-moon);
  box-shadow: var(--shadow-glow);
  background:
    linear-gradient(180deg, rgba(91, 141, 239, 0.08), transparent 72%),
    var(--bg-elevated);
}

.node-card.active::before {
  opacity: 1;
  transform: scaleY(1);
}

.card-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.node-card header {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.node-card h3 {
  margin: 0;
  font-size: 1.02rem;
  font-family: var(--font-display);
  letter-spacing: 0.03em;
}

.card-sub {
  margin: 0;
  font-size: 0.72rem;
  color: var(--ink-faint);
  letter-spacing: 0.08em;
}

.card-brief {
  margin: 0.2rem 0 0;
  font-size: 0.84rem;
  line-height: 1.55;
  color: var(--ink-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  border-left: 2px solid color-mix(in srgb, var(--ink-muted) 25%, transparent);
  padding-left: 0.55rem;
}

.node-card footer {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  margin-top: 0.15rem;
  font-size: 0.72rem;
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
}

.meta-dot {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--ink-faint);
  opacity: 0.6;
}

/* 朱印「主」 */
.seal {
  display: inline-grid;
  place-items: center;
  width: 1.05rem;
  height: 1.05rem;
  border-radius: 3px;
  background: linear-gradient(145deg, #d9876a, #b8502e);
  color: #fff;
  font-family: var(--font-display);
  font-size: 0.68rem;
  font-weight: 700;
  line-height: 1;
  box-shadow: 0 1px 4px rgba(184, 80, 46, 0.3);
  flex: 0 0 auto;
}

/* —— 详情面板（卷轴头） —— */
.mg-detail {
  position: sticky;
  top: 0.5rem;
  padding: 1.15rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  max-height: min(74vh, 860px);
  overflow: auto;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  animation: slide-in-right var(--dur-mid) var(--ease-out) both;
}

.mg-detail::before {
  content: '';
  height: 2px;
  border-radius: 2px;
  background: linear-gradient(90deg, transparent, var(--moon) 20%, var(--moon-soft) 50%, var(--moon) 80%, transparent);
  opacity: 0.55;
}

.detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
}

.detail-title {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex-wrap: wrap;
  min-width: 0;
}

.detail-head h3 {
  margin: 0;
  font-size: 1.22rem;
  font-family: var(--font-display);
  letter-spacing: 0.03em;
}

.detail-block h4 {
  margin: 0 0 0.55rem;
  font-size: 0.72rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ink-muted);
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.detail-block h4::after {
  content: '';
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, var(--border-subtle), transparent);
}

/* 近事时间线：最新实心，旧则渐隐 */
.timeline {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
}

.timeline li {
  position: relative;
  padding: 0.15rem 0 0.65rem 1.2rem;
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 0.55rem;
  align-items: start;
}

.timeline li::before {
  content: '';
  position: absolute;
  left: 3px;
  top: 0.8rem;
  bottom: -0.1rem;
  width: 1px;
  background: linear-gradient(180deg, var(--border-medium), transparent);
}

.timeline li:last-child::before {
  display: none;
}

.tl-dot {
  position: absolute;
  left: 0;
  top: 0.62rem;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--moon);
  box-shadow: 0 0 0 3px var(--moon-glow);
  transition:
    transform var(--dur-fast) var(--ease-spring),
    background var(--dur-fast) var(--ease-soft);
}

.timeline li:not(:first-child) .tl-dot {
  background: transparent;
  border: 1px solid var(--moon);
  box-shadow: none;
  opacity: 0.7;
}

.timeline li:hover .tl-dot {
  transform: scale(1.25);
  background: var(--moon);
  opacity: 1;
}

.tl-body {
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
}

.tl-body p {
  margin: 0;
  font-size: 0.86rem;
  line-height: 1.55;
}

.tl-cal {
  font-size: 0.7rem;
  color: var(--ink-faint);
  letter-spacing: 0.06em;
}

.tl-del {
  align-self: center;
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease-soft);
}

.timeline li:hover .tl-del {
  opacity: 1;
}

/* 关系 */
.edge-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  font-size: 0.86rem;
  line-height: 1.45;
}

.edge-list li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  padding: 0.3rem 0.45rem;
  margin: 0 -0.45rem;
  border-radius: var(--radius-sm);
  transition: background var(--dur-fast) var(--ease-soft);
}

.edge-list li:hover {
  background: var(--bg-mist);
}

.arrow {
  color: var(--ink-faint);
  font-size: 0.9rem;
}

.person-link {
  border: none;
  background: none;
  color: var(--ink-primary);
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 0.92rem;
  cursor: pointer;
  padding: 0;
  text-align: left;
  transition: color var(--dur-fast) var(--ease-soft);
}

.person-link:hover {
  color: var(--accent, #9b8ad4);
  text-decoration: underline;
}

/* 档案 */
.attrs {
  display: grid;
  gap: 0.5rem;
}

.attr {
  display: grid;
  grid-template-columns: 5.5rem 1fr;
  gap: 0.5rem;
  font-size: 0.85rem;
  align-items: baseline;
  padding: 0.25rem 0;
  border-bottom: 1px dotted var(--border-subtle);
}

.attr:last-child {
  border-bottom: none;
}

.attr label {
  color: var(--ink-muted);
  font-size: 0.76rem;
  letter-spacing: 0.06em;
}

/* 手写近事 */
.edit-row {
  display: flex;
  gap: 0.45rem;
  align-items: center;
  margin-top: 0.7rem;
}

.edit-row .filter-search {
  flex: 1;
  max-width: none;
  min-width: 0;
  padding-left: 0.8rem;
}

.btn-sm {
  padding: 0.3rem 0.65rem;
  font-size: 0.8rem;
}

@media (max-width: 960px) {
  .mg-layout {
    grid-template-columns: 1fr;
  }

  .mg-detail {
    position: static;
    max-height: none;
  }

  .mg-list {
    max-height: none;
  }

  .search-wrap {
    max-width: none;
  }
}
</style>
