import { describe, expect, test } from 'vitest'
import { normalizeTextlintMessageSpan } from '../../src/core/engine/textlint-span'

describe('textlint diagnostic vs fix coordinates (UTF-16)', () => {
  test('keeps a report without a FixCommand as non-actionable', () => {
    expect(normalizeTextlintMessageSpan({ range: [2, 5] }, 8)).toEqual({
      start: 2, end: 5, fixKind: 'none', invalidFix: false
    })
    expect(normalizeTextlintMessageSpan({ index: 8 }, 8)).toEqual({
      start: 8, end: 8, fixKind: 'none', invalidFix: false
    })
  })

  test('uses FixCommand.range, not the broader diagnostic report range', () => {
    const text = '📚手順を行なう。'
    const offset = text.indexOf('行なう')
    expect(offset).toBe(6) // emoji occupies two UTF-16 code units
    const result = normalizeTextlintMessageSpan({
      range: [0, text.length],
      fix: { range: [offset, offset + 3], text: '行う' }
    }, text.length)
    expect(result).toEqual({
      start: offset, end: offset + 3,
      fixKind: 'suggestion', invalidFix: false, replacement: '行う'
    })
    if (!result || result.fixKind !== 'suggestion') throw new Error('expected validated fix')
    expect(text.slice(0, result.start) + result.replacement + text.slice(result.end))
      .toBe('📚手順を行う。')
  })

  test.each([
    { range: [Number.NaN, 4] },
    { range: [1, Number.POSITIVE_INFINITY] },
    { range: [1.5, 4] },
    { range: [-1, 4] },
    { range: [7, 2] },
    { range: [0, 9] },
    { range: [0] },
    { range: [0, 1, 2] },
    { range: ['1', 2] },
    { index: Number.NaN },
    { index: Number.NEGATIVE_INFINITY },
    { index: 100 },
    {}
  ])('rejects a nonfinite, malformed or out-of-bounds report: %j', input => {
    expect(normalizeTextlintMessageSpan(input as { range?: readonly number[]; index?: number }, 8)).toBeNull()
  })

  test('invalid fix targets are downgraded, not exposed as clickable Quick Fixes', () => {
    const report = [0, 6] as const
    for (const fix of [
      { range: [Number.NaN, 2], text: 'x' },
      { range: [2, Number.POSITIVE_INFINITY], text: 'x' },
      { range: [5, 3], text: 'x' },
      { range: [-1, 2], text: 'x' },
      { range: [0, 9], text: 'x' },
      { range: [0, 2.5], text: 'x' },
      { range: [0, 2], text: 99 },
      { text: 'x' }
    ]) {
      expect(normalizeTextlintMessageSpan({ range: report, fix }, 8)).toEqual({
        start: 0, end: 6, fixKind: 'none', invalidFix: true
      })
    }
  })

  test('valid insertion and removal fixes retain their exact UTF-16 boundaries', () => {
    expect(normalizeTextlintMessageSpan({
      range: [0, 1], fix: { range: [8, 8], text: '。' }
    }, 8)).toMatchObject({ start: 8, end: 8, fixKind: 'suggestion', replacement: '。' })
    expect(normalizeTextlintMessageSpan({
      range: [0, 3], fix: { range: [0, 3], text: '' }
    }, 8)).toMatchObject({ start: 0, end: 3, fixKind: 'suggestion', replacement: '' })
  })
})
