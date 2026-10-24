/**
 * AP-09 MorphToken acceptance boundary.
 *
 * Provider output is untrusted even after a tokenizer successfully returns.
 * Validate every token against the current original ProseRegion and reject the
 * entire batch if any identity, POS field or geometry is inconsistent.
 */
import { Utf8OffsetMap } from './offset-map'
import type { MorphToken, ProseRegion } from './types'

export type MorphTokenValidation =
  | { readonly status: 'valid'; readonly tokens: readonly MorphToken[] }
  | { readonly status: 'invalid'; readonly reason: 'invalid-region' | 'invalid-token' | 'overlap' }

const POS = new Set<MorphToken['pos']>([
  'noun', 'verb', 'adjective', 'particle', 'auxiliary',
  'adverb', 'conjunction', 'symbol', 'other'
])

function stringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function strings(values: unknown): values is readonly string[] {
  return Array.isArray(values) && values.every(value => typeof value === 'string')
}

function originalRegion(source: string, region: ProseRegion): boolean {
  return typeof source === 'string' &&
    region !== null && typeof region === 'object' &&
    typeof region.id === 'string' && region.id.length > 0 &&
    typeof region.text === 'string' &&
    Number.isSafeInteger(region.sourceStartUtf16) &&
    Number.isSafeInteger(region.sourceEndUtf16) &&
    region.sourceStartUtf16 >= 0 &&
    region.sourceEndUtf16 > region.sourceStartUtf16 &&
    region.sourceEndUtf16 <= source.length &&
    source.slice(region.sourceStartUtf16, region.sourceEndUtf16) === region.text
}

function tokenFieldsValid(token: MorphToken, region: ProseRegion): boolean {
  return token !== null && typeof token === 'object' &&
    token.regionId === region.id &&
    typeof token.sentenceId === 'string' && token.sentenceId.length > 0 &&
    typeof token.surface === 'string' && token.surface.length > 0 &&
    stringOrNull(token.lemma) &&
    stringOrNull(token.reading) &&
    typeof token.pos === 'string' && POS.has(token.pos) &&
    strings(token.posDetails) &&
    stringOrNull(token.conjugationType) &&
    stringOrNull(token.conjugationForm) &&
    (token.isUnknown === null || typeof token.isUnknown === 'boolean') &&
    strings(token.originalFeatures) &&
    Number.isSafeInteger(token.startUtf16) &&
    Number.isSafeInteger(token.endUtf16) &&
    token.startUtf16 >= region.sourceStartUtf16 &&
    token.endUtf16 > token.startUtf16 &&
    token.endUtf16 <= region.sourceEndUtf16
}

/**
 * Every token is anchored to original source, even for repeated surfaces.
 * No normalization, guessing or partial result recovery is permitted.
 * The accepted array and its nested feature arrays are owned, frozen copies.
 */
export function validateMorphTokenSequence(
  source: string,
  region: ProseRegion,
  candidates: readonly MorphToken[]
): MorphTokenValidation {
  const invalid = (reason: 'invalid-region' | 'invalid-token' | 'overlap'): MorphTokenValidation =>
    Object.freeze({ status: 'invalid', reason })

  if (!originalRegion(source, region)) return invalid('invalid-region')
  if (!Array.isArray(candidates)) return invalid('invalid-token')
  let mapping: Utf8OffsetMap
  try {
    mapping = new Utf8OffsetMap(region.text)
  } catch {
    return invalid('invalid-region')
  }

  const tokens: MorphToken[] = []
  let previousEnd = region.sourceStartUtf16
  for (const token of candidates) {
    if (!tokenFieldsValid(token, region)) return invalid('invalid-token')
    if (token.startUtf16 < previousEnd) return invalid('overlap')
    const relativeStart = token.startUtf16 - region.sourceStartUtf16
    const relativeEnd = token.endUtf16 - region.sourceStartUtf16
    if (mapping.byteAtUtf16(relativeStart) === null ||
        mapping.byteAtUtf16(relativeEnd) === null ||
        source.slice(token.startUtf16, token.endUtf16) !== token.surface) {
      return invalid('invalid-token')
    }
    previousEnd = token.endUtf16
    tokens.push(Object.freeze({
      surface: token.surface,
      lemma: token.lemma,
      reading: token.reading,
      pos: token.pos,
      posDetails: Object.freeze([...token.posDetails]),
      conjugationType: token.conjugationType,
      conjugationForm: token.conjugationForm,
      isUnknown: token.isUnknown,
      startUtf16: token.startUtf16,
      endUtf16: token.endUtf16,
      regionId: token.regionId,
      sentenceId: token.sentenceId,
      originalFeatures: Object.freeze([...token.originalFeatures])
    }))
  }
  return Object.freeze({ status: 'valid', tokens: Object.freeze(tokens) })
}
