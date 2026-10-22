import { describe, expect, test } from 'vitest'
import { runSingleRule, runTier, testConfig } from '../helpers'
import { getPreset } from '../../src/core/config/presets'
import { buildRuleRegistry } from '../../src/core/rules/registry'
import { formatDocument } from '../../src/core/formatter/formatter'

const id = 'wording/doubled-object-particle'
const check = (text: string) => runSingleRule(id, text, testConfig())

describe('guarded object particle repetition', () => {
  test.each([
    ['資料をを確認します。', 'を', 2],
    ['資料を を確認します。', 'を', 2],
    ['資料を　を確認します。', 'を', 2],
    ['資料を、を確認します。', 'を', 2],
    ['資料を， を確認します。', 'を', 2],
    ['資料を, を確認します。', 'を', 2]
  ])('flags only the second object marker in "%s"', (text, phrase, occurrence) => {
    const d = check(text)
    expect(d).toHaveLength(1)
    const second = text.indexOf(phrase, text.indexOf(phrase) + phrase.length)
    expect(occurrence).toBe(2)
    expect(d[0]!.start).toBe(second)
    expect(d[0]!.end).toBe(second + phrase.length)
    expect(d[0]?.fixKind).toBe('none')
    expect(d[0]?.replacement).toBeUndefined()
    expect(formatDocument(text, d).text).toBe(text)
  })

  test('tracks consecutive repeated object particles and preserves UTF-16 offsets', () => {
    const text = '📒資料ををを確認します。'
    const found = check(text)
    const first = text.indexOf('を')
    expect(found.map(x => [x.start, x.end])).toEqual([
      [first + 1, first + 2],
      [first + 2, first + 3]
    ])
  })

  test('does not flag ordinary repeated markers separated by words or sentences', () => {
    for (const text of [
      '資料を確認し、計画を進めます。',
      '本を読んで、別の本を借ります。',
      '文章を分析します。表記を調べます。',
      '母ははっきり答えました。',
      '人ががんばっています。',
      '川ににじが映りました。',
      '目標を、実際の成果を比較します。',
      '「を」という助詞を説明します。',
      '外来語の「を」を例示します。'
    ]) expect(check(text)).toEqual([])
  })

  test('ignores examples inside quotes, blockquotes, code, URLs and HTML comments', () => {
    const text = [
      '「資料をを確認します」『資料を、を確認します』',
      '`資料をを確認します`',
      '```text',
      '資料をを確認します',
      '```',
      '> 資料をを確認します',
      '<!-- 資料をを確認します -->',
      '[例](https://example.com/資料をを確認します)'
    ].join('\n')
    expect(check(text)).toEqual([])
  })

  test('reports prose after a quote, not the literal example', () => {
    const text = '「をを」は例示ですが、資料をを確認します。'
    const d = check(text)
    expect(d).toHaveLength(1)
    expect(d[0]?.start).toBe(text.lastIndexOf('を'))
  })

  test('does not join repetition across a newline or masked inline code', () => {
    expect(check('資料を\nを確認します。')).toEqual([])
    expect(check('資料を`コード`を確認します。')).toEqual([])
  })

  test('is informational and opt-in through the existing RuleProvider', () => {
    const rule = buildRuleRegistry(testConfig()).get(id)
    expect(rule?.tier).toBe('fast')
    expect(rule?.defaultSeverity).toBe('info')
    expect(getPreset('general')?.rules[id]).toEqual({ enabled: true, severity: 'info' })
    expect(getPreset('technical')?.rules[id]).toEqual({ enabled: true, severity: 'info' })
    expect(getPreset('strict')?.rules[id]).toEqual({ enabled: true, severity: 'warning' })
    expect(getPreset('minimal')?.rules[id]).toBeUndefined()
    const scanned = runTier('資料をを確認します。', testConfig(), 'fast')
    expect(scanned.ruleErrors).toEqual([])
    expect(scanned.diagnostics.some(x => x.ruleId === id)).toBe(true)
  })
})
