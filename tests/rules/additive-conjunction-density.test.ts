import { describe, expect, test } from 'vitest'
import { getPreset } from '../../src/core/config/presets'
import { formatDocument } from '../../src/core/formatter/formatter'
import { buildRuleRegistry } from '../../src/core/rules/registry'
import { runSingleRule, runTier, testConfig } from '../helpers'

const ruleId = 'style/additive-conjunction-density'
const check = (text: string) => runSingleRule(ruleId, text, testConfig())

describe('bounded additive-conjunction writing guidance', () => {
  test('flags the third distinct additive conjunction with exact UTF-16 location', () => {
    const text = '😊案内です。また、準備します。さらに、検証します。加えて、結果を共有します。'
    const d = check(text)
    expect(d).toHaveLength(1)
    expect(d[0]?.start).toBe(text.lastIndexOf('加えて'))
    expect(text.slice(d[0]!.start, d[0]!.end)).toBe('加えて')
    expect(d[0]?.message).toContain('追加')
    expect(d[0]?.fixKind).toBe('none')
    expect(d[0]?.replacement).toBeUndefined()
  })

  test('supports four distinct consecutive markers while only flagging from the third onward', () => {
    const text = 'また、調べます。さらに、確認します。加えて、比較します。そのうえ、報告します。'
    const d = check(text)
    expect(d).toHaveLength(2)
    expect(d.map(x => text.slice(x.start, x.end))).toEqual(['加えて', 'そのうえ'])
  })

  test('detects across sentence-terminated single newlines', () => {
    expect(check('また、準備します。\nさらに、調査します。\n加えて、整理します。')).toHaveLength(1)
  })

  test('does not report a two-sentence list of additions', () => {
    expect(check('また、準備します。さらに、調査します。')).toEqual([])
  })

  test('does not treat repeated identical connectors as distinct additive transitions', () => {
    const text = 'また、準備します。また、調査します。加えて、報告します。'
    expect(check(text)).toEqual([])
    expect(runSingleRule('style/consecutive-conjunction', text, testConfig())).toHaveLength(1)
  })

  test('resets when an unrelated sentence interrupts the sequence', () => {
    expect(check('また、準備します。さらに、調査します。内容を確認します。加えて、報告します。')).toEqual([])
  })

  test('does not count different discourse functions such as contrast and summary', () => {
    expect(check('また、準備します。しかし、雨です。さらに、調査します。加えて、報告します。')).toEqual([])
    expect(check('また、準備します。つまり、調査します。さらに、比較します。')).toEqual([])
  })

  test('resets at blank lines, headings, blockquotes, bullet lists and tables', () => {
    const boundaries = ['\n\n', '\n# 見出し\n', '\n> 引用です。\n', '\n- 項目\n', '\n| 見出し | 列 |\n']
    for (const boundary of boundaries) {
      expect(check('また、準備します。さらに、調査します。' + boundary + '加えて、報告します。')).toEqual([])
    }
  })

  test('ignores code fences, inline code and link destinations', () => {
    const text = [
      '```md',
      'また、準備します。さらに、調査します。加えて、報告します。',
      '```',
      '`また、準備します。さらに、調査します。加えて、報告します。`',
      '[参考](https://example.com/また、さらに、加えて)'
    ].join('\n')
    expect(check(text)).toEqual([])
  })

  test('does not compare through quoted dialogue, including multiline quotations', () => {
    expect(check('「また、準備します。さらに、調査します。加えて、報告します。」')).toEqual([])
    expect(check('また、準備します。さらに、調査します。「追加情報です。」加えて、報告します。')).toEqual([])
    expect(check('また、準備します。\n「さらに、調査します。\n加えて、報告します。」')).toEqual([])
  })

  test('does not infer a conjunction from adverbial また without a following comma', () => {
    expect(check('また作業します。さらに、調査します。加えて、報告します。')).toEqual([])
  })

  test('does not claim the text is wrong or auto-rewrite it', () => {
    const text = 'また、準備します。さらに、調査します。加えて、報告します。'
    const result = check(text)
    expect(result).toHaveLength(1)
    expect(result[0]?.message).toContain('検討')
    expect(formatDocument(text, result).text).toBe(text)
  })

  test('registers in the fast engine with conservative preset severities', () => {
    const rule = buildRuleRegistry(testConfig()).get(ruleId)
    expect(rule?.tier).toBe('fast')
    expect(rule?.defaultSeverity).toBe('info')
    expect(getPreset('general')?.rules[ruleId]).toEqual({ enabled: true, severity: 'info' })
    expect(getPreset('technical')?.rules[ruleId]).toEqual({ enabled: true, severity: 'info' })
    expect(getPreset('strict')?.rules[ruleId]).toEqual({ enabled: true, severity: 'info' })
    expect(getPreset('minimal')?.rules[ruleId]).toBeUndefined()
    const result = runTier('また、準備します。さらに、調査します。加えて、報告します。', testConfig(), 'fast')
    expect(result.ruleErrors).toEqual([])
    expect(result.diagnostics.some(x => x.ruleId === ruleId)).toBe(true)
  })
})
