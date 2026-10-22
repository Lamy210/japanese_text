import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

beforeEach(() => {
  // Fresh module instance: simulate a new browser page with no feature probe.
  vi.resetModules()
})
afterEach(() => vi.unstubAllGlobals())

describe('AP-01: sentence segmenter initialization and fallback', () => {
  test('uses native Intl.Segmenter on the first direct split, without an availability probe', async () => {
    let constructors = 0
    vi.stubGlobal('Intl', {
      Segmenter: class {
        constructor(locale: string, options: { granularity: string }) {
          expect(locale).toBe('ja')
          expect(options.granularity).toBe('sentence')
          constructors++
        }
        segment(text: string) {
          // Deliberately one segment: fallback would produce two.
          return [{ index: 0, segment: text }]
        }
      }
    })
    const { splitSentences, isSegmenterAvailable } = await import('../../src/core/text/segmenter')
    const text = '前半。後半。'
    expect(splitSentences(text)).toEqual([{ start: 0, end: text.length, text }])
    expect(isSegmenterAvailable()).toBe(true)
    expect(splitSentences(text)).toHaveLength(1)
    expect(constructors).toBe(1)
  })

  test('falls back when Intl.Segmenter does not exist, without losing UTF-16 offsets', async () => {
    vi.stubGlobal('Intl', {})
    const { splitSentences, isSegmenterAvailable } = await import('../../src/core/text/segmenter')
    const text = '😀確認。次です。'
    const spans = splitSentences(text)
    expect(isSegmenterAvailable()).toBe(false)
    expect(spans).toEqual([
      { start: 0, end: 5, text: '😀確認。' },
      { start: 5, end: 9, text: '次です。' }
    ])
    for (const span of spans) expect(text.slice(span.start, span.end)).toBe(span.text)
  })

  test('a constructor error is cached as unavailable; later calls still work', async () => {
    let constructors = 0
    vi.stubGlobal('Intl', {
      Segmenter: class {
        constructor() {
          constructors++
          throw new Error('unavailable')
        }
      }
    })
    const { splitSentences, isSegmenterAvailable } = await import('../../src/core/text/segmenter')
    expect(splitSentences('最初。次。').map(x => x.text)).toEqual(['最初。', '次。'])
    expect(isSegmenterAvailable()).toBe(false)
    expect(splitSentences('最後。')).toHaveLength(1)
    expect(constructors).toBe(1)
  })

  test('a failing native segment call falls back without crashing the editor', async () => {
    vi.stubGlobal('Intl', {
      Segmenter: class {
        segment(): never {
          throw new Error('ICU runtime failure')
        }
      }
    })
    const { splitSentences, isSegmenterAvailable } = await import('../../src/core/text/segmenter')
    expect(isSegmenterAvailable()).toBe(true)
    expect(splitSentences('文章。続き。').map(x => x.text)).toEqual(['文章。', '続き。'])
  })

  test('empty input is safe in both native and fallback environments', async () => {
    vi.stubGlobal('Intl', {})
    const { splitSentences } = await import('../../src/core/text/segmenter')
    expect(splitSentences('')).toEqual([])
    expect(splitSentences('本文。\n')).toEqual([{ start: 0, end: 3, text: '本文。' }])
    expect(splitSentences('\n\n')).toEqual([])
    expect(splitSentences('\n\n本文。\n\n次。')).toEqual([
      { start: 2, end: 5, text: '本文。' },
      { start: 7, end: 9, text: '次。' }
    ])
  })

  test('native segment offsets remain UTF-16 indexes after an emoji', async () => {
    vi.stubGlobal('Intl', {
      Segmenter: class {
        segment() {
          return [
            { index: 0, segment: '😀確認。' },
            { index: 5, segment: '次です。' }
          ]
        }
      }
    })
    const { splitSentences } = await import('../../src/core/text/segmenter')
    const source = '😀確認。次です。'
    expect(splitSentences(source)).toEqual([
      { start: 0, end: 5, text: '😀確認。' },
      { start: 5, end: 9, text: '次です。' }
    ])
  })
})
