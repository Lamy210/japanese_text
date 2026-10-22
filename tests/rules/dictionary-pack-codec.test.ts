import { describe, expect, test } from 'vitest'
import bundledPack from '../../public/dictionaries/curated-common-typo-ja/1.0.0/pack.json'
import bundledIndex from '../../public/dictionaries/curated-common-typo-ja/1.0.0/index.json'
import {
  MAX_TYPO_PACK_BYTES,
  buildCuratedPackArtifacts,
  buildCuratedTypoPack,
  serializeCuratedTypoPack,
  validateCuratedTypoPack,
  validateDictionaryAssetIndex,
  verifyCuratedTypoPackBytes
} from '../../src/core/dictionary/pack-codec'

describe('Phase 6B-2 reproducible dictionary assets', () => {
  test('serializes stable reviewed entries with no timestamps or dynamic fields', async () => {
    const first = await buildCuratedPackArtifacts()
    const second = await buildCuratedPackArtifacts()
    expect(first).toEqual(second)
    expect(first.packText).toBe(JSON.stringify(bundledPack) + '\n')
    expect(first.indexText).toBe(JSON.stringify(bundledIndex) + '\n')
    expect(serializeCuratedTypoPack(buildCuratedTypoPack())).toBe(first.packText)
    expect(first.packText.endsWith('\n')).toBe(true)
    expect(first.packText).not.toContain('generatedAt')
  })

  test('binds index to exact UTF-8 bytes via SHA-256 and restores immutable pack', async () => {
    const { packText, indexText } = await buildCuratedPackArtifacts()
    const index = validateDictionaryAssetIndex(JSON.parse(indexText))
    const bytes = new TextEncoder().encode(packText)
    expect(index.byteLength).toBe(bytes.byteLength)
    expect(index.byteLength).toBe(811)
    expect(index.sha256).toBe('f3337ca6c39f64e08c9226c9d3f31c963d9b8003f9315ade86fd05255a6f4c68')
    const result = await verifyCuratedTypoPackBytes(bytes, index)
    expect(result).toEqual(buildCuratedTypoPack())
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.manifest)).toBe(true)
    expect(Object.isFrozen(result.entries)).toBe(true)
    expect(Object.isFrozen(result.entries[0])).toBe(true)
  })

  test('rejects tampered, truncated, oversized and mismatched assets', async () => {
    const { packText, indexText } = await buildCuratedPackArtifacts()
    const bytes = new TextEncoder().encode(packText)
    const index = JSON.parse(indexText) as Record<string, unknown>
    const tampered = bytes.slice()
    tampered[100] = tampered[100]! ^ 1
    await expect(verifyCuratedTypoPackBytes(tampered, index)).rejects.toThrow('digest mismatch')
    await expect(verifyCuratedTypoPackBytes(bytes.slice(0, -1), index)).rejects.toThrow('size mismatch')
    await expect(verifyCuratedTypoPackBytes(bytes, { ...index, packId: 'different-ja' }))
      .rejects.toThrow('manifest or canonical')
    await expect(verifyCuratedTypoPackBytes(new Uint8Array(MAX_TYPO_PACK_BYTES + 1), index))
      .rejects.toThrow('size mismatch')
  })

  test('rejects malformed entries, duplicates and entry count mismatches', () => {
    const base = buildCuratedTypoPack()
    expect(() => validateCuratedTypoPack({ ...base, entries: [...base.entries, base.entries[0]] }))
      .toThrow('entry count mismatch')
    expect(() => validateCuratedTypoPack({
      ...base,
      entries: [base.entries[0], base.entries[0], ...base.entries.slice(2)]
    })).toThrow('Invalid typo pack entry')
    expect(() => validateCuratedTypoPack({
      ...base,
      entries: [{ ...base.entries[0], injected: true }, ...base.entries.slice(1)]
    })).toThrow('Invalid typo pack entry')
    expect(() => validateCuratedTypoPack({ ...base, unexpected: true })).toThrow()
    expect(() => validateCuratedTypoPack({
      ...base,
      entries: [{ wrong: 'a', preferred: 'a' }, ...base.entries.slice(1)]
    })).toThrow()
  })

  test('rejects malformed integrity metadata and traversal-like filenames', () => {
    expect(() => validateDictionaryAssetIndex({ ...bundledIndex, assetFile: '../pack.json' })).toThrow()
    expect(() => validateDictionaryAssetIndex({ ...bundledIndex, sha256: 'ab'.repeat(32).toUpperCase() })).toThrow()
    expect(() => validateDictionaryAssetIndex({ ...bundledIndex, byteLength: 0 })).toThrow()
    expect(() => validateDictionaryAssetIndex({ ...bundledIndex, packId: '../test' })).toThrow()
    expect(() => validateDictionaryAssetIndex({ ...bundledIndex, additional: true })).toThrow()
  })
})
