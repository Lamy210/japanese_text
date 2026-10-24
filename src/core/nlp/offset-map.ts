/**
 * AP-09 foundation: exact UTF-8 byte / code-point -> original UTF-16 mapping.
 *
 * Build this from an unmasked ProseRegion.text, never the U+FFFF-masked
 * document. No normalization or replacement-character repair is permitted.
 * The mapping contains only whole Unicode-scalar boundaries.
 */
export interface Utf16TokenSpan {
  readonly startUtf16: number
  readonly endUtf16: number
}

export class Utf8OffsetMap {
  readonly utf8ByteLength: number
  readonly utf16Length: number
  readonly codePointLength: number

  private readonly byteToUtf16: ReadonlyMap<number, number>
  private readonly utf16ToByte: ReadonlyMap<number, number>
  private readonly codePointToUtf16: readonly number[]
  private readonly text: string

  constructor(regionText: string) {
    this.text = regionText
    const bytes = new Map<number, number>([[0, 0]])
    const units = new Map<number, number>([[0, 0]])
    const codePoints = [0]
    let byteOffset = 0
    let utf16Offset = 0

    for (const scalar of regionText) {
      const codePoint = scalar.codePointAt(0)!
      // TextEncoder replaces unpaired surrogates with U+FFFD, so allowing
      // them would make provider bytes disagree with source.slice().
      if (codePoint >= 0xD800 && codePoint <= 0xDFFF) {
        throw new Error('Invalid unpaired surrogate in NLP source region')
      }
      const byteWidth = codePoint <= 0x7F ? 1
        : codePoint <= 0x7FF ? 2
          : codePoint <= 0xFFFF ? 3 : 4
      utf16Offset += scalar.length
      byteOffset += byteWidth
      bytes.set(byteOffset, utf16Offset)
      units.set(utf16Offset, byteOffset)
      codePoints.push(utf16Offset)
    }

    this.utf8ByteLength = byteOffset
    this.utf16Length = utf16Offset
    this.codePointLength = codePoints.length - 1
    this.byteToUtf16 = bytes
    this.utf16ToByte = units
    this.codePointToUtf16 = Object.freeze(codePoints)
  }

  /** Null means not a Unicode-scalar boundary, unsafe integer, or out of range. */
  utf16AtByte(byteOffset: number): number | null {
    if (!Number.isSafeInteger(byteOffset)) return null
    return this.byteToUtf16.get(byteOffset) ?? null
  }

  /** Reject the midpoint of a surrogate pair instead of rounding. */
  byteAtUtf16(utf16Offset: number): number | null {
    if (!Number.isSafeInteger(utf16Offset)) return null
    return this.utf16ToByte.get(utf16Offset) ?? null
  }

  /** 0-based code point boundary, not grapheme-cluster boundary. */
  utf16AtCodePoint(index: number): number | null {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.codePointToUtf16.length) {
      return null
    }
    return this.codePointToUtf16[index]!
  }

  /**
   * Validate a token's exact UTF-8 byte span AND original surface before
   * converting to absolute source offsets. This cannot split codepoints,
   * normalize text or silently repair a provider's incorrect offsets.
   */
  mapToken(
    byteStart: number,
    byteEnd: number,
    surface: string,
    regionStartUtf16 = 0
  ): Utf16TokenSpan | null {
    if (!Number.isSafeInteger(byteStart) || !Number.isSafeInteger(byteEnd) ||
        byteStart < 0 || byteEnd <= byteStart ||
        !Number.isSafeInteger(regionStartUtf16) || regionStartUtf16 < 0 ||
        typeof surface !== 'string' || surface.length === 0) {
      return null
    }
    const relativeStart = this.utf16AtByte(byteStart)
    const relativeEnd = this.utf16AtByte(byteEnd)
    if (relativeStart === null || relativeEnd === null || relativeEnd <= relativeStart ||
        this.text.slice(relativeStart, relativeEnd) !== surface) {
      return null
    }
    const startUtf16 = regionStartUtf16 + relativeStart
    const endUtf16 = regionStartUtf16 + relativeEnd
    if (!Number.isSafeInteger(startUtf16) || !Number.isSafeInteger(endUtf16)) return null
    return Object.freeze({ startUtf16, endUtf16 })
  }
}
