import { describe, expect, test } from 'vitest'
import {
  CURATED_TYPO_DICTIONARY_VERSION,
  findCuratedTypo,
  listCuratedTypos
} from '../../src/core/dictionary/curated-typos'
import { createAllowedTypoTerm } from '../../src/core/rules/fast/common-typo'
import { formatDocument } from '../../src/core/formatter/formatter'
import { runSingleRule, testConfig } from '../helpers'

const LEGACY_PAIRS: readonly (readonly [string, string])[] = [
  ['シュミレーション', 'シミュレーション'],
  ['コミニュケーション', 'コミュニケーション'],
  ['デバック', 'デバッグ'],
  ['うる覚え', 'うろ覚え'],
  ['コミニュティ', 'コミュニティ'],
  ['アクセサビリティ', 'アクセシビリティ'],
  ['シュミレーター', 'シミュレーター'],
  ['シュミレータ', 'シミュレータ']
]

describe('Phase 6A curated typo dictionary contract', () => {
  test('preserves all eight original pairs and their diagnostic traversal order', () => {
    expect(CURATED_TYPO_DICTIONARY_VERSION).toBe(1)
    expect(listCuratedTypos().map(entry => [entry.wrong, entry.preferred])).toEqual(LEGACY_PAIRS)
    expect(new Set(listCuratedTypos().map(entry => entry.wrong)).size).toBe(LEGACY_PAIRS.length)
  })

  test('exposes immutable entries and stable indexed exact lookups', () => {
    const entries = listCuratedTypos()
    expect(listCuratedTypos()).toBe(entries)
    expect(Object.isFrozen(entries)).toBe(true)
    for (const entry of entries) {
      expect(Object.isFrozen(entry)).toBe(true)
      expect(findCuratedTypo(entry.wrong)).toBe(entry)
      expect(findCuratedTypo(entry.preferred)).toBeUndefined()
    }
    expect(findCuratedTypo('デバッグです')).toBeUndefined()
    expect(findCuratedTypo('')).toBeUndefined()
  })

  test.each(LEGACY_PAIRS)('keeps detection and allowance in sync for %s', (wrong, preferred) => {
    const text = `📚${wrong}を確認します。`
    const config = testConfig()
    const findings = runSingleRule('wording/common-typo', text, config)
    expect(findings).toHaveLength(1)
    const diagnostic = findings[0]!
    expect(text.slice(diagnostic.start, diagnostic.end)).toBe(wrong)
    expect(diagnostic.replacement).toBe(preferred)
    expect(diagnostic.fixKind).toBe('suggestion')
    expect(formatDocument(text, findings).text).toBe(text)

    const allowed = createAllowedTypoTerm(diagnostic, text, config.terminology, 'allow-phase6a')!
    expect(allowed).toMatchObject({ preferred: wrong, rejected: [] })
    config.terminology.push(allowed)
    expect(runSingleRule('wording/common-typo', text, config)).toEqual([])
  })

  test('never accepts a spoofed replacement as a new allowance', () => {
    const text = '📚コミニュティを確認します。'
    const diagnostic = runSingleRule('wording/common-typo', text, testConfig())[0]!
    expect(createAllowedTypoTerm({ ...diagnostic, replacement: '別の表記' }, text, [], 'test')).toBeNull()
  })
})
