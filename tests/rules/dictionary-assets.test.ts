import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  CURATED_TYPO_MANIFEST, listCuratedTypos
} from '../../src/core/dictionary/curated-typos'
import {
  serializeTypoAsset, validateDictionaryAssetRelease, verifyTypoAsset
} from '../../src/core/dictionary/asset-integrity'

const base = new URL('../../public/dictionaries/curated-common-typo-ja/1.0.0/', import.meta.url)
const fileBytes = () => new Uint8Array(readFileSync(new URL('entries.json', base)))
const fileRelease = () => JSON.parse(readFileSync(new URL('release.json', base), 'utf-8')) as unknown
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

describe('Phase 6B-2 deterministic dictionary assets', () => {
  test('checks in the exact reproducible bytes derived from the reviewed source', () => {
    const expected = serializeTypoAsset(CURATED_TYPO_MANIFEST, listCuratedTypos())
    const actual = fileBytes()
    expect(actual).toEqual(expected)
    const release = validateDictionaryAssetRelease(fileRelease())
    expect(release.pack).toEqual(CURATED_TYPO_MANIFEST)
    expect(release.asset.byteLength).toBe(expected.byteLength)
    expect(release.asset.sha256).toBe(digest(expected))
    expect(release.asset.path).toBe('entries.json')
  })

  test('validates genuine UTF-8 bytes, version, ordering, and immutable parsed records', async () => {
    const original = fileBytes()
    const asset = await verifyTypoAsset(original, fileRelease())
    expect(asset.packId).toBe(CURATED_TYPO_MANIFEST.packId)
    expect(asset.version).toBe(CURATED_TYPO_MANIFEST.version)
    expect(asset.entries.map(x => [x.wrong, x.preferred]))
      .toEqual(listCuratedTypos().map(x => [x.wrong, x.preferred]))
    expect(Object.isFrozen(asset)).toBe(true)
    expect(Object.isFrozen(asset.entries)).toBe(true)
    expect(asset.entries.every(Object.isFrozen)).toBe(true)
  })

  test('rejects same-length tampering even if the JSON is still parseable', async () => {
    const bytes = fileBytes()
    const index = bytes.indexOf(0x31) // ASCII digit in the manifest header
    expect(index).toBeGreaterThan(0)
    bytes[index] = 0x32
    await expect(verifyTypoAsset(bytes, fileRelease())).rejects.toThrow(/integrity mismatch/)
  })

  test('rejects missing bytes, wrong hashes, unsafe paths, or implausible sizes', async () => {
    const bytes = fileBytes()
    const release = fileRelease() as { asset: Record<string, unknown> }
    await expect(verifyTypoAsset(bytes.slice(0, -1), release)).rejects.toThrow(/byte length/)
    for (const asset of [
      { ...release.asset, sha256: 'f'.repeat(64) },
      { ...release.asset, sha256: 'not-a-sha' },
      { ...release.asset, path: '../entries.json' },
      { ...release.asset, byteLength: 2 * 1024 * 1024 + 1 }
    ]) {
      if (asset.sha256 === 'f'.repeat(64)) {
        await expect(verifyTypoAsset(bytes, { ...release, asset })).rejects.toThrow(/integrity mismatch/)
      } else {
        expect(() => validateDictionaryAssetRelease({ ...release, asset })).toThrow()
      }
    }
  })

  test('does not trust a matching hash if schema, entries, or declared count are wrong', async () => {
    const original = JSON.parse(new TextDecoder().decode(fileBytes())) as {
      schemaVersion: number
      packId: string
      version: string
      entries: Array<{ wrong: string; preferred: string }>
    }
    original.entries[1] = { ...original.entries[0]! }
    const bytes = new TextEncoder().encode(JSON.stringify(original) + '\n')
    const release = fileRelease() as { asset: Record<string, unknown> }
    await expect(verifyTypoAsset(bytes, {
      ...release, asset: { ...release.asset, byteLength: bytes.length, sha256: digest(bytes) }
    })).rejects.toThrow(/duplicated/)
  })
})
