import { describe, expect, test } from 'vitest'
import { validateMorphTokenSequence } from '../../src/core/nlp/morph-token-validator'
import type { MorphToken, ProseRegion } from '../../src/core/nlp/types'

const text = '前文。\n猫と猫📚です。'
const offset = text.indexOf('猫と猫')
const region: ProseRegion = {
  id: 'prose-test',
  sourceStartUtf16: offset,
  sourceEndUtf16: text.length,
  kind: 'paragraph',
  text: text.slice(offset)
}

function token(surface: string, relativeStart: number, changes: Partial<MorphToken> = {}): MorphToken {
  return {
    surface, lemma: null, reading: null, pos: 'noun',
    posDetails: ['名詞', '一般'], conjugationType: null,
    conjugationForm: null, isUnknown: null,
    startUtf16: offset + relativeStart,
    endUtf16: offset + relativeStart + surface.length,
    regionId: region.id, sentenceId: 'sentence-1',
    originalFeatures: ['名詞', '一般'],
    ...changes
  }
}

describe('AP-09 complete MorphToken contract validation', () => {
  test('accepts exact, ordered UTF-16 spans for repeated Japanese words and emoji', () => {
    const mutableFeatures = ['名詞', '一般']
    const input = [
      token('猫', 0, {
        lemma: '猫', reading: 'ネコ', isUnknown: false,
        posDetails: mutableFeatures
      }),
      token('と', 1, { pos: 'particle', posDetails: ['助詞'] }),
      token('猫', 2),
      token('📚', 3, { pos: 'symbol', sentenceId: 'sentence-1' }),
      token('です', 5, { pos: 'auxiliary', conjugationType: '特殊', conjugationForm: '基本形' })
    ]
    const result = validateMorphTokenSequence(text, region, input)
    expect(result.status).toBe('valid')
    if (result.status !== 'valid') return
    expect(result.tokens.map(t => [t.surface, t.startUtf16, t.endUtf16])).toEqual([
      ['猫', offset, offset + 1],
      ['と', offset + 1, offset + 2],
      ['猫', offset + 2, offset + 3],
      ['📚', offset + 3, offset + 5],
      ['です', offset + 5, offset + 7]
    ])
    expect(Object.isFrozen(result.tokens)).toBe(true)
    expect(Object.isFrozen(result.tokens[0]?.posDetails)).toBe(true)
    expect(Object.isFrozen(result.tokens[0]?.originalFeatures)).toBe(true)
    expect(result.tokens[0]?.posDetails).not.toBe(input[0]?.posDetails)
    mutableFeatures[0] = 'changed'
    expect(result.tokens[0]?.posDetails).toEqual(['名詞', '一般'])
  })

  test('rejects unknown POS, missing identity, broken features and wrong nullable types', () => {
    const base = token('猫', 0)
    const variants = [
      { ...base, pos: 'UNKNOWN' },
      { ...base, regionId: 'another-region' },
      { ...base, sentenceId: '' },
      { ...base, lemma: 42 },
      { ...base, reading: false },
      { ...base, conjugationType: undefined },
      { ...base, conjugationForm: [] },
      { ...base, isUnknown: 'unknown' },
      { ...base, posDetails: [null] },
      { ...base, originalFeatures: ['名詞', 42] }
    ] as unknown as MorphToken[]
    for (const invalid of variants) {
      expect(validateMorphTokenSequence(text, region, [invalid]))
        .toEqual({ status: 'invalid', reason: 'invalid-token' })
    }
  })

  test('rejects altered surfaces, geometry overflow and split surrogate pairs', () => {
    for (const candidate of [
      token('犬', 0),
      token('📚', 3, { startUtf16: offset + 4 }),
      token('📚', 3, { endUtf16: offset + 4 }),
      token('猫', 0, { startUtf16: NaN }),
      token('猫', 0, { endUtf16: Infinity }),
      token('猫', 0, { startUtf16: -1 }),
      token('猫', 0, { endUtf16: offset }),
      token('猫', 0, { endUtf16: text.length + 1 })
    ]) {
      expect(validateMorphTokenSequence(text, region, [candidate]))
        .toEqual({ status: 'invalid', reason: 'invalid-token' })
    }
  })

  test('an invalid later token fails the entire batch, not a partial success', () => {
    const result = validateMorphTokenSequence(text, region, [
      token('猫', 0), token('と', 1, { surface: '別の語' })
    ])
    expect(result).toEqual({ status: 'invalid', reason: 'invalid-token' })
    expect('tokens' in result).toBe(false)
  })

  test('rejects overlapping and reversed token sequences', () => {
    const overlap = [
      token('猫と', 0), token('と猫', 1)
    ]
    expect(validateMorphTokenSequence(text, region, overlap))
      .toEqual({ status: 'invalid', reason: 'overlap' })
    const reversed = [token('猫', 2), token('猫', 0)]
    expect(validateMorphTokenSequence(text, region, reversed))
      .toEqual({ status: 'invalid', reason: 'overlap' })
    expect(validateMorphTokenSequence(text, region, [token('猫', 0), token('猫', 2)]))
      .toMatchObject({ status: 'valid' }) // gaps are allowed
  })

  test('checks region against the current original text, not a stale snapshot', () => {
    const one = token('猫', 0)
    for (const badRegion of [
      { ...region, text: '猫ではない別の文章。' },
      { ...region, sourceStartUtf16: offset - 1 },
      { ...region, sourceEndUtf16: text.length + 1 },
      { ...region, sourceEndUtf16: offset },
      { ...region, id: '' }
    ]) {
      expect(validateMorphTokenSequence(text, badRegion, [one]))
        .toEqual({ status: 'invalid', reason: 'invalid-region' })
    }
    expect(validateMorphTokenSequence(text.replace('猫と猫', '犬と猫'), region, [one]))
      .toEqual({ status: 'invalid', reason: 'invalid-region' })
  })

  test('refuses a region containing unpaired surrogates but allows an empty token list otherwise', () => {
    const badSource = '孤立\uD800文字'
    expect(validateMorphTokenSequence(badSource, {
      id: 'bad', sourceStartUtf16: 0, sourceEndUtf16: badSource.length,
      text: badSource, kind: 'paragraph'
    }, [])).toEqual({ status: 'invalid', reason: 'invalid-region' })
    expect(validateMorphTokenSequence(text, region, []))
      .toEqual({ status: 'valid', tokens: [] })
  })
})
