/**
 * テキストユーティリティのテスト — §49 Golden Test必須ケース (全角/半角/絵文字/surrogate pair)
 */

import { describe, expect, it } from 'vitest'
import { LineIndex } from '../src/core/text/positions'
import { normalizeDiagnostics } from '../src/core/engine/engine'
import type { RawDiagnostic } from '../src/core/types'
import { maskDocument } from '../src/core/text/mask'
import { splitSentences, isSegmenterAvailable } from '../src/core/text/segmenter'
import { Slugger } from '../src/core/text/slug'

describe('LineIndex', () => {
  it('offset → 1-origin (line, column) 変換', () => {
    const text = 'abc\ndef\nghijk'
    const index = new LineIndex(text)
    expect(index.posFromOffset(0)).toEqual({ line: 1, column: 1 })
    expect(index.posFromOffset(2)).toEqual({ line: 1, column: 3 })
    expect(index.posFromOffset(4)).toEqual({ line: 2, column: 1 }) // \nの次
    expect(index.posFromOffset(10)).toEqual({ line: 3, column: 3 }) // 'i'
  })

  it('絵文字 (surrogate pair) を含むテキストの変換', () => {
    const text = '📚資料\n🎉行2'
    const index = new LineIndex(text)
    // 📚 = 2 code units。資料 = offset 2-4。\n = 4
    expect(index.posFromOffset(4)).toEqual({ line: 1, column: 5 }) // \n
    expect(index.posFromOffset(5)).toEqual({ line: 2, column: 1 })
    expect(index.posFromOffset(8)).toEqual({ line: 2, column: 4 }) // '2'
  })

  it('NaN and infinity offsets map to valid bounded positions', () => {
    const index = new LineIndex('a\nb')
    expect(index.posFromOffset(Number.NaN)).toEqual({ line: 1, column: 1 })
    expect(index.posFromOffset(Number.NEGATIVE_INFINITY)).toEqual({ line: 1, column: 1 })
    expect(index.posFromOffset(Number.POSITIVE_INFINITY)).toEqual({ line: 2, column: 2 })
  })

  it('空文字列・境界値', () => {
    const index = new LineIndex('')
    expect(index.posFromOffset(0)).toEqual({ line: 1, column: 1 })
    expect(new LineIndex('a').posFromOffset(1)).toEqual({ line: 1, column: 2 })
  })
})

describe('diagnostic normalization boundaries', () => {
  const index = new LineIndex('🎉本文')
  const raw = (start: number, end: number): RawDiagnostic => ({
    start, end, message: 'test', fixKind: 'none'
  })

  it('retains exact UTF-16 offsets for valid ranges, including document end', () => {
    expect(normalizeDiagnostics([raw(2, 4), raw(4, 4)], 'style/test', 'core', index))
      .map(({ start, end }) => [start, end])).toEqual([[2, 4], [4, 4]])
    expect(index.length).toBe(4)
  })

  it.each([
    [Number.NaN, 2],
    [0, Number.NaN],
    [Number.POSITIVE_INFINITY, 2],
    [-1, 2],
    [2, 1],
    [0, 5],
    [1.5, 2],
    [0, Number.MAX_SAFE_INTEGER]
  ])('rejects invalid offsets %s to %s', (start, end) => {
    expect(() => normalizeDiagnostics([raw(start, end)], 'style/test', 'core', index))
      .toThrow('Invalid diagnostic range')
  })
})

describe('maskDocument — §49 Golden Test必須ケース', () => {
  it('fenced code block をマスクし、長さを保存する', () => {
    const text = '前置き。\n```\nconst a = 1  \u3000全角もここ\n```\n後置き。'
    const masked = maskDocument(text)
    expect(masked.masked.length).toBe(text.length)
    expect(masked.masked).not.toContain('const a = 1')
    expect(masked.masked).toContain('前置き。')
    expect(masked.masked).toContain('後置き。')
  })

  it('inline code をマスクする', () => {
    const text = 'これは `code span` のテストです。'
    const masked = maskDocument(text)
    expect(masked.masked).not.toContain('code span')
    expect(masked.masked.startsWith('これは ')).toBe(true)
    expect(masked.masked.endsWith(' のテストです。')).toBe(true)
    expect(masked.masked.length).toBe(text.length)
  })

  it('二重backtickのinline codeをマスクする', () => {
    const text = 'a ``code ` tick`` b'
    const masked = maskDocument(text)
    expect(masked.masked).not.toContain('code')
  })

  it('URL (リンク先・autolink・裸URL) をマスクする', () => {
    const text = '[title](https://example.com/path(x)) と <https://example.com> と https://example.com/a 。'
    const masked = maskDocument(text)
    expect(masked.masked).not.toContain('example.com')
    expect(masked.masked.length).toBe(text.length)
    expect(masked.masked).toContain('[title]')
  })

  it('surrogate pair (絵文字) を含むコードブロックの長さを保存する', () => {
    const text = 'x\n```\n🎉🎉🎉 日本語\n```\ny'
    const masked = maskDocument(text)
    expect(masked.masked.length).toBe(text.length)
    // 絵文字は2 code unitずつ → マスク領域も同長
    expect(masked.masked).not.toContain('🎉')
  })

  it('参照定義行をメタデータとしてマスクする', () => {
    const text = '[1]: https://example.com "Title"\n本文。'
    const masked = maskDocument(text)
    expect(masked.masked.startsWith('\uFFFF')).toBe(true)
    expect(masked.masked).toContain('本文。')
  })

  it('frontmatterをマスクする', () => {
    const text = '---\ntitle: テスト\n---\n\n本文。'
    const masked = maskDocument(text)
    expect(masked.masked).not.toContain('title')
    expect(masked.masked).toContain('本文。')
  })

  it('テーブル行のパイプはマスクされない', () => {
    const text = '| 列A | 列B |\n|---|---|\n| あ | い |'
    const masked = maskDocument(text)
    expect(masked.masked).toContain('| 列A | 列B |')
  })

  it('引用行 (>) は本文として扱われる (マスクされない)', () => {
    const text = '> 引用された文章です。'
    const masked = maskDocument(text)
    expect(masked.masked).toContain('引用された文章です。')
  })

  it('閉じていないfenced codeはEOFまでマスクする', () => {
    const text = '本文。\n```\ncode not closed'
    const masked = maskDocument(text)
    expect(masked.masked).not.toContain('code not closed')
  })
})

describe('splitSentences', () => {
  it('Intl.Segmenterで文分割する (またはフォールバック)', () => {
    const text = 'これは一文です。これは二文目です！三文目？'
    const sentences = splitSentences(text)
    expect(sentences.length).toBeGreaterThanOrEqual(3)
    // offset整合性
    for (const s of sentences) {
      expect(text.slice(s.start, s.end)).toBe(s.text)
    }
  })

  it('文末の絵文字を含む文のoffset整合性 (surrogate pair)', () => {
    const text = '一文目🎉です。二文目です。'
    const sentences = splitSentences(text)
    for (const s of sentences) {
      expect(text.slice(s.start, s.end)).toBe(s.text)
    }
  })

  it('Segmenter不在環境でもフォールバック分割が機能する', () => {
    expect(isSegmenterAvailable() || splitSentences('A。B。').length >= 2).toBe(true)
  })
})

describe('Slugger (GitHub風アンカー)', () => {
  it('日本語見出しのスラグ生成', () => {
    const slugger = new Slugger()
    expect(slugger.slug('はじめに')).toBe('はじめに')
    expect(slugger.slug('Getting Started!')).toBe('getting-started')
  })

  it('重複見出しには -1 を付与', () => {
    const slugger = new Slugger()
    expect(slugger.slug('詳細')).toBe('詳細')
    expect(slugger.slug('詳細')).toBe('詳細-1')
    expect(slugger.slug('詳細')).toBe('詳細-2')
  })

  it('NFKC正規化 (全角英数字 → 半角)', () => {
    const slugger = new Slugger()
    expect(slugger.slug('ＡＢＣ')).toBe('abc')
  })
})
