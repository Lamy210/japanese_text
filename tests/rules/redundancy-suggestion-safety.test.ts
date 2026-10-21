import { describe, expect, test } from 'vitest'
import { runSingleRule, testConfig } from '../helpers'
import { collectSafeFixes, formatDocument } from '../../src/core/formatter/formatter'

const check = (text: string) => runSingleRule('wording/redundancy', text, testConfig())

describe('review-only Japanese wording must not offer syntactically unsafe direct replacements', () => {
  test.each([
    ['来させていただきます。', 'させていただきます'],
    ['見させていただきます。', 'させていただきます'],
    ['参加させていただきます。', 'させていただきます'],
    ['ご確認させていただきます。', 'させていただきます'],
    ['色々あると思います。', '色々'],
    ['色々試します。', '色々'],
    ['色々な方法があります。', '色々']
  ])('detects "%s" but never offers an unsafe substring replacement', (text, fragment) => {
    const diagnostics = check(text)
    expect(diagnostics).toHaveLength(1)
    expect(text.slice(diagnostics[0]!.start, diagnostics[0]!.end)).toBe(fragment)
    expect(diagnostics[0]?.message.length).toBeGreaterThan(8)
    expect(diagnostics[0]?.fixKind).toBe('none')
    expect(diagnostics[0]?.replacement).toBeUndefined()
    expect(formatDocument(text, diagnostics).text).toBe(text)
    expect(collectSafeFixes(diagnostics)).toEqual([])
  })

  test('preserves safe spelling fixes and selectable low-risk suggestions', () => {
    const safe = check('テストを行ないます。')
    expect(safe).toHaveLength(1)
    expect(safe[0]?.fixKind).toBe('safe')
    expect(safe[0]?.replacement).toBe('行います')
    expect(formatDocument('テストを行ないます。', safe).text).toBe('テストを行います。')

    const suggestion = check('編集することができます。')
    expect(suggestion).toHaveLength(1)
    expect(suggestion[0]?.fixKind).toBe('suggestion')
    expect(suggestion[0]?.replacement).toBe('できます')
  })

  test('maintains original UTF-16 offsets and uses rule-level source classification', () => {
    const source = '🚀報告します。色々試します。'
    const diagnostics = check(source)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.start).toBe(source.indexOf('色々'))
    expect(diagnostics[0]?.end).toBe(source.indexOf('色々') + '色々'.length)
    expect(diagnostics[0]?.ruleId).toBe('wording/redundancy')
    expect(diagnostics[0]?.source).toBe('core')
  })

  test('does not offer a replacement for masked code examples', () => {
    expect(check('`色々`')).toEqual([])
    expect(check('```text\n休ませていただきます。\n```')).toEqual([])
  })
})
