import { describe, expect, test } from 'vitest'
import { normalizeDiagnostics } from '../../src/core/engine/engine'
import { LineIndex } from '../../src/core/text/positions'
import type { RawDiagnostic } from '../../src/core/types'

const ruleId = 'typography/test-scalar-boundary'
const report = (start: number, end: number): RawDiagnostic => ({
  start, end, message: 'Test diagnostic', fixKind: 'suggestion', replacement: '本'
})

function normalize(text: string, start: number, end: number) {
  return normalizeDiagnostics([report(start, end)], ruleId, 'core', new LineIndex(text))
}

describe('builtin diagnostic normalization at UTF-16 scalar boundaries', () => {
  test('rejects diagnostics ending or starting in the middle of emoji', () => {
    const text = 'A📚B'
    expect(text.length).toBe(4)
    // Half a surrogate pair is inside the document and has an integer offset,
    // so the old range-only validator incorrectly accepted these reports.
    expect(() => normalize(text, 1, 2)).toThrow('Invalid diagnostic range')
    expect(() => normalize(text, 2, 3)).toThrow('Invalid diagnostic range')
    expect(() => normalize(text, 2, 2)).toThrow('Invalid diagnostic range')
    expect(() => normalize(text, 2, 4)).toThrow('Invalid diagnostic range')
  })

  test('accepts complete surrogate pairs, regular characters, and document end', () => {
    const text = 'A📚B'
    expect(normalize(text, 1, 3)).toMatchObject([{
      start: 1, end: 3, id: `${ruleId}@1-3`,
      source: 'core', fixKind: 'suggestion', replacement: '本'
    }])
    expect(normalize(text, 3, 4)).toMatchObject([{ start: 3, end: 4 }])
    expect(normalize(text, 4, 4)).toMatchObject([{ start: 4, end: 4 }])
    expect(normalize(text, 0, 1)).toMatchObject([{ start: 0, end: 1 }])
  })

  test('retains integer/range validation while tolerating isolated surrogates already in input', () => {
    const text = 'A\uD83DB' // isolated high surrogate; cannot invent a matching low surrogate
    expect(normalize(text, 1, 2)).toHaveLength(1)
    expect(() => normalize(text, -1, 0)).toThrow('Invalid diagnostic range')
    expect(() => normalize(text, 0, 99)).toThrow('Invalid diagnostic range')
    expect(() => normalize(text, Number.NaN, 1)).toThrow('Invalid diagnostic range')
    expect(() => normalize(text, 1, 0)).toThrow('Invalid diagnostic range')
  })

  test('LineIndex exposes exactly the same UTF-16 offset contract', () => {
    const index = new LineIndex('A📚B')
    expect([0, 1, 3, 4].map(offset => index.isCodePointBoundary(offset)))
      .toEqual([true, true, true, true])
    expect(index.isCodePointBoundary(2)).toBe(false)
    expect(index.isCodePointBoundary(-1)).toBe(false)
    expect(index.isCodePointBoundary(5)).toBe(false)
  })
})
