import { describe, expect, test } from 'vitest'
import { Utf8OffsetMap } from '../../src/core/nlp/offset-map'

describe('AP-09 exact UTF-8 byte to UTF-16 position mapping', () => {
  test('maps ASCII, Japanese, emoji, combining marks and CRLF at scalar boundaries', () => {
    const text = 'Aあ📚e\u0301\r\n'
    const map = new Utf8OffsetMap(text)
    expect(map.utf16Length).toBe(text.length)
    expect(map.utf16Length).toBe(8)
    expect(map.utf8ByteLength).toBe(new TextEncoder().encode(text).byteLength)
    expect(map.utf8ByteLength).toBe(13)
    expect(map.codePointLength).toBe(7)

    // [byte, utf16] boundaries, including one astral emoji (4 bytes, 2 UTF-16).
    expect([
      [0, 0], [1, 1], [4, 2], [8, 4], [9, 5],
      [11, 6], [12, 7], [13, 8]
    ].map(([byte, utf16]) => [
      map.utf16AtByte(byte), map.byteAtUtf16(utf16)
    ])).toEqual([
      [0, 0], [1, 1], [2, 4], [4, 8], [5, 9],
      [6, 11], [7, 12], [8, 13]
    ])
    expect(map.utf16AtByte(5)).toBeNull()
    expect(map.utf16AtByte(6)).toBeNull()
    expect(map.utf16AtByte(7)).toBeNull()
    expect(map.byteAtUtf16(3)).toBeNull()
    expect(map.utf16AtCodePoint(3)).toBe(4)
    expect(map.mapToken(4, 8, '📚', 10)).toEqual({
      startUtf16: 12, endUtf16: 14
    })
    expect(text.slice(2, 4)).toBe('📚')
  })

  test('round-trips all valid codepoint boundaries against TextEncoder', () => {
    const examples = [
      '', 'ABC', '日本語の文章。', '👩‍💻と🏳️‍🌈', 'か\u3099', '\r\n改行',
      '𠀋a😀', '\u0000\u007F\u0080\u07FF\u0800\uFFFF'
    ]
    for (const text of examples) {
      const map = new Utf8OffsetMap(text)
      let utf16 = 0
      let codePoint = 0
      expect(map.utf16AtByte(0)).toBe(0)
      for (const scalar of text) {
        const byte = new TextEncoder().encode(text.slice(0, utf16)).byteLength
        expect(map.utf16AtByte(byte)).toBe(utf16)
        expect(map.byteAtUtf16(utf16)).toBe(byte)
        expect(map.utf16AtCodePoint(codePoint)).toBe(utf16)
        utf16 += scalar.length
        codePoint++
      }
      const allBytes = new TextEncoder().encode(text).byteLength
      expect(map.utf8ByteLength).toBe(allBytes)
      expect(map.utf16AtByte(allBytes)).toBe(text.length)
      expect(map.byteAtUtf16(text.length)).toBe(allBytes)
      expect(map.utf16AtCodePoint(codePoint)).toBe(text.length)
    }
  })

  test('rejects UTF-8 offsets into multibyte scalars and mid-surrogate UTF-16', () => {
    const map = new Utf8OffsetMap('👩‍💻')
    expect(map.utf8ByteLength).toBe(11)
    expect(map.utf16Length).toBe(5)
    for (const offset of [1, 2, 3, 5, 6, 8, 9, 10, -1, 1.5, Infinity, NaN]) {
      expect(map.utf16AtByte(offset)).toBeNull()
    }
    expect(map.utf16AtByte(4)).toBe(2)
    expect(map.utf16AtByte(7)).toBe(3)
    expect(map.byteAtUtf16(1)).toBeNull()
    expect(map.byteAtUtf16(4)).toBeNull()
    expect(map.utf16AtCodePoint(1)).toBe(2)
    expect(map.utf16AtCodePoint(2)).toBe(3)
    expect(map.utf16AtCodePoint(3)).toBe(5)
    expect(map.mapToken(0, 4, '👩')).toEqual({ startUtf16: 0, endUtf16: 2 })
    expect(map.mapToken(0, 11, '👩‍💻')).toEqual({ startUtf16: 0, endUtf16: 5 })
  })

  test('rejects unpaired UTF-16 surrogates rather than silently using U+FFFD', () => {
    for (const text of ['\uD800', '\uDC00', 'a\uD800x', 'x\uDC00a', '\uD800\uD800', '\uDC00\uD800']) {
      expect(() => new Utf8OffsetMap(text)).toThrow('Invalid unpaired surrogate')
    }
    expect(() => new Utf8OffsetMap('\uD83D\uDCDA')).not.toThrow() // 📚
  })

  test('rejects mismatched token surface, offset arithmetic and invalid spans', () => {
    const map = new Utf8OffsetMap('が行く。')
    const length = map.utf8ByteLength
    expect(map.mapToken(0, 3, 'が', 4)).toEqual({ startUtf16: 4, endUtf16: 5 })
    for (const [start, end, surface, base] of [
      [0, 3, 'か', 0], // no NFC/NFKC equivalence: exact source text
      [0, 3, '', 0],
      [0, 0, 'が', 0],
      [3, 0, 'が', 0],
      [-1, 3, 'が', 0],
      [0, length + 1, 'が', 0],
      [1, 3, 'が', 0],
      [0, 3, 'が', -1],
      [0, 3, 'が', 0.5],
      [0, 3, 'が', Number.MAX_SAFE_INTEGER],
      [NaN, 3, 'が', 0],
      [0, Infinity, 'が', 0]
    ] as const) {
      expect(map.mapToken(start, end, surface, base)).toBeNull()
    }
    expect(map.utf16AtCodePoint(-1)).toBeNull()
    expect(map.utf16AtCodePoint(1.5)).toBeNull()
    expect(map.utf16AtCodePoint(Infinity)).toBeNull()
    expect(map.utf16AtCodePoint(map.codePointLength + 1)).toBeNull()
  })

  test('empty region is well-defined without admitting zero-length tokens', () => {
    const map = new Utf8OffsetMap('')
    expect(map.utf8ByteLength).toBe(0)
    expect(map.utf16Length).toBe(0)
    expect(map.codePointLength).toBe(0)
    expect(map.utf16AtByte(0)).toBe(0)
    expect(map.utf16AtCodePoint(0)).toBe(0)
    expect(map.mapToken(0, 0, '')).toBeNull()
  })
})
