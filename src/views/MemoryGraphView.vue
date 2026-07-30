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
import { useToast } from '@/composables/useToast'

const { injectContext } = useTianji()
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
  // 清理：把历史遗留的「掌门/本座/宗主」称呼节点合并到自定义名
  if (masterName.value) {
    for (const t of ['掌门', '本座', '宗主']) {
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
    // 称呼节点也一并归一
    if (newName) {
      for (const t of ['掌门', '本座', '宗主']) {
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

    <div class="stats-row panel-card">
      <div class="stat">
        <strong>{{ stats.characters }}</strong>
        <span>角色</span>
      </div>
      <div class="stat">
        <strong>{{ stats.beats }}</strong>
        <span>热近事</span>
      </div>
      <div class="stat">
        <strong>{{ stats.archive }}</strong>
        <span>冷档案</span>
      </div>
      <div class="stat">
        <strong>{{ stats.edges }}</strong>
        <span>关系边</span>
      </div>
      <div v-if="stats.extras" class="stat">
        <strong>{{ stats.extras }}</strong>
        <span>物/地/事</span>
      </div>
    </div>

    <div class="toolbar panel-card">
      <input
        id="mg-search"
        v-model="search"
        type="search"
        class="filter-search"
        placeholder="搜角色名、属性、近事…"
      />
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

    <div v-if="!stats.characters" class="panel-card empty-state">
      <Icon name="memory-graph" :size="28" />
      <div>
        <strong>尚无角色记忆</strong>
        <p class="muted">
          名册有弟子时会自动建空节点。通灵写
          &lt;memory&gt;角色名|做了什么&lt;/memory&gt;，或正文出现人名时兜底记近事；也可在有角色后于右侧手改。
        </p>
      </div>
    </div>

    <div v-else class="mg-layout">
      <div class="mg-list stagger">
        <article
          v-for="n in filteredCharacters"
          :id="`mg-node-${n.id}`"
          :key="n.id"
          class="panel-card node-card interactive"
          :class="{ active: selectedId === n.id }"
          @click="selectNode(n)"
        >
          <header>
            <h3>{{ n.name }}</h3>
            <span class="tag tag-moon">角色</span>
          </header>
          <p class="muted line-clamp">{{ cardBrief(n) }}</p>
          <footer>
            <span>{{ (n.beats || []).length }} 近事</span>
            <span>{{ getMemoryGraphSlice(graph, n.name).edges.length }} 关系</span>
            <span v-if="n.attrs?.['身份']" class="dim">{{ n.attrs['身份'] }}</span>
          </footer>
        </article>
        <p v-if="!filteredCharacters.length" class="muted pad">无匹配角色</p>

        <template v-if="showExtras && extras.length">
          <p class="list-sep muted">物 / 地 / 事</p>
          <article
            v-for="n in extras"
            :id="`mg-node-${n.id}`"
            :key="n.id"
            class="panel-card node-card interactive extra"
            :class="{ active: selectedId === n.id }"
            @click="selectNode(n)"
          >
            <header>
              <h3>{{ n.name }}</h3>
              <span class="tag tag-amber">{{ n.kind }}</span>
            </header>
            <p class="muted line-clamp">{{ cardBrief(n) }}</p>
          </article>
        </template>
      </div>

      <aside v-if="selectedNode && selectedSlice" class="mg-detail panel-card" id="mg-detail">
        <header class="detail-head">
          <div>
            <h3>{{ selectedNode.name }}</h3>
            <span class="tag" :class="selectedNode.kind === 'character' ? 'tag-moon' : 'tag-amber'">
              {{ selectedNode.kind === 'character' ? '角色' : selectedNode.kind }}
            </span>
          </div>
          <button class="btn btn-soft btn-sm" type="button" @click="injectSelected">
            注入
          </button>
        </header>

        <section class="detail-block">
          <h4>近事（{{ selectedNode.beats?.length || 0 }}）</h4>
          <ul v-if="selectedNode.beats?.length" class="beat-list">
            <li v-for="b in selectedNode.beats" :key="b.id" class="beat-row">
              <div>
                <span v-if="b.year != null" class="beat-cal muted"
                  >{{ b.year }}年{{ b.season || '' }}</span
                >
                {{ b.text }}
              </div>
              <button type="button" class="btn btn-ghost btn-sm" @click="dropBeat(b.id)">
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
          <h4>关系（{{ selectedSlice.edges.length }}）</h4>
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

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  padding: 0.65rem 1rem;
  margin-top: 0.75rem;
}

.filter-search {
  border: 1px solid color-mix(in srgb, var(--ink-muted) 28%, transparent);
  background: color-mix(in srgb, var(--panel, #1a1624) 40%, transparent);
  color: var(--ink-primary);
  border-radius: 0.5rem;
  padding: 0.4rem 0.65rem;
  font-size: 0.86rem;
  min-width: 12rem;
  flex: 1;
  max-width: 22rem;
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

.list-sep {
  margin: 0.5rem 0 0.15rem;
  font-size: 0.78rem;
  letter-spacing: 0.04em;
}

.node-card {
  padding: 0.9rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.node-card.extra {
  opacity: 0.92;
}

.node-card.active {
  outline: 1px solid color-mix(in srgb, var(--accent, #7b6bb0) 55%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent, #7b6bb0) 20%, transparent);
}

.edit-row {
  display: flex;
  gap: 0.45rem;
  align-items: center;
  margin-top: 0.5rem;
}

.edit-row .filter-search {
  flex: 1;
  max-width: none;
  min-width: 0;
}

.beat-row {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  align-items: flex-start;
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

.node-card footer .dim {
  opacity: 0.85;
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
