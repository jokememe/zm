import { describe, expect, it } from 'vitest'
import {
  extractDisplayMaintext,
  extractOpenTagTail,
  prepareAssistantDisplay,
  sanitizeAssistantForDisplay,
  stripControlBlocksForDisplay,
} from './display-compat'

describe('display-compat · 主 API 预设爆标签', () => {
  it('extracts maintext and drops surrounding control tags', () => {
    const raw = `<thinking>内部谋划勿展示</thinking>
<maintext>山门之下，雾气初散，陆承渊躬身行礼。</maintext>
<option>
巡视灵田
接见来使
</option>
<sum>陆承渊拜入</sum>
<vars>{"灵石":-10}</vars>
<Memory><!--
#角色档案
[陆承渊]|身份：外门
--></Memory>`

    const out = sanitizeAssistantForDisplay(raw)
    expect(out).toContain('山门之下')
    expect(out).toContain('〔小结〕')
    expect(out).not.toMatch(/<\/?thinking/i)
    expect(out).not.toMatch(/<\/?maintext/i)
    expect(out).not.toMatch(/<\/?option/i)
    expect(out).not.toMatch(/<\/?vars/i)
    expect(out).not.toMatch(/<\/?Memory/i)
    expect(out).not.toContain('内部谋划')
    expect(out).not.toContain('巡视灵田')
  })

  it('strips flood of ST-style tags when maintext missing', () => {
    const raw = `<meow>喵喵旁白</meow>
<think_nya~>乱想</think_nya~>
background 已设
<status>HP 100</status>
正文段落：青岚宗晨钟响起，弟子鱼贯入殿。
<option>A
B</option>
<tableEdit>delete row</tableEdit>`

    const out = sanitizeAssistantForDisplay(raw)
    expect(out).toContain('青岚宗晨钟响起')
    expect(out).not.toMatch(/<\/?meow/i)
    expect(out).not.toMatch(/<\/?option/i)
    expect(out).not.toMatch(/<\/?tableEdit/i)
    expect(out).not.toContain('喵喵旁白')
    expect(out).not.toContain('delete row')
  })

  it('handles streaming unclosed maintext', () => {
    const partial = `<thinking>还在想</thinking><maintext>云雾未散，因果已动`
    expect(extractOpenTagTail(partial, 'maintext')).toContain('云雾未散')
    const out = sanitizeAssistantForDisplay(partial)
    expect(out).toContain('云雾未散')
    expect(out).not.toContain('还在想')
    expect(out).not.toMatch(/<\/?maintext/i)
  })

  it('extractDisplayMaintext prefers maintext over raw soup', () => {
    const raw = `<foo>x</foo><maintext>唯一正文</maintext><bar>y</bar>`
    expect(extractDisplayMaintext(raw)).toBe('唯一正文')
  })

  it('stripControlBlocksForDisplay removes open thinking tail', () => {
    const raw = `前文可见\n<thinking>超长思维链尚未闭合……`
    const out = stripControlBlocksForDisplay(raw)
    expect(out).toContain('前文可见')
    expect(out).not.toContain('超长思维链')
  })

  it('prepareAssistantDisplay with keepGameTags leaves tags for parse path', () => {
    const raw = `<maintext>可解析</maintext><option>A\nB</option>`
    const kept = prepareAssistantDisplay(raw, null, { keepGameTags: true })
    expect(kept.rawForParse).toContain('<maintext>')
    // keepGameTags 时中间态可仍含标签
    const open = prepareAssistantDisplay(raw, null, { keepGameTags: false })
    expect(open.fromMaintext).toBe(true)
    expect(open.text).toContain('可解析')
    expect(open.text).not.toMatch(/<\/?maintext/i)
  })

  it('runs markdownOnly display regex then sanitizes', () => {
    const settings = {
      regex_scripts: [
        {
          id: 'hide-meow',
          scriptName: 'hide meow',
          findRegex: '/<meow>[\\s\\S]*?<\\/meow>/gi',
          replaceString: '',
          markdownOnly: true,
          placement: [2],
        },
      ],
    }
    const raw = `<meow>应被正则删</meow><maintext>留下正文</maintext>`
    const out = sanitizeAssistantForDisplay(raw, settings)
    expect(out).toContain('留下正文')
    expect(out).not.toContain('应被正则删')
  })
})
