/**
 * Phase 6B-2: deterministic, inert JSON assets with browser-verifiable integrity.
 * No fetch(), plugin execution or user storage occurs in this module.
 */
import { validateDictionaryPackManifest, type DictionaryPackManifest } from './manifest'

export interface DictionaryAssetRelease {
  readonly schemaVersion: 1
  readonly pack: DictionaryPackManifest
  readonly asset: {
    readonly path: 'entries.json'
    readonly mediaType: 'application/json'
    readonly encoding: 'utf-8'
    readonly byteLength: number
    readonly sha256: string
  }
}

export interface SerializedTypoEntry {
  readonly wrong: string
  readonly preferred: string
}

export interface VerifiedTypoAsset {
  readonly schemaVersion: 1
  readonly packId: string
  readonly version: string
  readonly entries: readonly SerializedTypoEntry[]
}

const HEX_SHA256 = /^[a-f0-9]{64}$/u
const MAX_BYTES = 2 * 1024 * 1024
const MAX_WORD_LENGTH = 200

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function validateDictionaryAssetRelease(input: unknown): DictionaryAssetRelease {
  const value = record(input)
  if (value === null || value.schemaVersion !== 1) throw new Error('Invalid dictionary asset release')
  const pack = validateDictionaryPackManifest(value.pack)
  if (pack.kind !== 'typo') throw new Error('Unsupported dictionary asset kind')
  const asset = record(value.asset)
  if (asset === null ||
    asset.path !== 'entries.json' || asset.mediaType !== 'application/json' ||
    asset.encoding !== 'utf-8' ||
    !Number.isSafeInteger(asset.byteLength) ||
    (asset.byteLength as number) <= 0 ||
    (asset.byteLength as number) > MAX_BYTES ||
    typeof asset.sha256 !== 'string' || !HEX_SHA256.test(asset.sha256)) {
    throw new Error('Invalid dictionary asset descriptor')
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    pack,
    asset: Object.freeze({
      path: 'entries.json' as const,
      mediaType: 'application/json' as const,
      encoding: 'utf-8' as const,
      byteLength: asset.byteLength as number,
      sha256: asset.sha256 as string
    })
  })
}

/**
 * Stable serialization, independent of map iteration order, locale and clocks.
 * Only reviewed string pairs enter the canonical build; this does not modify
 * the application's active rules.
 */
export function serializeTypoAsset(
  pack: Pick<DictionaryPackManifest, 'packId' | 'version'>,
  entries: readonly SerializedTypoEntry[]
): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    schemaVersion: 1,
    packId: pack.packId,
    version: pack.version,
    entries: entries.map(({ wrong, preferred }) => ({ wrong, preferred }))
  }) + '\n')
}

/**
 * Verify the raw bytes BEFORE interpreting untrusted JSON. A matching digest
 * authenticates bytes only against the pinned release descriptor; it is not a
 * legal/license review or a digital signature over a trusted origin.
 */
export async function verifyTypoAsset(
  bytes: Uint8Array,
  releaseInput: unknown
): Promise<VerifiedTypoAsset> {
  const release = validateDictionaryAssetRelease(releaseInput)
  if (bytes.byteLength !== release.asset.byteLength || bytes.byteLength > MAX_BYTES) {
    throw new Error('Dictionary asset byte length mismatch')
  }
  if (typeof globalThis.crypto?.subtle?.digest !== 'function') {
    throw new Error('SHA-256 verification unavailable')
  }
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const hash = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer)
  const actual = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')
  if (actual !== release.asset.sha256) throw new Error('Dictionary asset integrity mismatch')

  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(copy))
  } catch {
    throw new Error('Dictionary asset is not valid UTF-8 JSON')
  }
  const value = record(parsed)
  if (value === null ||
    value.schemaVersion !== 1 ||
    value.packId !== release.pack.packId ||
    value.version !== release.pack.version ||
    !Array.isArray(value.entries) ||
    value.entries.length !== release.pack.entryCount) {
    throw new Error('Dictionary asset metadata mismatch')
  }
  const entries: SerializedTypoEntry[] = []
  const seen = new Set<string>()
  for (const raw of value.entries) {
    const row = record(raw)
    if (row === null || typeof row.wrong !== 'string' || typeof row.preferred !== 'string' ||
      !row.wrong.trim() || !row.preferred.trim() ||
      row.wrong.length > MAX_WORD_LENGTH || row.preferred.length > MAX_WORD_LENGTH ||
      row.wrong === row.preferred || seen.has(row.wrong)) {
      throw new Error('Invalid or duplicated typo dictionary entry')
    }
    seen.add(row.wrong)
    entries.push(Object.freeze({ wrong: row.wrong, preferred: row.preferred }))
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    packId: release.pack.packId,
    version: release.pack.version,
    entries: Object.freeze(entries)
  })
}
