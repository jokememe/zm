/**
 * 表格记忆提示词 — 实体表沿用 yuzuki 结构；
 * 纪要表 / 合并 对齐 AlbusKen/shujuku@mov5.5（客观轮次日志，非空泛摘要）。
 */
import {
  cleanColumnName,
  createDefaultTableMemoryState,
  formatWorldStateInjection,
  type TableMemoryState,
} from '@/composables/table-memory'

/** shujuku 纪要正文：不少于约 300 字；合并后约 300～400 */
export const JOURNAL_BODY_MIN_CHARS = 300
export const JOURNAL_BODY_MERGE_MIN = 300
export const JOURNAL_BODY_MERGE_MAX = 400
/** shujuku 概要/概览：≤30 字 */
export const JOURNAL_SUMMARY_MAX_CHARS = 30

/**
 * 纪要表字段守则（移植自 shujuku DEFAULT 表 sourceData.note + 合并硬约束 C2/C3/C6/C7）
 */
export const SHUJUKU_JOURNAL_RULES = `【纪要表 · 对齐 shujuku mov5.5】
定位：轮次日志。有情节推进时本回合只 insert【一行】细纪要；禁止 update/delete 旧行；禁止手写 auto_merged。
列含义：
- 时间跨度：本轮事件的精确时间范围（如「秋 · 议事日午后」或正文给出的时辰）。
- 地点：从大到小（域/城/场所）。
- 纪要：以第三方视角客观记录本轮事件。
  · 不得加入推测、情绪化语言、负面解读或主观判断；
  · 必须基于正文明确发生的事实，不得补充未出现的情节；
  · 正文不少于约 ${JOURNAL_BODY_MIN_CHARS} 个中文字符；
  · 结尾禁止总结、升华、点评（禁止「可见…」「总之…」「为日后埋下…」之类）。
- 概要（亦称概览）：一句话概括纪要，≤${JOURNAL_SUMMARY_MAX_CHARS} 字，含关键专名便于检索。
- 编码索引：细行用 J0001…（可省略由系统分配）。勿写 A0001（旧习惯会归一成 J）。合并粗行由系统标 AM + auto_merged，模型勿写。
与 #剧情摘要：日常情节只写纪要表；剧情摘要仅弧光级事件偶发，禁止与纪要复述同一句。`

export const MEMORY_FORMAT_EXAMPLE = `#角色档案
[角色全名]|年龄：具体年龄|性别：男或女|身份：当前身份|性格：关键词|当前位置：具体地点|周围角色：同场角色|生理：状态|人际关系：{目标}：〔关系〕 · 〔情感〕|着装：衣物|待办事项：事项|约定：约定内容
#物品追踪
[物品稳定名称]|物品描述：外观用途|物品位置：位置|持有者：姓名|状态：完好或损坏或丢失|备注：依据
#世界设定
[设定词条名]|类型：组织或地点或规则|详细说明：已确认内容|影响范围：影响对象
#纪要表
[J0001]|时间跨度：本回午后|地点：宗门·议事厅|概要：赤焰谷使者索矿未果|纪要：赤焰谷使者二人持火纹令牌至山门，称奉谷主之命商议矿脉分润。掌门于议事厅接见，座中有长老三人旁听。使者陈述旧约与近岁产额，要求提高本谷分成并允许驻采。掌门对照宗卷后指出驻采条款并无成文，仅允短期互市粮药。使者颜色不善，仍收下文牒，约来春再议。掌门散会后令外门加强巡山，弟子不得私自与赤焰谷交易矿石。全过程无私斗，无当场破盟。`

export const FORMAT_EXAMPLE_WARNING = `【范例使用限制】
以下只说明字段顺序与分隔符。范例中的角色/物品/地点不是剧情事实，严禁照抄写入表格；无依据则不要输出该行。
纪要范例展示的是「客观流水」篇幅与口吻，请按本回正文重写，勿复制范例句子。`

/** 与 yuzuki TABLE_DEFINITIONS / DATABASE_SCHEMA 等价 + shujuku 纪要 */
export function buildTableDefinitionsText(
  state: TableMemoryState = createDefaultTableMemoryState(),
): string {
  const tables = state.tables || createDefaultTableMemoryState().tables
  const lines = tables.map((table) => {
    if (table.id === 'plot_summary') {
      return (
        '#剧情摘要：仅重大主线/支线转折时偶发写入（非每回合）；' +
        '格式 [主线]或[支线]|内容：一句弧光。日常情节请只写 #纪要表，勿与纪要表交替重复。'
      )
    }
    if (table.id === 'plot_journal') {
      return (
        `#纪要表：轮次客观日志；每回至多 1 行；主键=编码索引(J0001…)；` +
        `字段 时间跨度/地点/纪要(≥${JOURNAL_BODY_MIN_CHARS}字·第三方事实·禁升华)/概要(≤${JOURNAL_SUMMARY_MAX_CHARS}字)；` +
        `合并粗行系统生成 AM+auto_merged。`
      )
    }
    const columns = (table.columns || []).map(cleanColumnName).filter(Boolean)
    if (!columns.length) return `#${table.name}：包含`
    const fields = columns
      .map((column, index) => (index === 0 ? `${column}(主键)` : column))
      .join(', ')
    return `#${table.name}：包含 ${fields}`
  })
  return lines.filter(Boolean).join('\n')
}

/**
 * 追溯填表 system 守则：实体增量 + shujuku 纪要
 */
export function buildTraceRealtimePrompt(state?: TableMemoryState): string {
  const defs = buildTableDefinitionsText(state)
  return `你是记忆表格追溯引擎（实体表 yuzuki 增量 + 纪要表 shujuku 轮次日志）。根据本回合【玩家】与【剧情正文】，增量更新【当前世界状态参考】中的动态数据。

【更新守则】
1.必须使用 <Memory><!-- ... --></Memory> 包裹全部更新；注释符不可省略。
2.书写顺序：#表名 换行 [主键]|字段：值|字段：值 ；严禁使用数据库结构外的表名/字段名。
3.只输出本回合确定发生变化或新出现的内容；不得遗漏关键人物移动/易手/新设定，不得凭空捏造。
4.若【当前世界状态参考】中某角色已在 A 地，本回正文未写其移动，严禁改当前位置；有移动必须更新。
5.主键必须用 [] 包裹。不需要更新的字段严禁写出（含空值）；系统按主键局部合并。
6.角色全名必须稳定。若正文改名：主键写【新名】，并加字段 原名：旧名（系统并入同一行，禁止新旧名各建一条）。物品主键只写稳定名称，状态变化写「状态」字段，禁止把「破损的xx」当地主键。
7.除 <Memory> 外不要输出解释、Markdown、JSON 或其它标签。
8.有剧情推进时必须写 #纪要表 一行，并遵守下方纪要硬约束；无情节可只更新实体表或输出空 Memory。

${SHUJUKU_JOURNAL_RULES}

【数据库结构定义】
${defs}

【格式范例】
${FORMAT_EXAMPLE_WARNING}
<Memory><!--
${MEMORY_FORMAT_EXAMPLE}
--></Memory>

【字段要点】
#角色档案：新增角色须补年龄/性别/身份/性格；身份=社会或宗门职分；当前位置要具体；人际关系用 {目标}：〔关系〕 · 〔情感〕。
#物品追踪：只记关键信物/法宝/文书；流转必更持有者与位置；状态用完好/损坏/丢失/被盗等短词。
#世界设定：只记正文新确认的组织/地点/规则/事件；勿重复已有词条无变化字段。
#剧情摘要：默认不写。仅开宗、大战、破境、结盟破裂等弧光级事件才写 [主线]/[支线]。
#纪要表：优先根据【剧情正文】写满客观流水；【sum】只作线索不得代替正文事实；勿把 sum 原句当纪要全文。`
}

/** 主推演格式提示里追加的 Memory 段 */
export function buildMainFormatMemoryHint(state?: TableMemoryState): string {
  const defs = buildTableDefinitionsText(state)
  return `【表格记忆】
本回合正文结束后，若人物/物品/设定有变化，或有情节推进，必须在回复末尾追加：
<Memory><!--
#表名
[主键]|字段：值|字段：值
--></Memory>
规则：主键合并；只写变更字段；禁止空字段；表与字段必须属于下列结构。
情节流水只进 #纪要表（每回至多一行；纪要≥${JOURNAL_BODY_MIN_CHARS}字第三方客观事实，结尾禁升华；概要≤${JOURNAL_SUMMARY_MAX_CHARS}字；编码 J 或省略）。
#剧情摘要 勿每回都写。
${defs}
${FORMAT_EXAMPLE_WARNING}
范例结构：
${MEMORY_FORMAT_EXAMPLE}
说明：表格记忆与 <sum> 并存；<sum> 可短，#纪要表 必须按正文写长纪实，勿互相替代。勿省略 <sum>/<maintext>/<option>。`
}

/** 独立追溯任务的 system+user messages（纯函数，可单测） */
export function buildMemoryTraceMessages(input: {
  userText: string
  maintext: string
  sum?: string
  state: TableMemoryState
  maxMainChars?: number
}): Array<{ role: 'system' | 'user'; content: string }> {
  // shujuku 要 300 字纪要，正文上下文需足够；默认抬到 3600
  const maxMain = input.maxMainChars ?? 3600
  let main = (input.maintext || '').trim()
  if (main.length > maxMain) main = main.slice(0, maxMain) + '…'
  const user = (input.userText || '').trim().slice(0, 500)
  const sum = (input.sum || '').trim().slice(0, 280)
  const world = formatWorldStateInjection(input.state, { maxChars: 2800 })
  const trace = buildTraceRealtimePrompt(input.state)

  return [
    {
      role: 'system',
      content:
        '你是宗门经营互动叙事的记忆表格提取器（shujuku 纪要风格）。内容为虚构修真故事。' +
        '只输出 <Memory><!--...--></Memory>，不要说书，不要道德说教，不要在纪要结尾升华。',
    },
    {
      role: 'system',
      content: world,
    },
    {
      role: 'system',
      content: trace,
    },
    {
      role: 'user',
      content: [
        '【玩家本回】',
        user || '（无）',
        '【sum · 仅线索勿当纪要全文】',
        sum || '（无）',
        '【剧情正文 · 纪要事实唯一来源】',
        main || '（无）',
        '',
        '请立即输出 <Memory><!--...--></Memory> 增量更新。',
        `若有情节推进：必须含 #纪要表 一行，纪要≥${JOURNAL_BODY_MIN_CHARS}字、概要≤${JOURNAL_SUMMARY_MAX_CHARS}字，客观第三人称，禁结尾升华。`,
        '无变化时输出空的 <Memory><!----></Memory>。',
      ].join('\n'),
    },
  ]
}
