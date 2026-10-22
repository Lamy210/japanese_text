import { describe, expect, test } from 'vitest'
import { runSingleRule, testConfig } from '../helpers'
import { collectSafeFixes, formatDocument } from '../../src/core/formatter/formatter'
import { runTier } from '../helpers'

const rule = 'wording/redundancy'
const scan = (text: string) => runSingleRule(rule, text, testConfig())

describe('redundancy diagnostics: avoid context-unsafe direct suggestions', () => {
  test.each([
    ['編集することができます。', 'することができます'],
    ['予約をすることができます。', 'することができます'],
    ['検証することができる。', 'することができる'],
    ['依頼をすることができる。', 'することができる'],
    ['利用することが可能です。', 'することが可能です'],
    ['変更をすることが可能です。', 'することが可能です']
  ])('keeps review guidance but no potentially broken replacement for "%s"', (text, phrase) => {
    const d = scan(text)
    expect(d).toHaveLength(1)
    expect(text.slice(d[0]!.start, d[0]!.end)).toBe(phrase)
    expect(d[0]?.fixKind).toBe('none')
    expect(d[0]?.replacement).toBeUndefined()
    expect(d[0]?.message).toContain('文章全体')
    expect(collectSafeFixes(d)).toEqual([])
    expect(formatDocument(text, d).text).toBe(text)
  })

  test('does not report or auto-rewrite double-quoted documentation examples', () => {
    const text = '「行ないます」と『出来ます』は表記例です。'
    expect(scan(text)).toEqual([])
    expect(formatDocument(text, scan(text)).text).toBe(text)
  })

  test('does not report or auto-rewrite Markdown blockquotes', () => {
    const text = '> 行ないます。\n> することができます。\n> 色々です。'
    expect(scan(text)).toEqual([])
  })

  test('ignores multiple-line quoted examples but still detects nearby prose', () => {
    const text = '『行ないます\nすることができます』\n報告では行ないます。'
    const d = scan(text)
    expect(d).toHaveLength(1)
    expect(text.slice(d[0]!.start, d[0]!.end)).toBe('行ないます')
    expect(d[0]!.start).toBe(text.lastIndexOf('行ないます'))
  })

  test('handles emoji offsets and preserves safe spelling fix in ordinary prose', () => {
    const text = '📧「行ないます」と言いながら、本文は行ないます。'
    const d = scan(text)
    expect(d).toHaveLength(1)
    expect(d[0]!.start).toBe(text.lastIndexOf('行ないます'))
    expect(d[0]?.fixKind).toBe('safe')
    expect(d[0]?.replacement).toBe('行います')
    expect(formatDocument(text, d).text).toBe('📧「行ないます」と言いながら、本文は行います。')
  })

  test('returns source-order deterministic nonduplicated diagnostics for mixed patterns', () => {
    const text = '色々調べました。行ないます。編集することができます。'
    const d = scan(text)
    expect(d.map(x => text.slice(x.start, x.end))).toEqual([
      '色々', '行ないます', 'することができます'
    ])
    expect(new Set(d.map(x => x.start + ':' + x.end)).size).toBe(d.length)
  })

  test('still respects masked URLs, inline code and HTML comments', () => {
    const text = [
      '`行ないます`',
      '<!-- 出来ます -->',
      '[資料](https://example.com/色々)',
      '行ないます。'
    ].join('\n')
    const d = scan(text)
    expect(d).toHaveLength(1)
    expect(text.slice(d[0]!.start, d[0]!.end)).toBe('行ないます')
  })

  test('fast engine keeps normalized source offsets and no duplicate findings', () => {
    const text = '📚色々試します。資料を作成することができます。'
    const result = runTier(text, testConfig(), 'fast')
    const d = result.diagnostics.filter(x => x.ruleId === rule)
    expect(result.ruleErrors).toEqual([])
    expect(d).toHaveLength(2)
    expect(d.map(x => text.slice(x.start, x.end))).toEqual(['色々', 'することができます'])
    expect(d.every(x => x.fixKind === 'none')).toBe(true)
  })
})
