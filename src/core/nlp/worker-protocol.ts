/**
 * AP-10 part 2: standalone, same-origin NLP Worker transport.
 * Never share the existing 3-tier Formatter Shadow protocol or imply that a
 * tokenizer is ready simply because the Worker successfully started.
 */
import { extractProseRegions } from './prose-regions'
import { validateMorphTokenSequence } from './morph-token-validator'
import type { MorphToken, ProseRegion } from './types'
import type { NlpRunIdentity } from './session-coordinator'
import type { DocumentType } from '../types'

export interface NlpRegionTokens {
  readonly region: ProseRegion
  readonly tokens: readonly MorphToken[]
}

export interface NlpAnalyzeRequest {
  readonly type: 'analyze'
  readonly identity: NlpRunIdentity
  /** Original text, kept inside this device's same-origin Worker. */
  readonly text: string
}

export type NlpWorkerResponse =
  | { readonly type: 'result'; readonly identity: NlpRunIdentity; readonly regions: readonly NlpRegionTokens[] }
  | { readonly type: 'error'; readonly identity: NlpRunIdentity; readonly code: 'provider-unavailable' | 'invalid-request' | 'provider-error' }

export type NlpBatchValidation =
  | { readonly status: 'valid'; readonly tokens: readonly MorphToken[] }
  | { readonly status: 'invalid'; readonly reason: 'region-mismatch' | 'invalid-token' }

/**
 * The Worker must return EXACTLY the region sequence we would extract from
 * the original document. No unvalidated partial "success", skipped region,
 * reordered prose, or token pointing into markup is allowed.
 */
export function validateNlpWorkerBatch(
  source: string,
  documentType: DocumentType,
  received: readonly NlpRegionTokens[]
): NlpBatchValidation {
  const invalid = (reason: 'region-mismatch' | 'invalid-token'): NlpBatchValidation =>
    ({ status: 'invalid', reason })
  if (!Array.isArray(received)) return invalid('region-mismatch')
  let expected: readonly ProseRegion[]
  try {
    expected = extractProseRegions(source, documentType)
  } catch {
    return invalid('region-mismatch')
  }
  if (received.length !== expected.length) return invalid('region-mismatch')
  const accepted: MorphToken[] = []
  for (let index = 0; index < expected.length; index++) {
    const entry = received[index]
    const originalRegion = expected[index]!
    const remoteRegion = entry?.region
    if (remoteRegion === null || typeof remoteRegion !== 'object' ||
        remoteRegion.id !== originalRegion.id ||
        remoteRegion.kind !== originalRegion.kind ||
        remoteRegion.sourceStartUtf16 !== originalRegion.sourceStartUtf16 ||
        remoteRegion.sourceEndUtf16 !== originalRegion.sourceEndUtf16 ||
        remoteRegion.text !== originalRegion.text) {
      return invalid('region-mismatch')
    }
    const checked = validateMorphTokenSequence(source, originalRegion, entry!.tokens)
    if (checked.status !== 'valid') return invalid('invalid-token')
    accepted.push(...checked.tokens)
  }
  return { status: 'valid', tokens: Object.freeze(accepted) }
}
