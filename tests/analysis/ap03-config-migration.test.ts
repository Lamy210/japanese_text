import { describe, expect, test } from 'vitest'
import { CONFIG_SCHEMA_VERSION } from '../../src/core/config/schema'
import { createDefaultConfig, migrateConfig, validateAppConfig } from '../../src/core/config/validate'
import { legacyCompatiblePackSelection } from '../../src/core/analysis/packs'
import { createDefaultWorkspaceState } from '../../src/core/workspace/defaults'
import { validateRuleProfileRecord } from '../../src/core/workspace/validate'
import {
  composeAppConfig, splitAppConfigForMigration, splitAppConfigPreservingStorageMode
} from '../../src/storage/compat/app-config-projection'

describe('AP-03 AppConfig v1 -> v2 migration and Pack validation', () => {
  test('v1 import is normalized to v2 without modifying existing rule decisions', () => {
    const initial = createDefaultConfig()
    const v1 = {
      ...initial,
      schemaVersion: 1,
      rules: {
        ...initial.rules,
        'wording/common-typo': { enabled: false, severity: 'error' }
      }
    }
    const { analysisPacks: _unused, ...legacy } = v1
    const snapshot = structuredClone(legacy)
    const migrated = validateAppConfig(migrateConfig(legacy))
    expect(migrated.schemaVersion).toBe(CONFIG_SCHEMA_VERSION)
    expect(CONFIG_SCHEMA_VERSION).toBe(2)
    expect(migrated.analysisPacks).toEqual(legacyCompatiblePackSelection())
    expect(migrated.rules['wording/common-typo']).toMatchObject({ enabled: false, severity: 'error' })
    expect(legacy).toEqual(snapshot)
    expect(validateAppConfig(legacy).analysisPacks).toEqual(migrated.analysisPacks)
  })

  test('v2 Pack selection is validated, cloned and core is always enabled', () => {
    const current = createDefaultConfig()
    const candidate = { ...current, analysisPacks: { ...current.analysisPacks, core: false, dictionary: false } }
    const actual = validateAppConfig(candidate)
    expect(actual.analysisPacks.core).toBe(true)
    expect(actual.analysisPacks.dictionary).toBe(false)
    actual.analysisPacks.dictionary = true
    expect(candidate.analysisPacks.dictionary).toBe(false)
    expect(() => validateAppConfig({ ...current, analysisPacks: null })).toThrow('analysisPacks')
    expect(() => validateAppConfig({ ...current, analysisPacks: { grammar: 'false' } })).toThrow('analysisPacks')
    expect(() => validateAppConfig({ ...current, analysisPacks: { unknownPack: true } })).toThrow('analysisPacks')
    expect(() => validateAppConfig({ ...current, schemaVersion: 3 })).toThrow('schema v3')
  })

  test('v1 RuleProfile lacking Pack flags remains usable and projects to compatible v2', () => {
    const state = createDefaultWorkspaceState(100)
    const { analysisPacks: _omitted, ...legacyProfile } = state.profile
    const validated = validateRuleProfileRecord(legacyProfile)
    expect(validated.analysisPacks).toBeUndefined()
    const composed = composeAppConfig({ ...state, profile: validated })
    expect(composed.schemaVersion).toBe(2)
    expect(composed.analysisPacks).toEqual(legacyCompatiblePackSelection())
  })

  test('Profile flags persist through projection without changing canonical private/local mode', () => {
    const state = createDefaultWorkspaceState(100)
    const config = composeAppConfig(state)
    config.analysisPacks.dictionary = false
    config.analysisPacks.style = false
    config.privacy = { autoSave: true, privacyMode: false }
    const next = splitAppConfigPreservingStorageMode(config, state, 200)
    expect(next.workspace.storageMode).toBe('private-session')
    expect(next.profile.analysisPacks).toMatchObject({ dictionary: false, style: false, core: true })
    expect(composeAppConfig(next).privacy).toEqual({ autoSave: false, privacyMode: true })
    expect(composeAppConfig(next).analysisPacks).toEqual(config.analysisPacks)
    next.profile.analysisPacks!.dictionary = true
    expect(config.analysisPacks.dictionary).toBe(false)

    const imported = splitAppConfigForMigration(config, state, 200)
    expect(imported.workspace.storageMode).toBe('local-library')
  })

  test('invalid Pack flags in a persisted RuleProfile are rejected instead of silently dropped', () => {
    const state = createDefaultWorkspaceState(1)
    expect(() => validateRuleProfileRecord({
      ...state.profile,
      analysisPacks: { ...state.profile.analysisPacks, morphology: 'enabled' }
    })).toThrow('ruleProfile config is invalid')
  })
})
