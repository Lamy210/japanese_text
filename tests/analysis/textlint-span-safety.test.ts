import { describe, expect, test } from 'vitest'
import { normalizeTextlintMessageSpan } from '../../src/core/engine/textlint-span'

describe('textlint diagnostic vs fix coordinates (UTF-16)', () => {
  const ascii = 'abcdefgh'
  test('keeps a report without a FixCommand as non-actionable', () => {
    expect(normalizeTextlintMessageSpan({ range: [2, 5] }, ascii)).toEqual({
      start: 2, end: 5, fixKind: 'none', invalidFix: false
    })
    expect(normalizeTextlintMessageSpan({ index: 8 }, ascii)).toEqual({
      start: 8, end: 8, fixKind: 'none', invalidFix: false
    })
  })

  test('uses FixCommand.range, not the broader diagnostic report range', () => {
    const text = '📚手順を行なう。'
    const offset = text.indexOf('行なう')
    expect(offset).toBe(5) // emoji occupies two UTF-16 code units
    const result = normalizeTextlintMessageSpan({
      range: [0, text.length],
      fix: { range: [offset, offset + 3], text: '行う' }
    }, text)
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
    expect(normalizeTextlintMessageSpan(input as { range?: readonly number[]; index?: number }, ascii)).toBeNull()
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
      expect(normalizeTextlintMessageSpan({ range: report, fix }, ascii)).toEqual({
        start: 0, end: 6, fixKind: 'none', invalidFix: true
      })
    }
  })

  test('refuses report spans splitting a surrogate pair rather than fabricating a character', () => {
    const emoji = 'A📚B'
    expect(emoji.length).toBe(4)
    // Offset 2 points between the high and low surrogates of 📚.
    expect(normalizeTextlintMessageSpan({ range: [1, 2] }, emoji)).toBeNull()
    expect(normalizeTextlintMessageSpan({ range: [2, 3] }, emoji)).toBeNull()
    expect(normalizeTextlintMessageSpan({ index: 1 }, emoji)).toBeNull()
    expect(normalizeTextlintMessageSpan({ range: [1, 3] }, emoji))
      .toMatchObject({ start: 1, end: 3, fixKind: 'none' })
  })

  test('prevents a valid reporting span from exposing a broken-emoji Quick Fix', () => {
    const emoji = 'A📚B'
    for (const range of [[2, 3], [1, 2], [2, 2], [2, 4]]) {
      expect(normalizeTextlintMessageSpan({
        range: [1, 3],
        fix: { range, text: '本' }
      }, emoji)).toEqual({ start: 1, end: 3, fixKind: 'none', invalidFix: true })
    }
    expect(normalizeTextlintMessageSpan({
      range: [1, 3], fix: { range: [1, 3], text: '本' }
    }, emoji)).toEqual({
      start: 1, end: 3, fixKind: 'suggestion', invalidFix: false, replacement: '本'
    })
  })

  test('valid insertion and removal fixes retain their exact UTF-16 boundaries', () => {
    expect(normalizeTextlintMessageSpan({
      range: [0, 1], fix: { range: [8, 8], text: '。' }
    }, ascii)).toMatchObject({ start: 8, end: 8, fixKind: 'suggestion', replacement: '。' })
    expect(normalizeTextlintMessageSpan({
      range: [0, 3], fix: { range: [0, 3], text: '' }
    }, ascii)).toMatchObject({ start: 0, end: 3, fixKind: 'suggestion', replacement: '' })
  })
})
