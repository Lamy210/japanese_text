import { describe, expect, test } from 'vitest'
import { createDefaultConfig } from '../../src/core/config/validate'
import { prepareConfigImport } from '../../src/core/config/transfer'

function activeProfileConfig() {
  const config = createDefaultConfig()
  return {
    ...config,
    analysis: {
      ...config.analysis,
      packs: { ...config.analysis.packs, dictionary: false, style: true },
      morphology: { ...config.analysis.morphology, showEvidence: true }
    }
  }
}

describe('AP-03b legacy JSON import preserves active Analysis settings', () => {
  test('legacy v1 import keeps Pack choices but imports rules and terminology', () => {
    const current = activeProfileConfig()
    const snapshot = structuredClone(current)
    const raw = {
      schemaVersion: 1,
      preset: 'technical',
      rules: { 'wording/common-typo': { enabled: false, severity: 'error' } },
      terminology: [{ id: 't', preferred: '検証', rejected: ['試験'] }],
      privacy: { autoSave: true, privacyMode: false }
    }
    const result = prepareConfigImport(raw, current)
    expect(result.schemaVersion).toBe(2)
    expect(result.analysis).toEqual(current.analysis)
    expect(result.analysis).not.toBe(current.analysis)
    expect(result.rules['wording/common-typo']).toMatchObject({ enabled: false, severity: 'error' })
    expect(result.terminology[0]).toMatchObject({ preferred: '検証' })
    expect(result.privacy).toEqual({ autoSave: false, privacyMode: true })
    expect(current).toEqual(snapshot)
    expect(raw.schemaVersion).toBe(1)
  })

  test('versionless historic settings also do not wipe the Profile choice', () => {
    const current = activeProfileConfig()
    const result = prepareConfigImport({ preset: 'strict' }, current)
    expect(result.schemaVersion).toBe(2)
    expect(result.analysis.packs.dictionary).toBe(false)
    expect(result.analysis.packs.style).toBe(true)
  })

  test('explicit v2 analysis settings are imported and validated', () => {
    const current = activeProfileConfig()
    const initial = createDefaultConfig()
    const incoming = {
      ...initial,
      analysis: {
        ...initial.analysis,
        packs: { ...initial.analysis.packs, dictionary: true, style: false }
      },
      privacy: { autoSave: true, privacyMode: false }
    }
    const result = prepareConfigImport(JSON.parse(JSON.stringify(incoming)), current)
    expect(result.analysis.packs.dictionary).toBe(true)
    expect(result.analysis.packs.style).toBe(false)
    expect(result.privacy).toEqual(current.privacy)
    expect(result.schemaVersion).toBe(2)
  })

  test('future versions and invalid nested v2 fields fail without changing current state', () => {
    const current = activeProfileConfig()
    const original = structuredClone(current)
    expect(() => prepareConfigImport({ schemaVersion: 99 }, current)).toThrow(/schema v99/)
    expect(() => prepareConfigImport({
      ...createDefaultConfig(),
      analysis: { ...createDefaultConfig().analysis, privateDictionaryText: 'secret' }
    }, current)).toThrow(/analysis/)
    expect(current).toEqual(original)
  })

  test('spoofed analysis on v1 cannot override active Profile settings', () => {
    const current = activeProfileConfig()
    const raw = {
      schemaVersion: 1,
      analysis: { packs: { dictionary: true }, arbitrary: 'malicious' },
      privacy: { autoSave: true, privacyMode: false }
    }
    const result = prepareConfigImport(raw, current)
    expect(result.analysis).toEqual(current.analysis)
    expect(result.privacy).toEqual(current.privacy)
  })
})
