import { afterEach, describe, expect, test, vi } from 'vitest'
import { TextlintKernel } from '@textlint/kernel'
import { testConfig } from '../helpers'
import { runTextlint } from '../../src/core/engine/textlint-adapter'

afterEach(() => vi.restoreAllMocks())

describe('textlint adapter does not forward malformed third-party coordinates', () => {
  test('rejects invalid reports and downgrades invalid fixes while honoring exact fix targets', async () => {
    const text = '📚手順を行なう。'
    const at = text.indexOf('行なう')
    const fakeResult = {
      filePath: 'sample.md',
      messages: [
        {
          ruleId: 'style/sentence-length', severity: 1, message: 'invalid report',
          index: 0, range: [Number.NaN, 2]
        },
        {
          ruleId: 'style/sentence-length', severity: 1, message: 'valid replacement',
          index: 0, range: [0, text.length],
          fix: { range: [at, at + 3], text: '行う' }
        },
        {
          ruleId: 'style/sentence-length', severity: 1, message: 'invalid replacement',
          index: 0, range: [0, 1],
          fix: { range: [0, Number.POSITIVE_INFINITY], text: 'unsafe' }
        }
      ]
    }
    vi.spyOn(TextlintKernel.prototype, 'lintText').mockResolvedValue(
      fakeResult as unknown as Awaited<ReturnType<TextlintKernel['lintText']>>
    )
    const config = testConfig()
    config.rules['style/sentence-length'] = { enabled: true, severity: 'warning' }
    const outcome = await runTextlint(text, config, 'markdown')
    expect(outcome.ruleErrors).toHaveLength(2)
    expect(outcome.ruleErrors.map(x => x.message).join('|')).toContain('UTF-16')
    expect(outcome.diagnostics).toHaveLength(2)
    const repaired = outcome.diagnostics.find(x => x.message === 'valid replacement')
    expect(repaired).toMatchObject({
      start: at, end: at + 3, fixKind: 'suggestion', replacement: '行う'
    })
    const invalidFix = outcome.diagnostics.find(x => x.message === 'invalid replacement')
    expect(invalidFix).toMatchObject({
      start: 0, end: 1, fixKind: 'none'
    })
    expect(invalidFix?.replacement).toBeUndefined()
    expect(outcome.diagnostics.every(x =>
      Number.isSafeInteger(x.start) && Number.isSafeInteger(x.end) &&
      x.start >= 0 && x.end <= text.length
    )).toBe(true)
  })
})
