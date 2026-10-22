/**
 * Phase 6B-2: deterministic, browser-safe encoding for read-only typo packs.
 *
 * Source of truth remains the reviewed in-repository dictionary. This does not
 * load external input, execute plugins, or persist any user-authored text.
 */
import { CURATED_TYPO_MANIFEST, listCuratedTypos, type CuratedTypoEntry } from './curated-typos'
import { validateDictionaryPackManifest, type DictionaryPackManifest } from './manifest'

export interface CuratedTypoPackV1 {
  readonly schemaVersion: 1
  readonly manifest: DictionaryPackManifest
  readonly entries: readonly CuratedTypoEntry[]
}

export interface DictionaryAssetIndexV1 {
  readonly schemaVersion: 1
  readonly packId: string
  readonly version: string
  readonly assetFile: 'pack.json'
  readonly byteLength: number
  readonly sha256: string
}

export const MAX_TYPO_PACK_BYTES = 4 * 1024 * 1024
const MAX_TYPO_ENTRIES = 50_000
const HASH_RE = /^[0-9a-f]{64}$/u

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const found = Object.keys(value)
  return found.length === keys.length && found.every(key => keys.includes(key))
}

export function validateCuratedTypoPack(input: unknown): CuratedTypoPackV1 {
  const value = asRecord(input)
  if (!value || !exactKeys(value, ['schemaVersion', 'manifest', 'entries']) ||
      value.schemaVersion !== 1 || !Array.isArray(value.entries) ||
      value.entries.length < 1 || value.entries.length > MAX_TYPO_ENTRIES) {
    throw new Error('Invalid typo pack')
  }
  const manifest = validateDictionaryPackManifest(value.manifest)
  if (manifest.kind !== 'typo' || manifest.entryCount !== value.entries.length) {
    throw new Error('Typo pack manifest and entry count mismatch')
  }
  const entries: CuratedTypoEntry[] = []
  const seen = new Set<string>()
  for (const raw of value.entries) {
    const entry = asRecord(raw)
    if (!entry || !exactKeys(entry, ['wrong', 'preferred']) ||
        typeof entry.wrong !== 'string' || typeof entry.preferred !== 'string' ||
        entry.wrong.length < 1 || entry.wrong.length > 200 ||
        entry.preferred.length < 1 || entry.preferred.length > 200 ||
        !entry.wrong.trim() || !entry.preferred.trim() ||
        entry.wrong === entry.preferred || seen.has(entry.wrong)) {
      throw new Error('Invalid typo pack entry')
    }
    seen.add(entry.wrong)
    entries.push(Object.freeze({ wrong: entry.wrong, preferred: entry.preferred }))
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    manifest,
    entries: Object.freeze(entries)
  })
}

/** Keep key ordering and one LF stable so published bytes are reproducible. */
export function serializeCuratedTypoPack(pack: CuratedTypoPackV1): string {
  return JSON.stringify(validateCuratedTypoPack(pack)) + '\n'
}

export function buildCuratedTypoPack(): CuratedTypoPackV1 {
  return validateCuratedTypoPack({
    schemaVersion: 1,
    manifest: CURATED_TYPO_MANIFEST,
    entries: listCuratedTypos()
  })
}

export function validateDictionaryAssetIndex(input: unknown): DictionaryAssetIndexV1 {
  const value = asRecord(input)
  if (!value || !exactKeys(value, ['schemaVersion', 'packId', 'version', 'assetFile', 'byteLength', 'sha256']) ||
      value.schemaVersion !== 1 ||
      typeof value.packId !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(value.packId) ||
      typeof value.version !== 'string' ||
      !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(value.version) ||
      value.assetFile !== 'pack.json' ||
      !Number.isSafeInteger(value.byteLength) || (value.byteLength as number) < 1 ||
      (value.byteLength as number) > MAX_TYPO_PACK_BYTES ||
      typeof value.sha256 !== 'string' || !HASH_RE.test(value.sha256)) {
    throw new Error('Invalid dictionary asset index')
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    packId: value.packId,
    version: value.version,
    assetFile: 'pack.json' as const,
    byteLength: value.byteLength as number,
    sha256: value.sha256 as string
  })
}

/** Validate the exact shipped bytes before making a pack available to rules. */
export async function verifyCuratedTypoPackBytes(
  bytes: Uint8Array,
  rawIndex: unknown
): Promise<CuratedTypoPackV1> {
  const index = validateDictionaryAssetIndex(rawIndex)
  if (bytes.byteLength !== index.byteLength || bytes.byteLength > MAX_TYPO_PACK_BYTES) {
    throw new Error('Dictionary asset size mismatch')
  }
  const sha256 = await hashSha256(bytes)
  if (sha256 !== index.sha256) throw new Error('Dictionary asset digest mismatch')
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    throw new Error('Invalid JSON dictionary asset')
  }
  const pack = validateCuratedTypoPack(parsed)
  if (pack.manifest.packId !== index.packId || pack.manifest.version !== index.version ||
      serializeCuratedTypoPack(pack) !== text) {
    throw new Error('Dictionary asset manifest or canonical encoding mismatch')
  }
  return pack
}

async function hashSha256(bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function buildCuratedPackArtifacts(): Promise<{
  readonly packText: string
  readonly indexText: string
}> {
  const pack = buildCuratedTypoPack()
  const packText = serializeCuratedTypoPack(pack)
  const bytes = new TextEncoder().encode(packText)
  if (bytes.byteLength > MAX_TYPO_PACK_BYTES) throw new Error('Dictionary pack exceeds size limit')
  const sha256 = await hashSha256(bytes)
  const index = validateDictionaryAssetIndex({
    schemaVersion: 1,
    packId: pack.manifest.packId,
    version: pack.manifest.version,
    assetFile: 'pack.json',
    byteLength: bytes.byteLength,
    sha256
  })
  return { packText, indexText: JSON.stringify(index) + '\n' }
}
