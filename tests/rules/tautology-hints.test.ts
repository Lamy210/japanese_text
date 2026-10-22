import { describe, expect, test } from 'vitest'
import { runSingleRule, runTier, testConfig } from '../helpers'
import { buildRuleRegistry } from '../../src/core/rules/registry'
import { getPreset } from '../../src/core/config/presets'
import { formatDocument } from '../../src/core/formatter/formatter'

const id = 'wording/tautology'
const scan = (text: string) => runSingleRule(id, text, testConfig())

describe('bounded tautology review without automatic rewrites', () => {
  test.each([
    ['まず最初に', 'まず'],
    ['あらかじめ事前に', '事前に'],
    ['一番最初に', '最初に'],
    ['今現在', '現在'],
    ['各々それぞれ', 'それぞれ']
  ])('offers an informational concision review for %s', (phrase, alternative) => {
    const text = `報告では${phrase}記載します。`
    const d = scan(text)
    expect(d).toHaveLength(1)
    expect(text.slice(d[0]!.start, d[0]!.end)).toBe(phrase)
    expect(d[0]!.message).toContain(alternative)
    expect(d[0]!.fixKind).toBe('none')
    expect(d[0]!.replacement).toBeUndefined()
    expect(formatDocument(text, d).text).toBe(text)
  })

  test('reports multiple occurrences in original UTF-16 positions', () => {
    const text = '📝まず最初に確認します。今現在は調査中です。'
    const results = scan(text)
    expect(results.map(x => [x.start, x.end])).toEqual([
      [text.indexOf('まず最初に'), text.indexOf('まず最初に') + 'まず最初に'.length],
      [text.indexOf('今現在'), text.indexOf('今現在') + '今現在'.length]
    ])
  })

  test('does not flag shorter, legitimate or unrelated idioms', () => {
    const normal = [
      'まず確認します。', '最初に確認します。',
      '事前に準備します。', 'あらかじめ説明します。',
      '今の状況を確認します。', '現在の状況を説明します。',
      '各々が担当します。', 'それぞれ確認します。',
      'まずは最初の課題から始めます。',
      '今から現在までの経緯です。'
    ]
    for (const text of normal) expect(scan(text)).toEqual([])
  })

  test('avoids quoted examples, blockquotes, code and URLs', () => {
    const text = [
      '「まず最初に」と『今現在』は例です。',
      '`あらかじめ事前に`',
      '```markdown',
      '一番最初に',
      '```',
      '> 各々それぞれ',
      '<!-- まず最初に -->',
      '[参考](https://example.com/今現在)'
    ].join('\n')
    expect(scan(text)).toEqual([])
  })

  test('detects ordinary prose after quotes and Markdown code', () => {
    const text = '`今現在` 「一番最初に」は引用です。本文ではまず最初に説明します。'
    const result = scan(text)
    expect(result).toHaveLength(1)
    expect(text.slice(result[0]!.start, result[0]!.end)).toBe('まず最初に')
  })

  test('preserves the informational profile and rule provider contracts', () => {
    expect(buildRuleRegistry(testConfig()).get(id)?.tier).toBe('fast')
    expect(getPreset('general')?.rules[id]).toEqual({ enabled: true, severity: 'info' })
    expect(getPreset('technical')?.rules[id]).toEqual({ enabled: true, severity: 'info' })
    expect(getPreset('strict')?.rules[id]).toEqual({ enabled: true, severity: 'info' })
    expect(getPreset('minimal')?.rules[id]).toBeUndefined()
    const result = runTier('まず最初に説明します。', testConfig(), 'fast')
    expect(result.ruleErrors).toEqual([])
    expect(result.diagnostics.some(x => x.ruleId === id)).toBe(true)
  })
})
