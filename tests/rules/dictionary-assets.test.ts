import { describe, expect, test } from 'vitest'
import { CURATED_TYPO_MANIFEST, listCuratedTypos } from '../../src/core/dictionary/curated-typos'
import {
  serializeTypoAsset, validateDictionaryAssetRelease, verifyTypoAsset
} from '../../src/core/dictionary/asset-integrity'

const PINNED_SHA256 = '619835297f261cbb44305ddc05843366a1d0283f77c397d18b802373f248ed38'
const PINNED_BYTE_LENGTH = 620

function canonicalBytes(): Uint8Array {
  return serializeTypoAsset(CURATED_TYPO_MANIFEST, listCuratedTypos())
}

function pinnedRelease() {
  return {
    schemaVersion: 1,
    pack: CURATED_TYPO_MANIFEST,
    asset: {
      path: 'entries.json',
      mediaType: 'application/json',
      encoding: 'utf-8',
      byteLength: PINNED_BYTE_LENGTH,
      sha256: PINNED_SHA256
    }
  }
}

async function digest(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const hash = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer)
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')
}

describe('Phase 6B-2 deterministic dictionary assets', () => {
  test('pins byte-for-byte reproducible source output to a known SHA-256', async () => {
    const expected = canonicalBytes()
    expect(expected.byteLength).toBe(PINNED_BYTE_LENGTH)
    expect(await digest(expected)).toBe(PINNED_SHA256)
    const release = validateDictionaryAssetRelease(pinnedRelease())
    expect(release.pack).toEqual(CURATED_TYPO_MANIFEST)
    expect(release.asset.sha256).toBe(PINNED_SHA256)
  })

  test('verifies canonical UTF-8 bytes, version, ordering, and immutable records', async () => {
    const asset = await verifyTypoAsset(canonicalBytes(), pinnedRelease())
    expect(asset.packId).toBe(CURATED_TYPO_MANIFEST.packId)
    expect(asset.version).toBe(CURATED_TYPO_MANIFEST.version)
    expect(asset.entries.map(x => [x.wrong, x.preferred]))
      .toEqual(listCuratedTypos().map(x => [x.wrong, x.preferred]))
    expect(Object.isFrozen(asset)).toBe(true)
    expect(Object.isFrozen(asset.entries)).toBe(true)
    expect(asset.entries.every(Object.isFrozen)).toBe(true)
  })

  test('rejects same-length tampering even when JSON remains parseable', async () => {
    const bytes = canonicalBytes()
    const index = bytes.indexOf(0x31)
    expect(index).toBeGreaterThan(0)
    bytes[index] = 0x32
    await expect(verifyTypoAsset(bytes, pinnedRelease())).rejects.toThrow(/integrity mismatch/)
  })

  test('rejects truncation and unsafe descriptors', async () => {
    const bytes = canonicalBytes()
    await expect(verifyTypoAsset(bytes.slice(0, -1), pinnedRelease())).rejects.toThrow(/byte length/)
    await expect(verifyTypoAsset(bytes, {
      ...pinnedRelease(),
      asset: { ...pinnedRelease().asset, sha256: 'f'.repeat(64) }
    })).rejects.toThrow(/integrity mismatch/)

    for (const asset of [
      { ...pinnedRelease().asset, sha256: 'invalid' },
      { ...pinnedRelease().asset, path: '../entries.json' },
      { ...pinnedRelease().asset, byteLength: 2 * 1024 * 1024 + 1 }
    ]) {
      expect(() => validateDictionaryAssetRelease({ ...pinnedRelease(), asset })).toThrow()
    }
  })

  test('refuses duplicate entries even when an attacker updates the matching digest', async () => {
    const original = JSON.parse(new TextDecoder().decode(canonicalBytes())) as {
      schemaVersion: number
      packId: string
      version: string
      entries: Array<{ wrong: string; preferred: string }>
    }
    original.entries[1] = { ...original.entries[0]! }
    const bytes = new TextEncoder().encode(JSON.stringify(original) + '\n')
    const release = {
      ...pinnedRelease(),
      asset: { ...pinnedRelease().asset, byteLength: bytes.length, sha256: await digest(bytes) }
    }
    await expect(verifyTypoAsset(bytes, release)).rejects.toThrow(/duplicated/)
  })
})
