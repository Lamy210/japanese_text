import { describe, expect, test } from 'vitest'
import { formatDocument } from '../../src/core/formatter/formatter'
import { validateAppConfig } from '../../src/core/config/validate'
import { runSingleRule, runTier, testConfig } from '../helpers'

const id = 'wording/common-typo'
const check = (text: string, config = testConfig()) => runSingleRule(id, text, config)

describe('curated typo dictionary: extension and local terminology authority', () => {
  test.each([
    ['コミニュティ', 'コミュニティ'],
    ['アクセサビリティ', 'アクセシビリティ'],
    ['シュミレーター', 'シミュレーター'],
    ['シュミレータ', 'シミュレータ']
  ])('suggests "%s" → "%s" but does not auto-format', (wrong, preferred) => {
    const text = `本文は${wrong}について記述します。`
    const d = check(text)
    expect(d).toHaveLength(1)
    expect(text.slice(d[0]!.start, d[0]!.end)).toBe(wrong)
    expect(d[0]?.fixKind).toBe('suggestion')
    expect(d[0]?.replacement).toBe(preferred)
    expect(formatDocument(text, d).text).toBe(text)
  })

  test('preserves correct spelling and reasonable style variants', () => {
    for (const text of [
      'コミュニティに参加します。',
      'アクセシビリティの基準を確認します。',
      'シミュレータを使います。',
      'シミュレーターを使います。',
      'ユーザとユーザーについて',
      'コンピュータとコンピューターについて'
    ]) expect(check(text)).toEqual([])
  })

  test('does not flag typo substring inside unknown katakana product names', () => {
    for (const text of [
      'スーパーコミニュティは製品名です。',
      'コミニュティーツールという社名です。',
      'アクセサビリティズの資料です。',
      '社名シュミレータXではなく、スーパーシュミレータです。',
      'シュミレーターズです。'
    ]) expect(check(text)).toEqual([])
  })

  test('finds new terms in unquoted author prose including lists and headings', () => {
    const text = '# アクセサビリティの概要\n- コミニュティ運営\nシュミレータを起動します。'
    expect(check(text).map(d => text.slice(d.start, d.end))).toEqual([
      'アクセサビリティ', 'コミニュティ', 'シュミレータ'
    ])
  })

  test('skips protected quotations, Markdown code, blockquotes, URLs and comments', () => {
    const text = [
      '「コミニュティ」と『シュミレータ』',
      '`アクセサビリティ`',
      '```md',
      'シュミレーター',
      '```',
      '> コミニュティ',
      '<!-- アクセサビリティ -->',
      '[資料](https://example.com/コミニュティ)'
    ].join('\n')
    expect(check(text)).toEqual([])
  })

  test('keeps diagnostic UTF-16 offsets after emoji and multiline quoted prose', () => {
    const text = '✨「コミニュティ\nシュミレーター」\n本文ではアクセサビリティを確認します。'
    const d = check(text)
    expect(d).toHaveLength(1)
    expect(d[0]?.start).toBe(text.indexOf('アクセサビリティ'))
    expect(d[0]?.end).toBe(text.indexOf('アクセサビリティ') + 'アクセサビリティ'.length)
  })

  test('lets explicit user preferred spelling override the built-in suspicion', () => {
    const config = testConfig()
    config.terminology = [{ id: 'my-product', preferred: 'デバック', rejected: ['デバッグ'] }]
    expect(check('デバックを起動しました。', config)).toEqual([])
    // Other unrelated dictionary entries must continue operating.
    expect(check('シュミレーションを実行します。', config)).toHaveLength(1)
    const engine = runTier('デバックとシュミレーションです。', config, 'fast')
    expect(engine.ruleErrors).toEqual([])
    expect(engine.diagnostics.filter(x => x.ruleId === id)).toHaveLength(1)
  })

  test('defers to a user-specified rejected term and avoids conflicting diagnostics', () => {
    const config = testConfig()
    config.terminology = [{ id: 'term-custom', preferred: '調査作業', rejected: ['デバック'] }]
    expect(check('デバックします。', config)).toEqual([])
    const d = runSingleRule('wording/terminology', 'デバックします。', config)
    expect(d).toHaveLength(1)
    expect(d[0]?.replacement).toBe('調査作業')
  })

  test('does not suppress unrelated typos when custom terminology uses a longer phrase', () => {
    const config = testConfig()
    config.terminology = [{ id: 'compound', preferred: 'デバックアップ', rejected: ['デバッグアップ'] }]
    expect(check('デバックします。', config)).toHaveLength(1)
  })

  test('applies overrides after a supported config import without migration', () => {
    const config = validateAppConfig({
      schemaVersion: 1,
      terminology: [
        { id: 'app-product', preferred: 'コミニュティ', rejected: [] },
        { id: 'manual', preferred: '社内標準語', rejected: ['アクセサビリティ'] }
      ]
    })
    expect(check('コミニュティとアクセサビリティを確認します。', config)).toEqual([])
    expect(check('デバックします。', config)).toHaveLength(1)
    expect(config.schemaVersion).toBe(1)
  })

  test('the user can retain default typo rule behavior with the empty terminology list', () => {
    const config = testConfig()
    config.terminology = []
    const text = 'コミニュティのシュミレーターをデバックします。'
    const d = check(text, config)
    expect(d.map(x => x.replacement)).toEqual(['コミュニティ', 'シミュレーター', 'デバッグ'])
  })
})
