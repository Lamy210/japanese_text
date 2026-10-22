import { describe, expect, test } from 'vitest'
import { runSingleRule, runTier, testConfig } from '../helpers'
import { getPreset } from '../../src/core/config/presets'
import { buildRuleRegistry } from '../../src/core/rules/registry'
import { formatDocument } from '../../src/core/formatter/formatter'

const id = 'wording/honorific-request'
const diagnose = (text: string) => runSingleRule(id, text, testConfig())

const requests = [
  ['ご確認してください', 'ご確認ください'],
  ['ご連絡してください', 'ご連絡ください'],
  ['ご検討してください', 'ご検討ください'],
  ['ご回答してください', 'ご回答ください'],
  ['ご提出してください', 'ご提出ください'],
  ['ご参照してください', 'ご参照ください']
] as const

describe('bounded honorific request review', () => {
  test.each(requests)('reviews %s without silently rewriting it', (target, example) => {
    const text = `お手数ですが、${target}。`
    const result = diagnose(text)
    expect(result).toHaveLength(1)
    expect(text.slice(result[0]!.start, result[0]!.end)).toBe(target)
    expect(result[0]?.message).toContain(example)
    expect(result[0]?.fixKind).toBe('none')
    expect(result[0]?.replacement).toBeUndefined()
    expect(formatDocument(text, result).text).toBe(text)
  })

  test('detects multiple statements at UTF-16-accurate spans after an emoji', () => {
    const text = '📨ご確認してください。ご回答してください。'
    const d = diagnose(text)
    expect(d).toHaveLength(2)
    expect(d.map(x => [x.start, x.end])).toEqual([
      [text.indexOf('ご確認してください'), text.indexOf('ご確認してください') + 'ご確認してください'.length],
      [text.indexOf('ご回答してください'), text.indexOf('ご回答してください') + 'ご回答してください'.length]
    ])
  })

  test('avoids normal honorific requests and allowed request constructions', () => {
    const normal = [
      'ご確認ください。', 'ご確認をお願いします。', '確認してください。',
      'ご連絡ください。', 'ご検討ください。', 'ご提出ください。',
      'ご回答いただけますか。', 'ご参照のうえご提出ください。',
      'お読みになっていらっしゃいます。',
      'ご確認していただけますでしょうか。', 'ご確認してくださいませ。'
    ]
    for (const text of normal) expect(diagnose(text)).toEqual([])
  })

  test('excludes intentionally quoted examples and Markdown literal sections', () => {
    const text = [
      '「ご確認してください」『ご連絡してください』',
      '`ご回答してください`',
      '```text',
      'ご検討してください',
      '```',
      '> ご提出してください',
      '<!-- ご参照してください -->',
      '[資料](https://example.com/ご確認してください)'
    ].join('\n')
    expect(diagnose(text)).toEqual([])
  })

  test('keeps surrounding author prose, not masked quotations', () => {
    const text = '「ご確認してください」は例示です。本文ではご提出してください。'
    const result = diagnose(text)
    expect(result).toHaveLength(1)
    expect(text.slice(result[0]!.start, result[0]!.end)).toBe('ご提出してください')
  })

  test('skips fullwidth or mixed quotes across lines', () => {
    const text = '『ご検討してください\nご回答してください』\n本文はご連絡してください。'
    const result = diagnose(text)
    expect(result).toHaveLength(1)
    expect(text.slice(result[0]!.start, result[0]!.end)).toBe('ご連絡してください')
  })

  test('does not over-trigger on related words, honorific linking or nested phrases', () => {
    for (const text of [
      'ご確認をしてください。', 'ご検討していただきます。',
      'ご回答をお願いします。', 'ご提出なさってください。',
      'お読みになっていらっしゃる。'
    ]) expect(diagnose(text)).toEqual([])
  })

  test('registers fast informational rule in writing profiles without auto-fix', () => {
    const rule = buildRuleRegistry(testConfig()).get(id)
    expect(rule?.tier).toBe('fast')
    expect(rule?.defaultSeverity).toBe('info')
    expect(getPreset('general')?.rules[id]).toEqual({ enabled: true, severity: 'info' })
    expect(getPreset('technical')?.rules[id]).toEqual({ enabled: true, severity: 'info' })
    expect(getPreset('strict')?.rules[id]).toEqual({ enabled: true, severity: 'warning' })
    expect(getPreset('minimal')?.rules[id]).toBeUndefined()
    const result = runTier('ご確認してください。', testConfig(), 'fast')
    expect(result.ruleErrors).toEqual([])
    expect(result.diagnostics.some(x => x.ruleId === id)).toBe(true)
  })
})

describe('double honorific: avoid correcting cited or quoted examples', () => {
  test('ignores quote examples and Markdown block quotes', () => {
    const text = '「お読みになられる」『ご覧になられました』\n> おっしゃられる'
    expect(runSingleRule('wording/double-honorific', text, testConfig())).toEqual([])
  })

  test('still flags unquoted author prose after masked examples', () => {
    const text = '📕「ご覧になられる」は例です。お読みになられる場合を考えます。'
    const result = runSingleRule('wording/double-honorific', text, testConfig())
    expect(result).toHaveLength(1)
    expect(text.slice(result[0]!.start, result[0]!.end)).toBe('お読みになられる')
  })
})
