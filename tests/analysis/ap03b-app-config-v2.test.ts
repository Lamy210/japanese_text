import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, test } from 'vitest'
import { CONFIG_SCHEMA_VERSION } from '../../src/core/config/schema'
import { createDefaultConfig, migrateConfig, validateAppConfig } from '../../src/core/config/validate'
import { createDefaultWorkspaceState } from '../../src/core/workspace/defaults'
import { defaultProfileAnalysisSettings } from '../../src/core/analysis/profile-settings'
import { createIndexedDbAtomicOperations } from '../../src/storage/db/indexeddb-atomic-operations'
import { openDatabase } from '../../src/storage/db/open-database'
import { createIndexedDbRepositories } from '../../src/storage/repositories/indexeddb'
import { createMemoryStorageContext } from '../../src/storage/repositories/memory'
import { composeAppConfig, splitAppConfigPreservingStorageMode } from '../../src/storage/compat/app-config-projection'
import { createWorkspaceService } from '../../src/workspace/workspace-service'

describe('AP-03b AppConfig v2 import/export and migration', () => {
  test('v1 legacy import migrates without changing Rule flags or privacy state', () => {
    const original = createDefaultConfig()
    const raw = structuredClone(original) as unknown as Record<string, unknown>
    raw.schemaVersion = 1
    delete raw.analysis
    const before = structuredClone(raw)
    const migrated = migrateConfig(raw)
    const validated = validateAppConfig(migrated)
    expect(CONFIG_SCHEMA_VERSION).toBe(2)
    expect(validated.schemaVersion).toBe(2)
    expect(validated.analysis).toEqual(defaultProfileAnalysisSettings())
    expect(validated.rules).toEqual(original.rules)
    expect(validated.privacy).toEqual(original.privacy)
    expect(raw).toEqual(before)
    // Direct validation, used by some storage entrypoints, must also accept v1.
    expect(validateAppConfig(raw)).toEqual(validated)
  })

  test('v2 settings round-trip with all nested options and enforce core ON', () => {
    const defaultConfig = createDefaultConfig()
    const changed = {
      ...defaultConfig,
      analysis: {
        ...defaultConfig.analysis,
        packs: { ...defaultConfig.analysis.packs, core: false, dictionary: false, style: true },
        morphology: { ...defaultConfig.analysis.morphology, showEvidence: true },
        dictionaries: {
          ...defaultConfig.analysis.dictionaries, enabledSharedAssetIds: ['dictionary-v1']
        }
      }
    }
    const validated = validateAppConfig(JSON.parse(JSON.stringify(changed)))
    expect(validated.analysis.packs.core).toBe(true)
    expect(validated.analysis.packs.dictionary).toBe(false)
    expect(validated.analysis.morphology.showEvidence).toBe(true)
    expect(validated.analysis.dictionaries.enabledSharedAssetIds).toEqual(['dictionary-v1'])
    expect(validateAppConfig(JSON.parse(JSON.stringify(validated)))).toEqual(validated)
    expect(changed.analysis.packs.core).toBe(false)
  })

  test('future versions and malicious analysis fields are rejected', () => {
    const config = createDefaultConfig()
    expect(() => validateAppConfig({ ...config, schemaVersion: 3 })).toThrow('schema v3')
    expect(() => validateAppConfig({ ...config, analysis: null })).toThrow('analysis')
    expect(() => validateAppConfig({
      ...config, analysis: { ...config.analysis, dictionaries: {
        ...config.analysis.dictionaries, rawPrivateDictionary: 'secret'
      } }
    })).toThrow('analysis')
    expect(() => validateAppConfig({
      ...config, analysis: { ...config.analysis, packs: { ...config.analysis.packs, bogus: true } }
    })).toThrow('analysis')
    expect(() => validateAppConfig({
      ...config, analysis: { ...config.analysis, morphology: {
        ...config.analysis.morphology, providerId: 'unverified-plugin'
      } }
    })).toThrow('analysis')
  })

  test('a legacy RuleProfile is projected to v2 without writing on read', () => {
    const state = createDefaultWorkspaceState(1)
    expect(state.profile.analysis).toBeUndefined()
    const config = composeAppConfig(state)
    expect(config.schemaVersion).toBe(2)
    expect(config.analysis).toEqual(defaultProfileAnalysisSettings())
    expect(state.profile.analysis).toBeUndefined()
  })

  test('saving Pack choices keeps canonical Private Session despite legacy privacy flags', () => {
    const state = createDefaultWorkspaceState(1)
    const config = composeAppConfig(state)
    const changed = { ...config, analysis: {
      ...config.analysis, packs: { ...config.analysis.packs, dictionary: false }
    }, privacy: { autoSave: true, privacyMode: false } }
    const next = splitAppConfigPreservingStorageMode(changed, state, 2)
    expect(next.workspace.storageMode).toBe('private-session')
    expect(next.profile.analysis?.packs.dictionary).toBe(false)
    expect(composeAppConfig(next).privacy).toEqual({ autoSave: false, privacyMode: true })
    expect(composeAppConfig(next).analysis).toEqual(validateAppConfig(changed).analysis)
    expect(state.profile.analysis).toBeUndefined()
  })
})

describe('AP-03b persistence on actual WorkspaceService paths', () => {
  test('Memory storage keeps Pack preferences isolated across Profile switching', async () => {
    const memory = createMemoryStorageContext()
    const state = createDefaultWorkspaceState(100)
    await memory.repositories.preferences.save(state.preferences)
    await memory.atomicOperations.createWorkspaceAndActivate(state.workspace, state.profile)
    const service = createWorkspaceService({
      repositories: memory.repositories, atomic: memory.atomicOperations,
      now: () => 200, generateId: () => 'profile-duplicate'
    })
    const before = await service.getActive()
    const config = before.config
    await service.saveConfig(state.workspace.id, { ...config, analysis: {
      ...config.analysis, packs: { ...config.analysis.packs, dictionary: false }
    } })
    expect((await service.getActive()).config.analysis.packs.dictionary).toBe(false)
    const duplicated = await service.duplicateRuleProfile(state.workspace.id, 'Separate Analysis')
    expect(duplicated.config.analysis.packs.dictionary).toBe(false)
    await service.saveConfig(state.workspace.id, { ...duplicated.config, analysis: {
      ...duplicated.config.analysis, packs: { ...duplicated.config.analysis.packs, dictionary: true }
    } })
    expect((await service.switchRuleProfile(state.workspace.id, before.profile.id))
      .config.analysis.packs.dictionary).toBe(false)
    expect((await service.switchRuleProfile(state.workspace.id, duplicated.profile.id))
      .config.analysis.packs.dictionary).toBe(true)
  })

  test('IndexedDB v2 stores v2 Analysis settings without DB schema changes or body persistence', async () => {
    const db = await openDatabase(new IDBFactory())
    try {
      expect(db.version).toBe(2)
      const repositories = createIndexedDbRepositories(db)
      const atomic = createIndexedDbAtomicOperations(db)
      const state = createDefaultWorkspaceState(100)
      await repositories.preferences.save(state.preferences)
      await atomic.createWorkspaceAndActivate(state.workspace, state.profile)
      const service = createWorkspaceService({ repositories, atomic, now: () => 200 })
      const config = (await service.getActive()).config
      await service.saveConfig(state.workspace.id, { ...config, analysis: {
        ...config.analysis, packs: { ...config.analysis.packs, style: true }
      } })
      expect((await repositories.profiles.get(state.profile.id))?.analysis?.packs.style).toBe(true)
      expect((await service.getActive()).workspace.storageMode).toBe('private-session')
      expect(await repositories.documents.listByWorkspace(state.workspace.id)).toEqual([])
    } finally { db.close() }
  })
})
