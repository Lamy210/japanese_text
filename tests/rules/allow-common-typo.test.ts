import { describe, expect, test } from 'vitest'
import { validateAppConfig } from '../../src/core/config/validate'
import { CONFIG_SCHEMA_VERSION } from '../../src/core/config/schema'
import { createAllowedTypoTerm } from '../../src/core/rules/fast/common-typo'
import { runSingleRule, runTier, testConfig } from '../helpers'
import type { Diagnostic } from '../../src/core/types'

function diagnostic(text: string, spelling = 'デバック'): Diagnostic {
  const d = runSingleRule('wording/common-typo', text, testConfig()).find(
    (candidate) => text.slice(candidate.start, candidate.end) === spelling
  )
  if (!d) throw new Error('test input has no corresponding typo')
  return d
}

describe('allow a curated typo as an intentional local term', () => {
  test('creates a preferred-only terminology entry from a current diagnostic', () => {
    const text = 'デバックを実行します。'
    const term = createAllowedTypoTerm(diagnostic(text), text, [], 'typo-allow-1')
    expect(term).toEqual({
      id: 'typo-allow-1', preferred: 'デバック', rejected: [], caseSensitive: true
    })
  })

  test('imports a v1 preferred-only term and normalizes to the latest schema', () => {
    const text = 'デバックを実行します。'
    const term = createAllowedTypoTerm(diagnostic(text), text, [], 'typo-allow-2')!
    const config = validateAppConfig({ schemaVersion: 1, terminology: [term] })
    expect(config.terminology).toContainEqual(term)
    expect(config.schemaVersion).toBe(CONFIG_SCHEMA_VERSION)
    expect(config.schemaVersion).toBe(2)
    expect(runSingleRule('wording/common-typo', text, config)).toEqual([])
    expect(runSingleRule('wording/terminology', text, config)).toEqual([])
    expect(runTier(text, config, 'fast').ruleErrors).toEqual([])
  })

  test('allows all repetitions of one spelling without affecting other typo words', () => {
    const text = '📚デバックとデバックとコミニュティを確認します。'
    const d = diagnostic(text)
    const term = createAllowedTypoTerm(d, text, [], 'typo-allow-3')!
    const cfg = testConfig()
    cfg.terminology = [term]
    expect(runSingleRule('wording/common-typo', text, cfg).map(x => text.slice(x.start, x.end)))
      .toEqual(['コミニュティ'])
  })

  test('refuses unrelated rules even when their spans contain a curated typo', () => {
    const text = 'デバックを確認します。'
    const d = { ...diagnostic(text), ruleId: 'wording/terminology' }
    expect(createAllowedTypoTerm(d, text, [], 'typo-allow-4')).toBeNull()
  })

  test('refuses a stale diagnostic when the document has changed at its span', () => {
    const original = 'デバックを確認します。'
    const d = diagnostic(original)
    expect(createAllowedTypoTerm(d, 'デバッグを確認します。', [], 'typo-allow-5')).toBeNull()
    expect(createAllowedTypoTerm(d, '本文は別の文字列です。', [], 'typo-allow-5')).toBeNull()
  })

  test('refuses a spoofed or incorrect candidate replacement', () => {
    const text = 'デバックを確認します。'
    const d = diagnostic(text)
    expect(createAllowedTypoTerm({ ...d, replacement: '無関係' }, text, [], 'typo-allow-6'))
      .toBeNull()
    expect(createAllowedTypoTerm({ ...d, fixKind: 'safe' }, text, [], 'typo-allow-6'))
      .toBeNull()
  })

  test('refuses out-of-bounds and inverted offsets', () => {
    const text = '📚デバックです。'
    const d = diagnostic(text)
    for (const changed of [
      { ...d, start: -1 },
      { ...d, start: d.end },
      { ...d, end: text.length + 1 },
      { ...d, start: 1, end: 3 }
    ]) expect(createAllowedTypoTerm(changed, text, [], 'typo-allow-7')).toBeNull()
  })

  test('refuses an empty, non-string and reused ID', () => {
    const text = 'デバックです。'
    const d = diagnostic(text)
    expect(createAllowedTypoTerm(d, text, [], '')).toBeNull()
    expect(createAllowedTypoTerm(d, text, [], '  ')).toBeNull()
    const terms = [{ id: 'used', preferred: '別名', rejected: [], caseSensitive: true }]
    expect(createAllowedTypoTerm(d, text, terms, 'used')).toBeNull()
  })

  test('does not duplicate preferred and rejected entries managed by the user', () => {
    const text = 'デバックです。'
    const d = diagnostic(text)
    const preferred = [{ id: 'custom', preferred: 'デバック', rejected: [] }]
    const rejected = [{ id: 'custom', preferred: '別名', rejected: ['デバック'] }]
    expect(createAllowedTypoTerm(d, text, preferred, 'new')).toBeNull()
    expect(createAllowedTypoTerm(d, text, rejected, 'new')).toBeNull()
  })

  test('refuses to exceed the existing validation cap of 500 terms', () => {
    const text = 'デバックです。'
    const entries = Array.from({ length: 500 }, (_, i) => ({
      id: `term-${i}`, preferred: `word-${i}`, rejected: [] as string[]
    }))
    expect(createAllowedTypoTerm(diagnostic(text), text, entries, 'new')).toBeNull()
  })

  test('removing an allowance restores the original typo diagnostic', () => {
    const text = 'デバックです。'
    const cfg = testConfig()
    const term = createAllowedTypoTerm(diagnostic(text), text, cfg.terminology, 'allow')!
    cfg.terminology.push(term)
    expect(runSingleRule('wording/common-typo', text, cfg)).toEqual([])
    cfg.terminology = cfg.terminology.filter(x => x.id !== term.id)
    expect(runSingleRule('wording/common-typo', text, cfg)).toHaveLength(1)
  })

  test('does not mutate the document text or existing terminology', () => {
    const text = 'デバックを実行します。'
    const termEntries = Object.freeze([{ id: 'other', preferred: '別の用語', rejected: [] as string[] }])
    const before = JSON.stringify(termEntries)
    expect(createAllowedTypoTerm(diagnostic(text), text, termEntries, 'new')).toBeTruthy()
    expect(JSON.stringify(termEntries)).toBe(before)
    expect(text).toBe('デバックを実行します。')
  })
})
