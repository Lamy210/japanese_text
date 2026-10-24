import { describe, expect, test } from 'vitest'
import { validateByteTokenSequence } from '../../src/core/nlp/token-validator'
import { extractProseRegions } from '../../src/core/nlp/prose-regions'
import type { ProseRegion, RawByteTokenSpan } from '../../src/core/nlp/types'

function region(source: string, text: string): ProseRegion {
  const start = source.indexOf(text)
  if (start < 0) throw new Error('fixture missing')
  return {
    id: `prose:${start}-${start + text.length}`,
    sourceStartUtf16: start,
    sourceEndUtf16: start + text.length,
    kind: 'paragraph',
    text
  }
}
function bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength
}

describe('AP-09 exact source-anchored byte-token validation', () => {
  test('maps repeated Japanese surfaces, emoji and combining marks without searching text', () => {
    const source = '前置き\n猫と猫📚e\u0301。'
    const selected = region(source, '猫と猫📚e\u0301。')
    const raw: RawByteTokenSpan[] = [
      { byteStart: 0, byteEnd: 3, surface: '猫' },
      { byteStart: 3, byteEnd: 6, surface: 'と' },
      { byteStart: 6, byteEnd: 9, surface: '猫' },
      { byteStart: 9, byteEnd: 13, surface: '📚' },
      { byteStart: 13, byteEnd: 16, surface: 'e\u0301' },
      { byteStart: 16, byteEnd: 19, surface: '。' }
    ]
    const outcome = validateByteTokenSequence(source, selected, raw)
    expect(outcome.status).toBe('valid')
    if (outcome.status !== 'valid') return
    expect(outcome.tokens.map(t => [t.surface, t.startUtf16, t.endUtf16])).toEqual([
      ['猫', 4, 5], ['と', 5, 6], ['猫', 6, 7],
      ['📚', 7, 9], ['e\u0301', 9, 11], ['。', 11, 12]
    ])
    expect(outcome.tokens.every(t =>
      source.slice(t.startUtf16, t.endUtf16) === t.surface && t.regionId === selected.id
    )).toBe(true)
    expect(Object.isFrozen(outcome.tokens)).toBe(true)
    expect(Object.isFrozen(outcome.tokens[0])).toBe(true)
  })

  test('a prose region from the extractor maps token offsets back to the original document', () => {
    const source = '# 見出し\n- 日本語📚です。\n```\n秘密\n```'
    const selected = extractProseRegions(source).find(r => r.text === '日本語📚です。')
    expect(selected).toBeDefined()
    const outcome = validateByteTokenSequence(source, selected!, [
      { byteStart: 0, byteEnd: bytes('日本語'), surface: '日本語' },
      { byteStart: bytes('日本語'), byteEnd: bytes('日本語📚'), surface: '📚' },
      { byteStart: bytes('日本語📚'), byteEnd: bytes('日本語📚です'), surface: 'です' }
    ])
    expect(outcome.status).toBe('valid')
    if (outcome.status !== 'valid') return
    expect(outcome.tokens.map(t => t.startUtf16)).toEqual([
      source.indexOf('日本語'), source.indexOf('📚'), source.indexOf('です')
    ])
  })

  test('invalid token invalidates the entire region rather than returning partial results', () => {
    const source = '猫と猫'
    const selected = region(source, source)
    const outcome = validateByteTokenSequence(source, selected, [
      { byteStart: 0, byteEnd: 3, surface: '猫' },
      { byteStart: 3, byteEnd: 6, surface: '猫' },
      { byteStart: 6, byteEnd: 9, surface: '猫' }
    ])
    expect(outcome).toEqual({ status: 'invalid', reason: 'invalid-token' })
    expect('tokens' in outcome).toBe(false)
  })

  test('rejects overlap, reversed order and duplicate token spans', () => {
    const source = '猫と猫'
    const selected = region(source, source)
    const valid = { byteStart: 0, byteEnd: 3, surface: '猫' }
    const repeated = [
      valid, { byteStart: 0, byteEnd: 3, surface: '猫' }
    ]
    expect(validateByteTokenSequence(source, selected, repeated))
      .toEqual({ status: 'invalid', reason: 'overlap' })
    const outOfOrder = [
      { byteStart: 6, byteEnd: 9, surface: '猫' }, valid
    ]
    expect(validateByteTokenSequence(source, selected, outOfOrder))
      .toEqual({ status: 'invalid', reason: 'overlap' })
    expect(validateByteTokenSequence(source, selected, [
      valid, { byteStart: 6, byteEnd: 9, surface: '猫' }
    ])).toMatchObject({ status: 'valid' }) // punctuation/spacing gaps are allowed
  })

  test('strictly rejects a stale, foreign or malformed region with no partial tokens', () => {
    const source = '本文です。'
    const good = region(source, source)
    const raw = [{ byteStart: 0, byteEnd: bytes('本文'), surface: '本文' }]
    for (const bad of [
      { ...good, text: '変更された本文です。' },
      { ...good, sourceStartUtf16: 1 },
      { ...good, sourceEndUtf16: source.length + 1 },
      { ...good, sourceStartUtf16: NaN },
      { ...good, id: '' }
    ]) {
      expect(validateByteTokenSequence(source, bad, raw))
        .toEqual({ status: 'invalid', reason: 'invalid-region' })
    }
    const malformed = region('異常\uD800です。', '異常\uD800です。')
    expect(validateByteTokenSequence('異常\uD800です。', malformed, []))
      .toEqual({ status: 'invalid', reason: 'invalid-region' })
  })

  test('rejects invalid UTF-8 geometry and surface changes at the boundary', () => {
    const source = '猫📚と'
    const selected = region(source, source)
    for (const token of [
      { byteStart: 0, byteEnd: 3, surface: '犬' },
      { byteStart: 4, byteEnd: 7, surface: '📚' },
      { byteStart: 3, byteEnd: 6, surface: '📚' },
      { byteStart: -1, byteEnd: 3, surface: '猫' },
      { byteStart: 0.5, byteEnd: 3, surface: '猫' },
      { byteStart: NaN, byteEnd: 3, surface: '猫' },
      { byteStart: 0, byteEnd: Infinity, surface: '猫' },
      { byteStart: 0, byteEnd: 0, surface: '' }
    ]) {
      expect(validateByteTokenSequence(source, selected, [token]))
        .toEqual({ status: 'invalid', reason: 'invalid-token' })
    }
  })

  test('empty token list is an explicitly valid empty result for a valid region', () => {
    const source = '句読点。'
    const selected = region(source, source)
    expect(validateByteTokenSequence(source, selected, []))
      .toEqual({ status: 'valid', tokens: [] })
  })
})
