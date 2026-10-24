/**
 * AP-09 provider-neutral validation of byte-based token geometry.
 *
 * Fail the WHOLE region on an invalid token, ordering conflict, source
 * mismatch or ill-formed Unicode. Partial tokens must never masquerade
 * as a complete successful linguistic analysis.
 */
import { Utf8OffsetMap } from './offset-map'
import type { ProseRegion, RawByteTokenSpan, ValidatedTokenSpan } from './types'

export type RegionTokenValidation =
  | { readonly status: 'valid'; readonly tokens: readonly ValidatedTokenSpan[] }
  | { readonly status: 'invalid'; readonly reason: 'invalid-region' | 'invalid-token' | 'overlap' }

function isOriginalRegion(source: string, region: ProseRegion): boolean {
  return typeof region.id === 'string' && region.id.length > 0 &&
    typeof region.text === 'string' &&
    Number.isSafeInteger(region.sourceStartUtf16) &&
    Number.isSafeInteger(region.sourceEndUtf16) &&
    region.sourceStartUtf16 >= 0 &&
    region.sourceEndUtf16 > region.sourceStartUtf16 &&
    region.sourceEndUtf16 <= source.length &&
    source.slice(region.sourceStartUtf16, region.sourceEndUtf16) === region.text
}

/**
 * Input byte offsets are RELATIVE to region.text encoded as UTF-8.
 * Output UTF-16 offsets are ABSOLUTE in the unmodified original document.
 */
export function validateByteTokenSequence(
  source: string,
  region: ProseRegion,
  rawTokens: readonly RawByteTokenSpan[]
): RegionTokenValidation {
  const invalid = (reason: 'invalid-region' | 'invalid-token' | 'overlap'): RegionTokenValidation =>
    Object.freeze({ status: 'invalid', reason })

  if (!isOriginalRegion(source, region)) return invalid('invalid-region')
  let mapping: Utf8OffsetMap
  try {
    mapping = new Utf8OffsetMap(region.text)
  } catch {
    return invalid('invalid-region')
  }

  const tokens: ValidatedTokenSpan[] = []
  let previousEnd = 0
  for (const token of rawTokens) {
    if (token === null || typeof token !== 'object' ||
        !Number.isSafeInteger(token.byteStart) || !Number.isSafeInteger(token.byteEnd) ||
        typeof token.surface !== 'string') {
      return invalid('invalid-token')
    }
    const mapped = mapping.mapToken(
      token.byteStart, token.byteEnd, token.surface, region.sourceStartUtf16
    )
    if (mapped === null || mapped.startUtf16 < region.sourceStartUtf16 ||
        mapped.endUtf16 > region.sourceEndUtf16 ||
        source.slice(mapped.startUtf16, mapped.endUtf16) !== token.surface) {
      return invalid('invalid-token')
    }
    if (token.byteStart < previousEnd) return invalid('overlap')
    previousEnd = token.byteEnd
    tokens.push(Object.freeze({
      byteStart: token.byteStart,
      byteEnd: token.byteEnd,
      surface: token.surface,
      regionId: region.id,
      startUtf16: mapped.startUtf16,
      endUtf16: mapped.endUtf16
    }))
  }
  return Object.freeze({ status: 'valid', tokens: Object.freeze(tokens) })
}
