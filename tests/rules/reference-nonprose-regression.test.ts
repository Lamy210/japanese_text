import { describe, expect, test } from 'vitest'
import { runSingleRule, testConfig } from '../helpers'

const check = (rule: string, source: string) => runSingleRule(rule, source, testConfig())

describe('Markdown reference definitions and uses must respect non-prose structure', () => {
  test('ignores YAML frontmatter pseudo-definitions', () => {
    const source = [
      '---',
      '[survey]: https://example.com/study',
      '---',
      '',
      '利用者の73%が満足と回答しました。[資料][survey]'
    ].join('\n')
    expect(check('reference/undefined', source)).toHaveLength(1)
    const citation = check('evidence/citation-number', source)
    expect(citation).toHaveLength(1)
    expect(source.slice(citation[0]!.start, citation[0]!.end)).toBe('73%')
  })

  test('ignores HTML-comment pseudo-definitions even if they look like metadata lines', () => {
    const source = [
      '利用者の73%が満足と回答しました。[資料][survey]',
      '',
      '<!--',
      '[survey]: https://example.com/study',
      '-->'
    ].join('\n')
    expect(check('reference/undefined', source)).toHaveLength(1)
    expect(check('evidence/citation-number', source)).toHaveLength(1)
  })

  test('ignores HTML-comment pseudo-definitions for duplicate-ID diagnostics', () => {
    const source = [
      '[ref]: https://example.com/actual',
      '',
      '<!--',
      '[ref]: https://example.com/comment',
      '-->',
      '',
      '[資料][ref]'
    ].join('\n')
    expect(check('reference/duplicate-id', source)).toEqual([])
    expect(check('reference/undefined', source)).toEqual([])
  })

  test('does not count references used only inside HTML comments as actual use', () => {
    const source = [
      '[ref]: https://example.com/study',
      '',
      '<!--',
      '[資料][ref]',
      '-->'
    ].join('\n')
    const results = check('reference/unused', source)
    expect(results).toHaveLength(1)
    expect(results[0]?.message).toContain('ref')
  })

  test('does not count references used only inside YAML frontmatter as actual use', () => {
    const source = [
      '---',
      'example: "[資料][ref]"',
      '---',
      '',
      '[ref]: https://example.com/study'
    ].join('\n')
    expect(check('reference/unused', source)).toHaveLength(1)
  })

  test('does not treat headings inside an HTML comment as anchor targets', () => {
    const source = [
      '<!--',
      '# Hidden',
      '-->',
      '',
      '[文書内リンク](#hidden)'
    ].join('\n')
    expect(check('reference/broken-anchor', source)).toHaveLength(1)
  })

  test('does not treat headings inside YAML frontmatter as anchor targets', () => {
    const source = [
      '---',
      '# Hidden',
      '---',
      '',
      '[文書内リンク](#hidden)'
    ].join('\n')
    expect(check('reference/broken-anchor', source)).toHaveLength(1)
  })

  test('keeps ordinary definitions, usage and headings valid', () => {
    const source = [
      '# Visible',
      '',
      '[資料][ref] [見出し](#visible)',
      '',
      '[ref]: https://example.com/study'
    ].join('\n')
    expect(check('reference/undefined', source)).toEqual([])
    expect(check('reference/unused', source)).toEqual([])
    expect(check('reference/broken-anchor', source)).toEqual([])
  })

  test('keeps fenced/inline-code text from becoming reference definitions or usage', () => {
    const source = [
      '[ref]: https://example.com/study',
      '',
      '```md',
      '[ref]: https://example.com/fake',
      '[資料][ref]',
      '```',
      '',
      '`[資料][ref]`'
    ].join('\n')
    expect(check('reference/duplicate-id', source)).toEqual([])
    expect(check('reference/unused', source)).toHaveLength(1)
  })

  test('still resolves a real definition when a non-prose fake precedes it', () => {
    const source = [
      '<!--',
      '[ref]: https://example.com/fake',
      '-->',
      '',
      '[資料][ref]',
      '',
      '[ref]: https://example.com/actual'
    ].join('\n')
    expect(check('reference/undefined', source)).toEqual([])
    expect(check('reference/duplicate-id', source)).toEqual([])
    expect(check('reference/unused', source)).toEqual([])
  })
})
