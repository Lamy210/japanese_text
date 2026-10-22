/**
 * Phase 6B-1: validated metadata for static dictionary packs.
 *
 * Manifests describe data; they never grant executable plugin permissions or
 * independently prove third-party redistribution rights.
 */
export interface DictionaryPackManifest {
  readonly schemaVersion: 1
  readonly packId: string
  readonly version: string
  readonly locale: 'ja-JP'
  readonly kind: 'typo' | 'terminology' | 'lexicon' | 'confusable'
  readonly distribution: 'bundled' | 'optional'
  readonly entryCount: number
  readonly provenance: {
    readonly origin: 'first-party' | 'third-party'
    readonly licenseId: string
    readonly reviewStatus: 'pending' | 'approved'
    readonly sourceUrl?: string
  }
}

const PACK_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u
const VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/u
const LICENSE_ID = /^[A-Za-z0-9][A-Za-z0-9.-]*$/u
const KINDS = new Set<DictionaryPackManifest['kind']>(['typo', 'terminology', 'lexicon', 'confusable'])
const DISTRIBUTIONS = new Set<DictionaryPackManifest['distribution']>(['bundled', 'optional'])
const ORIGINS = new Set<DictionaryPackManifest['provenance']['origin']>(['first-party', 'third-party'])
const REVIEWS = new Set<DictionaryPackManifest['provenance']['reviewStatus']>(['pending', 'approved'])

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function validHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname.length > 0 &&
      url.username.length === 0 && url.password.length === 0
  } catch {
    return false
  }
}

/**
 * Return an immutable, detached manifest or reject malformed/unreviewed input.
 * A validated manifest does NOT imply license verification was performed:
 * reviewStatus is declared metadata and still requires maintainer review.
 */
export function validateDictionaryPackManifest(input: unknown): DictionaryPackManifest {
  const value = record(input)
  if (value === null ||
    value.schemaVersion !== 1 ||
    typeof value.packId !== 'string' || !PACK_ID.test(value.packId) ||
    typeof value.version !== 'string' || !VERSION.test(value.version) ||
    value.locale !== 'ja-JP' ||
    !KINDS.has(value.kind as DictionaryPackManifest['kind']) ||
    !DISTRIBUTIONS.has(value.distribution as DictionaryPackManifest['distribution']) ||
    !Number.isSafeInteger(value.entryCount) || (value.entryCount as number) <= 0 ||
    (value.entryCount as number) > 10_000_000) {
    throw new Error('Invalid dictionary pack manifest')
  }
  const provenance = record(value.provenance)
  if (provenance === null ||
    !ORIGINS.has(provenance.origin as DictionaryPackManifest['provenance']['origin']) ||
    typeof provenance.licenseId !== 'string' || !LICENSE_ID.test(provenance.licenseId) ||
    !REVIEWS.has(provenance.reviewStatus as DictionaryPackManifest['provenance']['reviewStatus']) ||
    (provenance.sourceUrl !== undefined && !validHttpsUrl(provenance.sourceUrl)) ||
    (provenance.origin === 'third-party' &&
      (!validHttpsUrl(provenance.sourceUrl) || provenance.licenseId === 'NOASSERTION'))) {
    throw new Error('Invalid dictionary pack provenance')
  }

  return Object.freeze({
    schemaVersion: 1 as const,
    packId: value.packId,
    version: value.version,
    locale: 'ja-JP' as const,
    kind: value.kind as DictionaryPackManifest['kind'],
    distribution: value.distribution as DictionaryPackManifest['distribution'],
    entryCount: value.entryCount as number,
    provenance: Object.freeze({
      origin: provenance.origin as DictionaryPackManifest['provenance']['origin'],
      licenseId: provenance.licenseId as string,
      reviewStatus: provenance.reviewStatus as DictionaryPackManifest['provenance']['reviewStatus'],
      ...(typeof provenance.sourceUrl === 'string' ? { sourceUrl: provenance.sourceUrl } : {})
    })
  })
}
