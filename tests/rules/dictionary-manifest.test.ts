import { describe, expect, test } from 'vitest'
import { validateDictionaryPackManifest } from '../../src/core/dictionary/manifest'
import { CURATED_TYPO_MANIFEST, listCuratedTypos } from '../../src/core/dictionary/curated-typos'

const valid = () => ({
  schemaVersion: 1,
  packId: 'test-ja-typos',
  version: '1.2.3',
  locale: 'ja-JP',
  kind: 'typo',
  distribution: 'optional',
  entryCount: 4,
  provenance: {
    origin: 'first-party',
    licenseId: 'NOASSERTION',
    reviewStatus: 'pending'
  }
})

describe('dictionary pack manifest validation (Phase 6B-1)', () => {
  test('curated pack metadata exactly describes the in-repo dictionary', () => {
    expect(CURATED_TYPO_MANIFEST).toMatchObject({
      schemaVersion: 1,
      packId: 'curated-common-typo-ja',
      version: '1.0.0',
      locale: 'ja-JP',
      kind: 'typo',
      distribution: 'bundled',
      provenance: { origin: 'first-party', licenseId: 'NOASSERTION', reviewStatus: 'pending' }
    })
    expect(CURATED_TYPO_MANIFEST.entryCount).toBe(listCuratedTypos().length)
  })

  test('returns a detached deeply frozen copy instead of mutating the caller', () => {
    const input = valid()
    const manifest = validateDictionaryPackManifest(input)
    expect(manifest).toEqual(input)
    expect(manifest).not.toBe(input)
    expect(Object.isFrozen(manifest)).toBe(true)
    expect(Object.isFrozen(manifest.provenance)).toBe(true)
    input.provenance.reviewStatus = 'approved'
    expect(manifest.provenance.reviewStatus).toBe('pending')
  })

  test.each([
    [{ ...valid(), schemaVersion: 2 }, 'unsupported schema'],
    [{ ...valid(), packId: '../unsafe' }, 'unsafe pack id'],
    [{ ...valid(), version: 'latest' }, 'non-versioned'],
    [{ ...valid(), locale: 'en-US' }, 'unrecognized language'],
    [{ ...valid(), entryCount: -1 }, 'negative count'],
    [{ ...valid(), entryCount: 1.5 }, 'fractional count'],
    [{ ...valid(), entryCount: Number.MAX_SAFE_INTEGER }, 'excessive count'],
    [{ ...valid(), distribution: 'remote-code' }, 'executable pack'],
    [{ ...valid(), kind: 'script' }, 'unknown kind'],
    [{ ...valid(), provenance: { ...valid().provenance, licenseId: '' } }, 'missing license declaration'],
    [{ ...valid(), provenance: { ...valid().provenance, sourceUrl: 'http://example.com/pack.json' } }, 'insecure URL'],
    [{ ...valid(), provenance: { ...valid().provenance, sourceUrl: 'https://user:pass@example.com/' } }, 'URL credentials'],
    [{ ...valid(), provenance: { origin: 'third-party', licenseId: 'NOASSERTION', reviewStatus: 'pending' } }, 'third party with unknown license'],
    [{ ...valid(), provenance: { origin: 'third-party', licenseId: 'Apache-2.0', reviewStatus: 'pending' } }, 'third party without source'],
    [null, 'null manifest'],
    [[], 'array manifest']
  ])('rejects %s (%s)', (input) => {
    expect(() => validateDictionaryPackManifest(input)).toThrow()
  })

  test('accepts declared third-party metadata without claiming legal approval', () => {
    const manifest = validateDictionaryPackManifest({
      ...valid(),
      provenance: {
        origin: 'third-party',
        licenseId: 'Apache-2.0',
        reviewStatus: 'pending',
        sourceUrl: 'https://example.org/dictionary'
      }
    })
    expect(manifest.provenance.reviewStatus).toBe('pending')
    expect(manifest.provenance.sourceUrl).toBe('https://example.org/dictionary')
  })
})
