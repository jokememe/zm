<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { useTianji } from '@/composables/useTianji'
import { useGameState } from '@/composables/useGameState'
import {
  ensureMemoryGraphHydrated,
  formatMemoryGraphSliceBrief,
  getMemoryGraphSlice,
  loadMemoryGraph,
  selectMemoryGraphForTurn,
  syncMemoryGraphFromTableMemory,
  type MemoryGraphEdge,
  type MemoryGraphNode,
  type MemoryGraphNodeKind,
  type MemoryGraphState,
} from '@/composables/memory-graph'
import { useToast } from '@/composables/useToast'

const { injectContext } = useTianji()
const { focusTianji, disciples, masterName } = useGameState()
const toast = useToast()

/** 版本号：强制刷新（sync / 手动） */
const tick = ref(0)
const kindFilter = ref<'all' | MemoryGraphNodeKind>('all')
const search = ref('')
const selectedId = ref<string | null>(null)
const tab = ref<'nodes' | 'edges'>('nodes')

const KIND_LABEL: Record<MemoryGraphNodeKind, string> = {
  character: '角色',
  event: '事件',
  item: '物品',
  place: '地点',
  other: '其他',
}

const KIND_TAG: Record<MemoryGraphNodeKind, string> = {
  character: 'tag-moon',
  event: 'tag-amber',
  item: 'tag-violet',
  place: 'tag-jade',
  other: 'tag-rose',
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

const stats = computed(() => {
  const g = graph.value
  const byKind: Record<string, number> = {}
  for (const n of g.nodes) {
    byKind[n.kind] = (byKind[n.kind] || 0) + 1
  }
  return {
    nodes: g.nodes.length,
    edges: g.edges.length,
    beats: g.nodes.reduce((s, n) => s + (n.beats?.length || 0), 0),
    byKind,
  }
})

const nameById = computed(() => {
  const m = new Map<string, string>()
  for (const n of graph.value.nodes) m.set(n.id, n.name)
  return m
})

const filteredNodes = computed(() => {
  const q = search.value.trim().toLowerCase()
  let list = [...graph.value.nodes]
  if (kindFilter.value !== 'all') {
    list = list.filter((n) => n.kind === kindFilter.value)
  }
  if (q) {
    list = list.filter((n) => {
      if (n.name.toLowerCase().includes(q)) return true
      if (Object.values(n.attrs || {}).some((v) => String(v).toLowerCase().includes(q))) return true
      if ((n.beats || []).some((b) => b.text.toLowerCase().includes(q))) return true
      return false
    })
  }
  list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  return list
})

const filteredEdges = computed(() => {
  const q = search.value.trim().toLowerCase()
  let list = [...graph.value.edges]
  if (kindFilter.value !== 'all') {
    const ids = new Set(
      graph.value.nodes.filter((n) => n.kind === kindFilter.value).map((n) => n.id),
    )
    list = list.filter((e) => ids.has(e.from) || ids.has(e.to))
  }
  if (q) {
    list = list.filter((e) => {
      const from = nameById.value.get(e.from) || e.from
      const to = nameById.value.get(e.to) || e.to
      return (
        from.toLowerCase().includes(q) ||
        to.toLowerCase().includes(q) ||
        e.type.toLowerCase().includes(q) ||
        (e.note || '').toLowerCase().includes(q)
      )
    })
  }
  list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
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

watch(filteredNodes, (list) => {
  if (!list.length) {
    selectedId.value = null
    return
  }
  if (!selectedId.value || !list.some((n) => n.id === selectedId.value)) {
    selectedId.value = list[0].id
  }
})

function refresh() {
  tick.value++
}

function syncFromTables() {
  syncMemoryGraphFromTableMemory()
  refresh()
  const g = loadMemoryGraph()
  toast.success('已从表格投影', `节点 ${g.nodes.length} · 边 ${g.edges.length}`)
}

function selectNode(n: MemoryGraphNode) {
  selectedId.value = n.id
  tab.value = 'nodes'
}

function selectEdgeEndpoint(edge: MemoryGraphEdge, which: 'from' | 'to') {
  selectedId.value = which === 'from' ? edge.from : edge.to
  tab.value = 'nodes'
}

function injectSelected() {
  const n = selectedNode.value
  if (!n) {
    toast.warn('未选节点', '请先点选一个节点')
    return
  }
  const slice = getMemoryGraphSlice(graph.value, n.name)
  const brief = formatMemoryGraphSliceBrief(slice) || n.name
  const lines: string[] = [`【叙事图谱·${KIND_LABEL[n.kind] || n.kind}】${n.name}`]
  for (const a of selectedAttrs.value.slice(0, 8)) {
    lines.push(`${a.k}：${a.v}`)
  }
  for (const e of slice.edges.slice(0, 6)) {
    lines.push(
      `关系 ${e.direction === 'out' ? '→' : '←'} ${e.otherName}〔${e.type}〕${e.note ? ` · ${e.note}` : ''}`,
    )
  }
  for (const b of (n.beats || []).slice(0, 4)) {
    const cal =
      b.year != null
        ? `（${b.year}年${b.season || ''}）`
        : ''
    lines.push(`近事：${b.text}${cal}`)
  }
  injectContext(`叙事图谱 · ${n.name}`, lines.join('\n').slice(0, 1800) || brief)
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
  })
  if (!picked.nodeCount) {
    toast.warn('暂无命中', '图谱为空或无法选取')
    return
  }
  injectContext(
    `叙事图谱 · 规则选取 ${picked.names.slice(0, 4).join('、')}`,
    picked.text,
  )
  focusTianji()
  toast.success(
    '已注入选取',
    `${picked.nodeCount} 节点：${picked.names.slice(0, 6).join('、')}`,
  )
}

function kindLabel(k: MemoryGraphNodeKind) {
  return KIND_LABEL[k] || k
}
</script>

<template>
  <div id="view-memory-graph" class="view">
    <div class="section-head">
      <div>
        <h2><span class="ornament" />叙事图谱</h2>
        <p class="section-desc">
          节点 · 关系边 · 近事 beats。来自正文记忆与表格投影，与经营「关系网」分离；回合前可规则选取注入天机。
        </p>
      </div>
      <div class="section-actions">
        <button
          id="btn-mg-sync"
          class="btn btn-soft"
          type="button"
          @click="syncFromTables"
        >
          <Icon name="spark" :size="16" /> 从表格刷新
        </button>
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
          <Icon name="send" :size="16" /> 注入本节点
        </button>
      </div>
    </div>

    <div class="stats-row panel-card">
      <div class="stat">
        <strong>{{ stats.nodes }}</strong>
        <span>节点</span>
      </div>
      <div class="stat">
        <strong>{{ stats.edges }}</strong>
        <span>关系边</span>
      </div>
      <div class="stat">
        <strong>{{ stats.beats }}</strong>
        <span>近事</span>
      </div>
      <div class="stat kinds">
        <span
          v-for="(label, kind) in KIND_LABEL"
          :key="kind"
          class="tag"
          :class="[KIND_TAG[kind as MemoryGraphNodeKind], { dim: !(stats.byKind[kind] > 0) }]"
        >
          {{ label }} {{ stats.byKind[kind] || 0 }}
        </span>
      </div>
    </div>

    <div class="toolbar panel-card">
      <div class="tabs">
        <button
          type="button"
          class="tab"
          :class="{ active: tab === 'nodes' }"
          @click="tab = 'nodes'"
        >
          节点 {{ filteredNodes.length }}
        </button>
        <button
          type="button"
          class="tab"
          :class="{ active: tab === 'edges' }"
          @click="tab = 'edges'"
        >
          边 {{ filteredEdges.length }}
        </button>
      </div>
      <div class="filters">
        <select v-model="kindFilter" id="mg-kind-filter" class="filter-select">
          <option value="all">全部类型</option>
          <option v-for="(label, kind) in KIND_LABEL" :key="kind" :value="kind">
            {{ label }}
          </option>
        </select>
        <input
          id="mg-search"
          v-model="search"
          type="search"
          class="filter-search"
          placeholder="搜索名称、属性、近事…"
        />
      </div>
    </div>

    <div v-if="!stats.nodes" class="panel-card empty-state">
      <Icon name="memory-graph" :size="28" />
      <div>
        <strong>图谱尚空</strong>
        <p class="muted">
          通灵正文写入角色档案 / &lt;memory&gt; 标签后会自动生长；也可点「从表格刷新」投影已有表格记忆。
        </p>
      </div>
    </div>

    <div v-else class="mg-layout">
      <div class="mg-list stagger">
        <template v-if="tab === 'nodes'">
          <article
            v-for="n in filteredNodes"
            :id="`mg-node-${n.id}`"
            :key="n.id"
            class="panel-card node-card interactive"
            :class="{ active: selectedId === n.id }"
            @click="selectNode(n)"
          >
            <header>
              <h3>{{ n.name }}</h3>
              <span class="tag" :class="KIND_TAG[n.kind]">{{ kindLabel(n.kind) }}</span>
            </header>
            <p class="muted line-clamp">
              {{
                formatMemoryGraphSliceBrief(getMemoryGraphSlice(graph, n.name)) ||
                Object.values(n.attrs || {}).slice(0, 2).join(' · ') ||
                (n.beats?.[0]?.text ?? '暂无摘要')
              }}
            </p>
            <footer>
              <span>{{ (n.beats || []).length }} 近事</span>
              <span>{{ getMemoryGraphSlice(graph, n.name).edges.length }} 边</span>
            </footer>
          </article>
          <p v-if="!filteredNodes.length" class="muted pad">无匹配节点</p>
        </template>

        <template v-else>
          <article
            v-for="e in filteredEdges"
            :id="`mg-edge-${e.id}`"
            :key="e.id"
            class="panel-card edge-card interactive"
            @click="selectEdgeEndpoint(e, 'from')"
          >
            <div class="edge-people">
              <button type="button" class="person-link" @click.stop="selectEdgeEndpoint(e, 'from')">
                {{ nameById.get(e.from) || e.from }}
              </button>
              <span class="tag" :class="typeClass[e.type] || 'tag-rose'">{{ e.type }}</span>
              <button type="button" class="person-link" @click.stop="selectEdgeEndpoint(e, 'to')">
                {{ nameById.get(e.to) || e.to }}
              </button>
            </div>
            <p v-if="e.note" class="muted">{{ e.note }}</p>
          </article>
          <p v-if="!filteredEdges.length" class="muted pad">无匹配关系边</p>
        </template>
      </div>

      <aside v-if="selectedNode && selectedSlice" class="mg-detail panel-card" id="mg-detail">
        <header class="detail-head">
          <div>
            <h3>{{ selectedNode.name }}</h3>
            <span class="tag" :class="KIND_TAG[selectedNode.kind]">
              {{ kindLabel(selectedNode.kind) }}
            </span>
          </div>
          <button class="btn btn-soft btn-sm" type="button" @click="injectSelected">
            注入
          </button>
        </header>

        <section v-if="selectedAttrs.length" class="detail-block">
          <h4>属性</h4>
          <div class="attrs">
            <div v-for="a in selectedAttrs" :key="a.k" class="attr">
              <label>{{ a.k }}</label>
              <span>{{ a.v }}</span>
            </div>
          </div>
        </section>

        <section v-if="selectedSlice.edges.length" class="detail-block">
          <h4>关系边（{{ selectedSlice.edges.length }}）</h4>
          <ul class="edge-list">
            <li v-for="e in selectedSlice.edges" :key="e.id">
              <span class="tag" :class="typeClass[e.type] || 'tag-rose'">{{ e.type }}</span>
              {{ e.direction === 'out' ? '→' : '←' }}
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

        <section v-if="selectedNode.beats?.length" class="detail-block">
          <h4>近事（{{ selectedNode.beats.length }}）</h4>
          <ul class="beat-list">
            <li v-for="b in selectedNode.beats" :key="b.id">
              <span
                v-if="b.year != null"
                class="beat-cal muted"
              >{{ b.year }}年{{ b.season || '' }}</span>
              {{ b.text }}
            </li>
          </ul>
        </section>

        <p
          v-if="
            !selectedAttrs.length &&
            !selectedSlice.edges.length &&
            !selectedNode.beats?.length
          "
          class="muted"
        >
          此节点尚无属性、边或近事。
        </p>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.section-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

.stats-row {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem 1.25rem;
  align-items: center;
  padding: 0.85rem 1.1rem;
  margin-top: 0.25rem;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 3.5rem;
}

.stat strong {
  font-family: var(--font-display);
  font-size: 1.15rem;
  font-variant-numeric: tabular-nums;
}

.stat span {
  font-size: 0.75rem;
  color: var(--ink-muted);
}

.stat.kinds {
  flex-direction: row;
  flex-wrap: wrap;
  gap: 0.35rem;
  flex: 1;
  min-width: 12rem;
}

.stat.kinds .dim {
  opacity: 0.45;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
  padding: 0.65rem 1rem;
  margin-top: 0.75rem;
}

.tabs {
  display: flex;
  gap: 0.35rem;
}

.tab {
  border: 1px solid transparent;
  background: transparent;
  color: var(--ink-secondary);
  padding: 0.35rem 0.75rem;
  border-radius: 999px;
  font-size: 0.86rem;
  cursor: pointer;
}

.tab.active {
  background: color-mix(in srgb, var(--accent, #7b6bb0) 14%, transparent);
  border-color: color-mix(in srgb, var(--accent, #7b6bb0) 35%, transparent);
  color: var(--ink-primary);
  font-weight: 600;
}

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  flex: 1;
  justify-content: flex-end;
}

.filter-select,
.filter-search {
  border: 1px solid color-mix(in srgb, var(--ink-muted) 28%, transparent);
  background: color-mix(in srgb, var(--panel, #1a1624) 40%, transparent);
  color: var(--ink-primary);
  border-radius: 0.5rem;
  padding: 0.4rem 0.65rem;
  font-size: 0.86rem;
}

.filter-search {
  min-width: 12rem;
  flex: 1;
  max-width: 18rem;
}

.empty-state {
  margin-top: 1rem;
  display: flex;
  gap: 1rem;
  align-items: flex-start;
  padding: 1.25rem 1.35rem;
}

.empty-state p {
  margin: 0.35rem 0 0;
  line-height: 1.55;
  font-size: 0.9rem;
}

.mg-layout {
  margin-top: 1rem;
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(280px, 0.9fr);
  gap: 0.9rem;
  align-items: start;
}

.mg-list {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  max-height: min(70vh, 820px);
  overflow: auto;
  padding-right: 0.15rem;
}

.node-card,
.edge-card {
  padding: 0.9rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.node-card.active {
  outline: 1px solid color-mix(in srgb, var(--accent, #7b6bb0) 55%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent, #7b6bb0) 20%, transparent);
}

.node-card header,
.detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.node-card h3,
.detail-head h3 {
  margin: 0;
  font-size: 1rem;
  font-family: var(--font-display);
}

.line-clamp {
  font-size: 0.84rem;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin: 0;
}

.node-card footer {
  display: flex;
  gap: 0.85rem;
  font-size: 0.75rem;
  color: var(--ink-muted);
}

.edge-people {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.45rem;
  flex-wrap: wrap;
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
}

.person-link:hover {
  color: var(--accent, #9b8ad4);
  text-decoration: underline;
}

.edge-card p {
  margin: 0;
  font-size: 0.84rem;
  line-height: 1.45;
}

.mg-detail {
  position: sticky;
  top: 0.5rem;
  padding: 1.05rem 1.15rem;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  max-height: min(70vh, 820px);
  overflow: auto;
}

.detail-block h4 {
  margin: 0 0 0.45rem;
  font-size: 0.78rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ink-muted);
  font-weight: 600;
}

.attrs {
  display: grid;
  gap: 0.4rem;
}

.attr {
  display: grid;
  grid-template-columns: 5.5rem 1fr;
  gap: 0.4rem;
  font-size: 0.86rem;
}

.attr label {
  color: var(--ink-muted);
}

.edge-list,
.beat-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  font-size: 0.86rem;
  line-height: 1.45;
}

.beat-cal {
  display: inline-block;
  margin-right: 0.35rem;
  font-size: 0.75rem;
}

.pad {
  padding: 0.75rem;
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

  .filter-search {
    max-width: none;
  }
}
</style>
