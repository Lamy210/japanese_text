import { describe, expect, test } from 'vitest'
import { formatDocument } from '../../src/core/formatter/formatter'
import { getPreset } from '../../src/core/config/presets'
import { buildRuleRegistry } from '../../src/core/rules/registry'
import { runSingleRule, runTier, testConfig } from '../helpers'

const ruleId = 'wording/common-typo'
const check = (source: string) => runSingleRule(ruleId, source, testConfig())

describe('curated Japanese typo proposals', () => {
  test.each([
    ['シュミレーション', 'シミュレーション'],
    ['コミニュケーション', 'コミュニケーション'],
    ['デバック', 'デバッグ'],
    ['うる覚え', 'うろ覚え']
  ])('proposes "%s" → "%s" only as a manual suggestion', (mistake, corrected) => {
    const source = '説明：' + mistake + 'です。'
    const d = check(source)
    expect(d).toHaveLength(1)
    expect(source.slice(d[0]!.start, d[0]!.end)).toBe(mistake)
    expect(d[0]!.replacement).toBe(corrected)
    expect(d[0]!.fixKind).toBe('suggestion')
    expect(formatDocument(source, d).text).toBe(source)
  })

  test('finds multiple occurrences and preserves UTF-16 offsets after emoji', () => {
    const text = '📚シュミレーションとコミニュケーションをデバックします。'
    const d = check(text)
    expect(d.map(x => text.slice(x.start, x.end))).toEqual([
      'シュミレーション', 'コミニュケーション', 'デバック'
    ])
    expect(d.map(x => x.start)).toEqual([
      text.indexOf('シュミレーション'), text.indexOf('コミニュケーション'), text.indexOf('デバック')
    ])
  })

  test('detects bounded typos in ordinary compound words and technical prose', () => {
    const text = 'コミニュケーション能力を高めてデバックします。'
    expect(check(text).map(x => x.replacement)).toEqual(['コミュニケーション', 'デバッグ'])
  })

  test('does not flag accepted spellings, proper-like extensions, or style variants', () => {
    for (const text of [
      'シミュレーションに成功しました。',
      'コミュニケーション能力があります。',
      'デバッグを行いました。',
      'うろ覚えです。',
      'シュミレーションズ',
      'スーパーシュミレーション',
      'デバックアップ',
      'サーバとサーバー',
      'コンピュータとコンピューター'
    ]) expect(check(text)).toEqual([])
  })

  test('does not correct the spelling of an exact quoted string', () => {
    const text = '「シュミレーション」と『コミニュケーション』という表記を紹介します。'
    expect(check(text)).toEqual([])
  })

  test('handles multiline Japanese quotations without leaking matches', () => {
    const text = '「デバック\nうる覚え」\n本文のシュミレーションは対象です。'
    const d = check(text)
    expect(d).toHaveLength(1)
    expect(text.slice(d[0]!.start, d[0]!.end)).toBe('シュミレーション')
  })

  test('ignores fenced code, inline code, HTML comments and URLs', () => {
    const text = [
      '`シュミレーション`',
      '```text',
      'コミニュケーション',
      '```',
      '<!-- デバック -->',
      '[リンク](https://example.com/シュミレーション)',
      '<https://example.com/デバック>'
    ].join('\n')
    expect(check(text)).toEqual([])
  })

  test('flags prose headings and list items, but not blockquoted examples', () => {
    const text = '# シュミレーションの概要\n- デバックの手順\n> コミニュケーション'
    const d = check(text)
    expect(d.map(x => text.slice(x.start, x.end))).toEqual(['シュミレーション', 'デバック'])
  })

  test('does not allow a spelling suggestion to become an automatic format change', () => {
    const text = 'デバックをします。'
    const d = check(text)
    expect(d).toHaveLength(1)
    expect(d[0]?.fixKind).toBe('suggestion')
    expect(formatDocument(text, d)).toMatchObject({ text, appliedCount: 0 })
  })

  test('registers via RuleProvider and enables suitable profiles', () => {
    const registry = buildRuleRegistry(testConfig())
    expect(registry.get(ruleId)?.tier).toBe('fast')
    expect(registry.get(ruleId)?.defaultSeverity).toBe('info')
    expect(getPreset('general')?.rules[ruleId]).toEqual({ enabled: true, severity: 'info' })
    expect(getPreset('technical')?.rules[ruleId]).toEqual({ enabled: true, severity: 'warning' })
    expect(getPreset('strict')?.rules[ruleId]).toEqual({ enabled: true, severity: 'warning' })
    expect(getPreset('minimal')?.rules[ruleId]).toEqual({ enabled: true, severity: 'warning' })
    const result = runTier('シュミレーションです。', testConfig(), 'fast')
    expect(result.ruleErrors).toEqual([])
    expect(result.diagnostics.some(x => x.ruleId === ruleId)).toBe(true)
  })
})
