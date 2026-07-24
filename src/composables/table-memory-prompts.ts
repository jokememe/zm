/**
 * yuzuki-Memory 提示词契约（移植自 gaigai315/yuzuki-Memory prompt-library）。
 * 供格式提示、独立追溯任务、注入说明共用 — 不是空壳注释。
 */
import {
  cleanColumnName,
  createDefaultTableMemoryState,
  formatWorldStateInjection,
  type TableMemoryState,
} from '@/composables/table-memory'

export const MEMORY_FORMAT_EXAMPLE = `#角色档案
[角色全名]|年龄：具体年龄|性别：男或女|身份：当前身份|性格：关键词|当前位置：具体地点|周围角色：同场角色|生理：状态|人际关系：{目标}：〔关系〕 · 〔情感〕|着装：衣物|待办事项：事项|约定：约定内容
#物品追踪
[物品稳定名称]|物品描述：外观用途|物品位置：位置|持有者：姓名|状态：完好或损坏或丢失|备注：依据
#世界设定
[设定词条名]|类型：组织或地点或规则|详细说明：已确认内容|影响范围：影响对象
#纪要表
[J0001]|概要：一句话|时间跨度：本回|地点：场景|纪要：事件要点`

export const FORMAT_EXAMPLE_WARNING = `【范例使用限制】
以下只说明字段顺序与分隔符。范例中的角色/物品/地点不是剧情事实，严禁照抄写入表格；无依据则不要输出该行。`

/** 与 yuzuki TABLE_DEFINITIONS / DATABASE_SCHEMA 等价 */
export function buildTableDefinitionsText(
  state: TableMemoryState = createDefaultTableMemoryState(),
): string {
  const tables = state.tables || createDefaultTableMemoryState().tables
  const lines = tables.map((table) => {
    if (table.id === 'plot_summary') {
      return (
        '#剧情摘要：包含 #主线/#支线；有明确时间线事件时写入，' +
        '格式 [摘要名]|内容：事件简述'
      )
    }
    if (table.id === 'plot_journal') {
      return (
        '#纪要表：每回合可追加细行；主键=编码索引(J0001…)；' +
        '字段 概要/时间跨度/地点/纪要；合并粗行标记=auto_merged、编码 AM0001…'
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
 * yuzuki traceRealtime 核心守则（宗门语境精简移植，保留增量/主键/禁止空字段等硬规则）
 */
export function buildTraceRealtimePrompt(state?: TableMemoryState): string {
  const defs = buildTableDefinitionsText(state)
  return `你是记忆表格追溯引擎。根据本回合【玩家】与【剧情正文】，增量更新【当前世界状态参考】中的动态数据。

【更新守则】
1.必须使用 <Memory><!-- ... --></Memory> 包裹全部更新；注释符不可省略。
2.书写顺序：#表名 换行 [主键]|字段：值|字段：值 ；严禁使用数据库结构外的表名/字段名。
3.只输出本回合确定发生变化或新出现的内容；不得遗漏关键人物移动/易手/新设定，不得凭空捏造。
4.若【当前世界状态参考】中某角色已在 A 地，本回正文未写其移动，严禁改当前位置；有移动必须更新。
5.主键必须用 [] 包裹。不需要更新的字段严禁写出（含空值）；系统按主键局部合并。
6.角色全名必须稳定，禁止同一人用不同别名建多条。物品主键只写稳定名称，状态变化写「状态」字段，禁止把「破损的xx」当地主键。
7.除 <Memory> 外不要输出解释、Markdown、JSON 或其它标签。

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
#剧情摘要：可选；有清晰主线进展时写 [主线]|内容：… 或 [支线]|内容：…
#纪要表：本回有明确情节推进时追加一行细纪要；编码可省略（系统分配 Jxxxx）；勿写 auto_merged（合并由系统做）。`
}

/** 主推演格式提示里追加的 Memory 段（让主模型也能顺带填表） */
export function buildMainFormatMemoryHint(state?: TableMemoryState): string {
  const defs = buildTableDefinitionsText(state)
  return `【表格记忆 · yuzuki 兼容】
本回合正文结束后，若人物/物品/设定有变化，必须在回复末尾追加：
<Memory><!--
#表名
[主键]|字段：值|字段：值
--></Memory>
规则：主键合并；只写变更字段；禁止空字段；表与字段必须属于下列结构。
${defs}
${FORMAT_EXAMPLE_WARNING}
范例结构：
${MEMORY_FORMAT_EXAMPLE}
说明：表格记忆与 <sum> 并存，勿省略 <sum>/<maintext>/<option>。`
}

/** 独立追溯任务的 system+user messages（纯函数，可单测） */
export function buildMemoryTraceMessages(input: {
  userText: string
  maintext: string
  sum?: string
  state: TableMemoryState
  maxMainChars?: number
}): Array<{ role: 'system' | 'user'; content: string }> {
  const maxMain = input.maxMainChars ?? 1600
  let main = (input.maintext || '').trim()
  if (main.length > maxMain) main = main.slice(0, maxMain) + '…'
  const user = (input.userText || '').trim().slice(0, 400)
  const sum = (input.sum || '').trim().slice(0, 240)
  const world = formatWorldStateInjection(input.state, { maxChars: 2800 })
  const trace = buildTraceRealtimePrompt(input.state)

  return [
    {
      role: 'system',
      content:
        '你是宗门经营互动叙事的记忆表格提取器。内容为虚构修真故事。' +
        '只输出 <Memory><!--...--></Memory>，不要说书，不要道德说教。',
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
        '【sum】',
        sum || '（无）',
        '【剧情正文】',
        main || '（无）',
        '',
        '请立即根据以上内容输出 <Memory><!--...--></Memory> 增量更新。无变化时输出空的 <Memory><!----></Memory>。',
      ].join('\n'),
    },
  ]
}
