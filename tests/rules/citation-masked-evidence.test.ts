import { describe, expect, test } from 'vitest'
import { runSingleRule, testConfig } from '../helpers'
import type { CitationPolicy } from '../../src/core/config/schema'

function check(ruleId: string, text: string, scope: CitationPolicy['scope'] = 'paragraph') {
  const config = testConfig()
  config.citation = {
    scope,
    detectNumbers: true,
    detectComparison: true,
    detectExternalFact: true
  }
  return runSingleRule(ruleId, text, config)
}

describe('citation evidence must be part of the document prose, not masked code or metadata', () => {
  const numberClaim = '利用者の73%が満足と回答しました。'
  const fakeEvidence = [
    '`https://example.com/survey`',
    '`[調査](https://example.com/survey)`',
    '~~~md\n[調査](https://example.com/survey)\n~~~',
    '```text\nhttps://example.com/survey\n```',
    '<!-- [調査](https://example.com/survey) -->',
    '<!-- https://example.com/survey -->'
  ]

  test.each(fakeEvidence)('does not accept masked source material as a citation: %s', (fake) => {
    const text = numberClaim + '\n' + fake
    const diagnostics = check('evidence/citation-number', text)
    expect(diagnostics).toHaveLength(1)
    expect(text.slice(diagnostics[0]!.start, diagnostics[0]!.end)).toContain('73%')
  })

  test('does not treat a YAML frontmatter link as an evidence citation', () => {
    const text = [
      '---',
      'reference: "[調査](https://example.com/survey)"',
      '---',
      '利用者の73%が満足と回答しました。'
    ].join('\n')
    const results = check('evidence/citation-number', text, 'section')
    expect(results).toHaveLength(1)
    expect(text.slice(results[0]!.start, results[0]!.end)).toBe('73%')
  })

  test('applies the same exclusion to comparison and external-fact claims', () => {
    const examples = [
      ['evidence/citation-comparison', '新方式は従来より高速です。'],
      ['evidence/citation-external-fact', '公式によると安全です。']
    ]
    for (const [ruleId, claim] of examples) {
      const text = claim + '\n`[ベンチマーク](https://example.com/benchmark)`'
      expect(check(ruleId, text)).toHaveLength(1)
    }
  })

  test('still accepts an actual inline Markdown link next to a claim', () => {
    const text = numberClaim + ' [調査](https://example.com/survey)'
    expect(check('evidence/citation-number', text)).toEqual([])
  })

  test('still accepts actual autolinks and bare URLs', () => {
    expect(check('evidence/citation-number', numberClaim + ' <https://example.com/survey>')).toEqual([])
    expect(check('evidence/citation-number', numberClaim + ' https://example.com/survey')).toEqual([])
  })

  test('does not treat a fake citation in code as a substitute for a real citation', () => {
    const text = numberClaim + ' `[偽リンク](https://fake.invalid)` [調査](https://valid.example/survey)'
    expect(check('evidence/citation-number', text)).toEqual([])
  })

  test('preserves UTF-16 offsets with emoji before the unsupported citation', () => {
    const text = '📊利用者の73%が満足と回答しました。\n`https://example.com`'
    const results = check('evidence/citation-number', text)
    expect(results).toHaveLength(1)
    expect(results[0]?.start).toBe(text.indexOf('73%'))
  })
})
