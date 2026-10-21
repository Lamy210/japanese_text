import { describe, expect, test } from 'vitest'
import { getPreset } from '../../src/core/config/presets'
import { buildRuleRegistry } from '../../src/core/rules/registry'
import { formatDocument } from '../../src/core/formatter/formatter'
import { runSingleRule, runTier, testConfig } from '../helpers'

const id = 'wording/nominalized-action'
const scan = (text: string) => runSingleRule(id, text, testConfig())

describe('nominalized-action writing guidance', () => {
  test.each([
    ['確認を実施します', '確認を実施します'],
    ['検討を行いました', '検討を行いました'],
    ['調査を実施した', '調査を実施した'],
    ['検証を行う', '検証を行う'],
    ['分析を実施する', '分析を実施する'],
    ['評価を行った', '評価を行った'],
    ['測定を実施しました', '測定を実施しました'],
    ['点検を行います', '点検を行います']
  ])('detects an explicitly supported compound pattern: %s', (phrase, expected) => {
    const text = `報告：${phrase}。`
    const result = scan(text)
    expect(result).toHaveLength(1)
    expect(text.slice(result[0]!.start, result[0]!.end)).toBe(expected)
    expect(result[0]?.message).toContain('簡潔')
    expect(result[0]?.fixKind).toBe('none')
    expect(result[0]?.replacement).toBeUndefined()
  })

  test.each([
    ['確認を実施します。', '確認します'],
    ['検討を行いました。', '検討しました'],
    ['分析を実施する。', '分析する'],
    ['評価を行った。', '評価した']
  ])('illustrates an inflected concise alternative without applying it: %s', (input, example) => {
    const d = scan(input)
    expect(d).toHaveLength(1)
    expect(d[0]!.message).toContain(`「${example}」`)
    expect(d[0]!.replacement).toBeUndefined()
    expect(d[0]!.fixKind).toBe('none')
  })

  test('reports all separate spans in a multi-sentence text, with exact UTF-16 offsets', () => {
    const text = '📊確認を実施します。検証を行いました。'
    const result = scan(text)
    expect(result).toHaveLength(2)
    expect(result.map((d) => [d.start, d.end])).toEqual([
      [text.indexOf('確認を実施します'), text.indexOf('確認を実施します') + '確認を実施します'.length],
      [text.indexOf('検証を行いました'), text.indexOf('検証を行いました') + '検証を行いました'.length]
    ])
  })

  test('never offers an unsafe standalone replacement for an attributive phrase', () => {
    const text = '情報の確認を実施しました。'
    const result = scan(text)
    expect(result).toHaveLength(1)
    expect(result[0]?.fixKind).toBe('none')
    expect(result[0]?.replacement).toBeUndefined()
    expect(formatDocument(text, result).text).toBe(text)
  })

  test('does not report ordinary verbs or generic actions outside the allowlist', () => {
    for (const text of [
      '情報を確認しました。',
      '調査します。',
      '操作を実施しました。',
      '会議を行いました。',
      '検討する。',
      '確認を要請しました。',
      '確認を実施しない。',
      '確認を行ないます。',
      '試験を行った。',
      '結果を分析します。'
    ]) {
      expect(scan(text)).toEqual([])
    }
  })

  test('avoids duplicate overlapping guidance when the old redundancy rule already matches', () => {
    const text = '確認を実施することができます。'
    expect(scan(text)).toEqual([])
    const original = runSingleRule('wording/redundancy', text, testConfig())
    expect(original).toHaveLength(1)
    expect(original[0]?.fixKind).toBe('suggestion')
  })

  test('does not report quotes or literal examples in Markdown code and metadata', () => {
    const text = [
      '「確認を実施します」',
      '『検証を行います』',
      '`確認を実施する`',
      '```md',
      '確認を実施します',
      '```',
      '<!-- 確認を実施する -->',
      '[例](https://example.com/確認を実施します)'
    ].join('\n')
    expect(scan(text)).toEqual([])
  })

  test('still detects author prose adjacent to masked Markdown text', () => {
    const text = '`確認を実施する` 本文では検討を行います。'
    const result = scan(text)
    expect(result).toHaveLength(1)
    expect(text.slice(result[0]!.start, result[0]!.end)).toBe('検討を行います')
  })

  test('avoids matches split by a line break or a mask marker', () => {
    expect(scan('確認を\n実施します。')).toEqual([])
    expect(scan('確認を`example`実施します。')).toEqual([])
  })

  test('keeps intentional quotation markers from being shortened by formatting', () => {
    const text = '「確認を実施した」という記録を、別途点検を行いました。'
    const result = scan(text)
    expect(result).toHaveLength(1)
    expect(text.slice(result[0]!.start, result[0]!.end)).toBe('点検を行いました')
    expect(formatDocument(text, result).text).toBe(text)
  })

  test('integrates the rule as a non-autofix fast rule into built-in profiles', () => {
    const rule = buildRuleRegistry(testConfig()).get(id)
    expect(rule?.tier).toBe('fast')
    expect(rule?.defaultSeverity).toBe('info')
    for (const preset of ['general', 'technical', 'strict'] as const) {
      expect(getPreset(preset)?.rules[id]).toEqual({ enabled: true, severity: 'info' })
    }
    expect(getPreset('minimal')?.rules[id]).toBeUndefined()
    const result = runTier('確認を実施しました。', testConfig(), 'fast')
    expect(result.ruleErrors).toEqual([])
    expect(result.diagnostics.some((d) => d.ruleId === id)).toBe(true)
  })
})
