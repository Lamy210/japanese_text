import { describe, expect, test } from 'vitest'
import type { CitationPolicy } from '../../src/core/config/schema'
import { runSingleRule, testConfig } from '../helpers'

const rules = [
  ['evidence/citation-number', '利用者の73%が満足と回答しました。', '73%'],
  ['evidence/citation-comparison', '新方式は従来より高速です。', 'より高速'],
  ['evidence/citation-external-fact', '調査によると利用者は増加しました。', '調査によると']
] as const

function diagnose(rule: string, text: string, scope: CitationPolicy['scope'] = 'paragraph') {
  const config = testConfig()
  config.citation = {
    scope,
    detectNumbers: true,
    detectComparison: true,
    detectExternalFact: true
  }
  return runSingleRule(rule, text, config)
}

describe('citation references must resolve to usable definitions', () => {
  for (const [ruleId, claim, phrase] of rules) {
    test(`${ruleId}: undefined reference is not source evidence`, () => {
      const text = claim + ' [資料][missing]'
      const result = diagnose(ruleId, text)
      expect(result).toHaveLength(1)
      expect(text.slice(result[0]!.start, result[0]!.end)).toContain(phrase)
      expect(diagnose('reference/undefined', text)).toHaveLength(1)
    })

    test(`${ruleId}: resolved full and collapsed references count as sources`, () => {
      const full = claim + ' [資料][survey]\n\n[survey]: https://example.com/survey'
      const collapsed = claim + ' [survey][]\n\n[survey]: https://example.com/survey'
      expect(diagnose(ruleId, full)).toEqual([])
      expect(diagnose(ruleId, collapsed)).toEqual([])
    })

    test(`${ruleId}: empty reference URL cannot satisfy the claim`, () => {
      const text = claim + ' [資料][survey]\n\n[survey]: '
      expect(diagnose(ruleId, text)).toHaveLength(1)
      expect(diagnose('reference/empty-url', text)).toHaveLength(1)
    })
  }

  test('supports forward definitions without counting their URL as prose evidence', () => {
    const claim = '利用者の73%が満足と回答しました。'
    const text = claim + ' [資料][source]\n\n[source]: https://example.com/study'
    expect(diagnose('evidence/citation-number', text, 'paragraph')).toEqual([])
    expect(diagnose('evidence/citation-number', claim + ' [資料][missing]\n\n[source]: https://example.com/study', 'paragraph')).toHaveLength(1)
  })

  test('rejects a reference definition only present inside a code fence', () => {
    const text = '利用者の73%が満足と回答しました。 [資料][survey]\n\n```md\n[survey]: https://example.com/study\n```'
    const result = diagnose('evidence/citation-number', text)
    expect(result).toHaveLength(1)
    expect(diagnose('reference/undefined', text)).toHaveLength(1)
  })

  test('rejects a malformed reference URL but retains normal links', () => {
    const claim = '利用者の73%が満足と回答しました。'
    const invalid = claim + ' [資料][bad]\n\n[bad]: <https://example.com/study'
    expect(diagnose('evidence/citation-number', invalid)).toHaveLength(1)
    expect(diagnose('reference/malformed-url', invalid)).toHaveLength(1)
    const link = claim + ' [調査](https://example.com/study)'
    expect(diagnose('evidence/citation-number', link)).toEqual([])
  })

  test('missing collapsed reference after emoji preserves UTF-16 diagnostic offsets', () => {
    const text = '📚利用者の73%が満足と回答しました。 [missing][]'
    const results = diagnose('evidence/citation-number', text)
    expect(results).toHaveLength(1)
    expect(results[0]?.start).toBe(text.indexOf('73%'))
    expect(results[0]?.fixKind).toBe('none')
  })

  test('a valid plain URL continues to count as a source in text', () => {
    expect(diagnose('evidence/citation-number', '利用者の73%が満足と回答しました。 https://example.com/study')).toEqual([])
  })

  test('code samples and comments cannot provide evidence through fake references', () => {
    const text = '利用者の73%が満足と回答しました。 [資料][missing]\n`[資料][source]`\n[source]: '
    expect(diagnose('evidence/citation-number', text)).toHaveLength(1)
  })
})
