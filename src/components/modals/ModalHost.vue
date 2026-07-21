<script setup lang="ts">
import { computed } from 'vue'
import ModalFrame from '@/components/ui/ModalFrame.vue'
import Icon from '@/components/ui/Icon.vue'
import { useModal } from '@/composables/useModal'
import { useToast } from '@/composables/useToast'
import { useGameState } from '@/composables/useGameState'
import { useTianji } from '@/composables/useTianji'
import {
  urgentEvents,
  disciples,
  alchemyRecipes,
  forgeQueue,
  manuals,
  treasures,
  fieldPlots,
  cities,
  factions,
  heirs,
  relationEdges,
} from '@/data/mock'

const { stack, close } = useModal()
const toast = useToast()
const { adjustResource, setDesignatedHeir, advanceSeason, setView, focusTianji } = useGameState()
const { injectContext, pushEvent, sendPlayer } = useTianji()

const top = computed(() => stack.value[stack.value.length - 1] ?? null)

function p<T = string>(key: string) {
  return top.value?.props?.[key] as T
}

const event = computed(() => urgentEvents.find((e) => e.id === p('eventId')))
const disciple = computed(() => disciples.find((d) => d.id === p('discipleId')))
const recipe = computed(() => alchemyRecipes.find((a) => a.id === p('recipeId')))
const forge = computed(() => forgeQueue.find((g) => g.id === p('forgeId')))
const manual = computed(() => manuals.find((m) => m.id === p('manualId')))
const treasure = computed(() => treasures.find((t) => t.id === p('treasureId')))
const field = computed(() => fieldPlots.find((f) => f.id === p('fieldId')))
const city = computed(() => cities.find((c) => c.id === p('cityId')))
const faction = computed(() => factions.find((f) => f.id === p('factionId')))
const heir = computed(() => heirs.find((h) => h.id === p('heirId')))
const relation = computed(() => relationEdges.find((r) => r.id === p('relationId')))

function resolveName(id: string) {
  if (id === '沈青岚') return id
  return disciples.find((d) => d.id === id)?.name ?? id
}

function onEventChoice(choiceId: string) {
  const e = event.value
  if (!e) return
  const c = e.choices.find((x) => x.id === choiceId)
  if (!c) return
  if (choiceId === 'c3') {
    injectContext('赤焰谷使者', e.summary)
    pushEvent(`掌门选择：${c.label}。使者已延入侧殿，对谈即将展开。`, '赤焰谷')
    focusTianji()
    toast.info('已转入天机交涉', c.label)
  } else {
    toast.success('决策已生效', `${c.label} — ${c.effect}`)
    pushEvent(`【决议】${e.title}：${c.label}（${c.effect}）`, e.title)
  }
  close()
}

function craftPill() {
  const r = recipe.value
  if (!r) return
  adjustResource({ herb: -r.cost.herb, spiritStone: -r.cost.spiritStone })
  toast.success('开炉成功', `${r.name} 已入丹房库存（原型模拟）`)
  close()
}

function assignField(name: string) {
  toast.success('指派完成', `${field.value?.name ?? '灵田'} 交由 ${name} 打理`)
  close()
}

function talkFaction(mode: string) {
  const f = faction.value
  if (!f) return
  injectContext(f.name, f.recent)
  sendPlayer(`对【${f.name}】采取：${mode}`)
  focusTianji()
  toast.info('外交议题已注入天机', mode)
  close()
}

function confirmHeir() {
  const h = heir.value
  if (!h) return
  setDesignatedHeir(h.id)
  toast.success('已指定继承人', `${h.name} 暂为储君之选`)
  pushEvent(`掌门指定 ${h.name} 为继位观察人选。宗门议论纷纷。`, '继位')
  close()
}

function doAdvanceSeason() {
  advanceSeason()
  toast.success('岁月流转', '新一季已至，资源与事务已刷新（原型）')
  pushEvent('【岁月】季节更迭，灵田结实，外敌亦在暗中窥伺。')
  close()
  setView('hall')
}
</script>

<template>
  <Teleport to="body">
    <!-- 事件 -->
    <ModalFrame
      v-if="top?.id === 'event-detail' && event"
      id="modal-event-detail"
      :title="event.title"
      :subtitle="`${event.source} · ${event.timeLabel}`"
      width="600px"
      @close="close"
    >
      <div class="event-body">
        <span
          class="tag"
          :class="{
            'tag-rose': event.severity === 'critical',
            'tag-amber': event.severity === 'warn',
            'tag-moon': event.severity === 'info',
          }"
        >
          {{ event.severity === 'critical' ? '紧急' : event.severity === 'warn' ? '警示' : '寻常' }}
        </span>
        <p class="lead">{{ event.summary }}</p>
        <div class="choice-list">
          <button
            v-for="c in event.choices"
            :id="`event-choice-${c.id}`"
            :key="c.id"
            type="button"
            class="choice-card"
            @click="onEventChoice(c.id)"
          >
            <strong>{{ c.label }}</strong>
            <span>效果：{{ c.effect }}</span>
            <span v-if="c.risk" class="risk">风险：{{ c.risk }}</span>
          </button>
        </div>
      </div>
      <template #footer>
        <button id="modal-event-cancel" class="btn btn-ghost" type="button" @click="close">稍后处理</button>
      </template>
    </ModalFrame>

    <!-- 弟子 -->
    <ModalFrame
      v-else-if="top?.id === 'disciple-detail' && disciple"
      id="modal-disciple-detail"
      :title="disciple.name"
      :subtitle="`${disciple.role} · ${disciple.realm}`"
      width="520px"
      @close="close"
    >
      <div class="disciple-modal">
        <div
          class="avatar-lg"
          :style="{ background: `linear-gradient(145deg, hsl(${disciple.avatarHue} 45% 78%), hsl(${disciple.avatarHue} 35% 88%))` }"
        >
          {{ disciple.name.slice(0, 1) }}
        </div>
        <div class="kv-grid">
          <div><label>性别年龄</label><span>{{ disciple.gender }} · {{ disciple.age }} 岁</span></div>
          <div><label>资质</label><span>{{ disciple.aptitude }}</span></div>
          <div><label>忠诚</label><span>{{ disciple.loyalty }}</span></div>
          <div><label>心境</label><span>{{ disciple.mood }}</span></div>
          <div><label>状态</label><span>{{ disciple.status }}</span></div>
          <div><label>道侣</label><span>{{ disciple.spouse ? resolveName(disciple.spouse) : '无' }}</span></div>
        </div>
        <div class="talent-row">
          <span v-for="t in disciple.talent" :key="t" class="tag tag-jade">{{ t }}</span>
        </div>
        <p class="muted">
          可作为外勤、管事或亲传候选。深层互动（训诫、赐丹、联姻）将通过天机卷轴叙事完成。
        </p>
      </div>
      <template #footer>
        <button
          id="btn-disciple-to-tianji"
          class="btn btn-soft"
          type="button"
          @click="injectContext(disciple.name, `${disciple.role}，${disciple.mood}`); focusTianji(); close()"
        >
          注入天机
        </button>
        <button id="btn-disciple-close" class="btn btn-primary" type="button" @click="close">关闭</button>
      </template>
    </ModalFrame>

    <!-- 炼丹 -->
    <ModalFrame
      v-else-if="top?.id === 'alchemy-craft' && recipe"
      id="modal-alchemy-craft"
      :title="`开炉 · ${recipe.name}`"
      :subtitle="`${recipe.grade} · 预计 ${recipe.time}`"
      @close="close"
    >
      <div class="craft-body">
        <p>{{ recipe.effect }}</p>
        <div class="kv-grid">
          <div><label>丹材消耗</label><span>{{ recipe.cost.herb }}</span></div>
          <div><label>灵石消耗</label><span>{{ recipe.cost.spiritStone }}</span></div>
          <div><label>成功率</label><span>{{ recipe.successRate }}%</span></div>
          <div><label>库存</label><span>{{ recipe.stock }} 枚</span></div>
        </div>
        <div class="progress-track" style="margin-top: 1rem">
          <div class="progress-fill" :style="{ width: recipe.successRate + '%' }" />
        </div>
      </div>
      <template #footer>
        <button id="btn-alchemy-cancel" class="btn btn-ghost" type="button" @click="close">取消</button>
        <button id="btn-alchemy-craft" class="btn btn-primary" type="button" @click="craftPill">
          <Icon name="alchemy" :size="16" /> 开始炼制
        </button>
      </template>
    </ModalFrame>

    <!-- 锻器 -->
    <ModalFrame
      v-else-if="top?.id === 'forge-detail' && forge"
      id="modal-forge-detail"
      :title="forge.name"
      :subtitle="`${forge.type} · ${forge.grade}`"
      @close="close"
    >
      <div class="kv-grid">
        <div><label>进度</label><span>{{ forge.progress }}%</span></div>
        <div><label>匠人</label><span>{{ forge.craftsman ?? '待指派' }}</span></div>
        <div><label>材料</label><span>{{ forge.materials }}</span></div>
        <div><label>特性</label><span>{{ forge.power }}</span></div>
      </div>
      <div class="progress-track" style="margin-top: 1rem">
        <div class="progress-fill" :style="{ width: forge.progress + '%' }" />
      </div>
      <template #footer>
        <button
          id="btn-forge-tianji"
          class="btn btn-soft"
          type="button"
          @click="injectContext('锻器', forge.name); focusTianji(); close()"
        >
          问天机
        </button>
        <button id="btn-forge-close" class="btn btn-primary" type="button" @click="close">关闭</button>
      </template>
    </ModalFrame>

    <!-- 秘籍 -->
    <ModalFrame
      v-else-if="top?.id === 'manual-detail' && manual"
      id="modal-manual-detail"
      :title="manual.name"
      :subtitle="`${manual.school} · ${manual.grade}`"
      @close="close"
    >
      <div class="kv-grid">
        <div><label>阅览限制</label><span>{{ manual.restriction }}</span></div>
        <div><label>在研弟子</label><span>{{ manual.readers }} 人</span></div>
        <div><label>洞见</label><span>{{ manual.insight }}</span></div>
        <div><label>状态</label><span>{{ manual.sealed ? '封印中' : '可阅' }}</span></div>
      </div>
      <p v-if="manual.sealed" class="muted" style="margin-top: 0.85rem">
        封印秘籍需气运与机缘。可在天机卷轴中推演开封条件。
      </p>
      <template #footer>
        <button
          id="btn-manual-tianji"
          class="btn btn-soft"
          type="button"
          @click="injectContext('藏经', manual.name); focusTianji(); close()"
        >
          推演秘籍
        </button>
        <button id="btn-manual-close" class="btn btn-primary" type="button" @click="close">关闭</button>
      </template>
    </ModalFrame>

    <!-- 法宝 -->
    <ModalFrame
      v-else-if="top?.id === 'treasure-detail' && treasure"
      id="modal-treasure-detail"
      :title="treasure.name"
      :subtitle="`${treasure.type} · ${treasure.grade}`"
      @close="close"
    >
      <p class="lead">{{ treasure.desc }}</p>
      <div class="kv-grid" style="margin-top: 0.85rem">
        <div><label>持有者</label><span>{{ treasure.owner ?? '库藏' }}</span></div>
        <div><label>绑定</label><span>{{ treasure.bound ? '已绑定' : '可转交' }}</span></div>
      </div>
    </ModalFrame>

    <!-- 灵田指派 -->
    <ModalFrame
      v-else-if="top?.id === 'field-assign' && field"
      id="modal-field-assign"
      :title="`指派 · ${field.name}`"
      :subtitle="`${field.grade} · ${field.crop}`"
      @close="close"
    >
      <p class="muted" style="margin-bottom: 0.85rem">选择弟子打理此田（原型仅提示，不改写源数据）。</p>
      <div class="assign-list">
        <button
          v-for="name in ['林晚舟', '赵阿禾', '苏青棠', '沈微']"
          :id="`assign-${name}`"
          :key="name"
          type="button"
          class="choice-card"
          @click="assignField(name)"
        >
          <strong>{{ name }}</strong>
          <span>{{ field.assigned === name ? '当前管事' : '可指派' }}</span>
        </button>
      </div>
      <template #footer>
        <button id="btn-field-cancel" class="btn btn-ghost" type="button" @click="close">取消</button>
      </template>
    </ModalFrame>

    <!-- 城池 -->
    <ModalFrame
      v-else-if="top?.id === 'city-detail' && city"
      id="modal-city-detail"
      :title="city.name"
      :subtitle="city.distance"
      @close="close"
    >
      <p class="lead">{{ city.notes }}</p>
      <div class="kv-grid" style="margin-top: 0.85rem">
        <div><label>影响力</label><span>{{ city.influence }}</span></div>
        <div><label>态度</label><span>{{ city.attitude }}</span></div>
        <div><label>主事</label><span>{{ city.governor }}</span></div>
        <div>
          <label>纳贡</label>
          <span>{{ city.tribute.type }} {{ city.tribute.amount }} / {{ city.tribute.period }}</span>
        </div>
      </div>
      <div class="progress-track" style="margin-top: 1rem">
        <div class="progress-fill" :style="{ width: city.influence + '%' }" />
      </div>
      <template #footer>
        <button
          id="btn-city-tianji"
          class="btn btn-soft"
          type="button"
          @click="injectContext(city.name, city.notes); focusTianji(); close()"
        >
          商议城务
        </button>
        <button
          id="btn-city-tribute"
          class="btn btn-primary"
          type="button"
          @click="toast.success('催缴已发', `${city.name} 将在旬日内答复`); close()"
        >
          催缴纳贡
        </button>
      </template>
    </ModalFrame>

    <!-- 势力 -->
    <ModalFrame
      v-else-if="top?.id === 'faction-talk' && faction"
      id="modal-faction-talk"
      :title="faction.name"
      :subtitle="`${faction.power} · ${faction.stance}`"
      width="560px"
      @close="close"
    >
      <p class="lead">{{ faction.recent }}</p>
      <p v-if="faction.demand" class="demand">对方诉求：{{ faction.demand }}</p>
      <div class="choice-list" style="margin-top: 1rem">
        <button id="faction-opt-ally" type="button" class="choice-card" @click="talkFaction('示好结盟')">
          <strong>示好结盟</strong><span>以利换安，或结为外援</span>
        </button>
        <button id="faction-opt-hard" type="button" class="choice-card" @click="talkFaction('强硬回绝')">
          <strong>强硬回绝</strong><span>守住底线，或激化矛盾</span>
        </button>
        <button id="faction-opt-delay" type="button" class="choice-card" @click="talkFaction('拖延观望')">
          <strong>拖延观望</strong><span>以时间换空间</span>
        </button>
      </div>
      <template #footer>
        <button id="btn-faction-close" class="btn btn-ghost" type="button" @click="close">关闭</button>
      </template>
    </ModalFrame>

    <!-- 继位 -->
    <ModalFrame
      v-else-if="top?.id === 'heir-confirm' && heir"
      id="modal-heir-confirm"
      :title="`指定继承人 · ${heir.name}`"
      subtitle="此举将影响弟子站队与外部观感"
      @close="close"
    >
      <div class="kv-grid">
        <div><label>综合评分</label><span>{{ heir.score }}</span></div>
        <div><label>支持度</label><span>{{ heir.support }}%</span></div>
      </div>
      <div class="two-col" style="margin-top: 0.85rem">
        <div>
          <h4>长处</h4>
          <ul>
            <li v-for="s in heir.strengths" :key="s">{{ s }}</li>
          </ul>
        </div>
        <div>
          <h4>隐患</h4>
          <ul>
            <li v-for="r in heir.risks" :key="r">{{ r }}</li>
          </ul>
        </div>
      </div>
      <template #footer>
        <button id="btn-heir-cancel" class="btn btn-ghost" type="button" @click="close">再议</button>
        <button id="btn-heir-confirm" class="btn btn-primary" type="button" @click="confirmHeir">确认指定</button>
      </template>
    </ModalFrame>

    <!-- 关系 -->
    <ModalFrame
      v-else-if="top?.id === 'relation-detail' && relation"
      id="modal-relation-detail"
      :title="`${resolveName(relation.from)} · ${relation.type} · ${resolveName(relation.to)}`"
      :subtitle="`强度 ${relation.intensity}`"
      @close="close"
    >
      <p class="lead">{{ relation.note }}</p>
      <div class="progress-track" style="margin-top: 1rem">
        <div
          class="progress-fill"
          :style="{
            width: relation.intensity + '%',
            background:
              relation.type === '仇恨'
                ? 'linear-gradient(90deg, #d08090, #c06b7a)'
                : relation.type === '道侣'
                  ? 'linear-gradient(90deg, #c090b0, #a070a0)'
                  : undefined,
          }"
        />
      </div>
      <template #footer>
        <button
          id="btn-relation-tianji"
          class="btn btn-soft"
          type="button"
          @click="injectContext('弟子关系', relation.note); focusTianji(); close()"
        >
          调解/推演
        </button>
        <button id="btn-relation-close" class="btn btn-primary" type="button" @click="close">关闭</button>
      </template>
    </ModalFrame>

    <!-- 岁月 -->
    <ModalFrame
      v-else-if="top?.id === 'season-advance'"
      id="modal-season-advance"
      title="推进季节"
      subtitle="将结算本季产出与事件（原型简化）"
      @close="close"
    >
      <p class="lead">
        确认后进入下一季：灵谷入账、部分资源维护扣除，并可能触发新的外交与人事事件。重大抉择建议先在天机卷轴中推演。
      </p>
      <template #footer>
        <button id="btn-season-cancel" class="btn btn-ghost" type="button" @click="close">取消</button>
        <button id="btn-season-confirm" class="btn btn-primary" type="button" @click="doAdvanceSeason">
          确认流转
        </button>
      </template>
    </ModalFrame>
  </Teleport>
</template>

<style scoped>
.lead {
  font-size: 0.95rem;
  line-height: 1.7;
  color: var(--ink-secondary);
  margin-top: 0.65rem;
}

.choice-list,
.assign-list {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  margin-top: 1rem;
}

.choice-card {
  text-align: left;
  padding: 0.85rem 1rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  background: rgba(255, 255, 255, 0.7);
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  transition: all var(--dur-fast) var(--ease-out);
}

.choice-card:hover {
  border-color: var(--border-moon);
  box-shadow: var(--shadow-glow);
  transform: translateX(3px);
}

.choice-card strong {
  font-size: 0.92rem;
}

.choice-card span {
  font-size: 0.8rem;
  color: var(--ink-muted);
}

.choice-card .risk {
  color: var(--amber);
}

.kv-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.kv-grid label {
  display: block;
  font-size: 0.72rem;
  color: var(--ink-muted);
  margin-bottom: 0.15rem;
}

.kv-grid span {
  font-size: 0.9rem;
  font-weight: 500;
}

.disciple-modal {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.avatar-lg {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-family: var(--font-display);
  font-size: 1.5rem;
  color: var(--ink-primary);
  border: 2px solid rgba(255, 255, 255, 0.8);
  box-shadow: var(--shadow-md);
}

.talent-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  justify-content: center;
}

.demand {
  margin-top: 0.65rem;
  padding: 0.65rem 0.85rem;
  border-radius: var(--radius-sm);
  background: var(--amber-soft);
  color: var(--amber);
  font-size: 0.88rem;
  border: 1px solid rgba(196, 149, 74, 0.25);
}

.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.two-col h4 {
  font-size: 0.85rem;
  margin-bottom: 0.4rem;
  color: var(--ink-secondary);
}

.two-col li {
  font-size: 0.85rem;
  padding: 0.3rem 0;
  color: var(--ink-secondary);
  border-bottom: 1px dashed var(--border-subtle);
}
</style>
