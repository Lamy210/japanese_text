import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, test } from 'vitest'
import {
  defaultProfileAnalysisSettings,
  resolveProfileAnalysisSettings,
  validateProfileAnalysisSettings
} from '../../src/core/analysis/profile-settings'
import { createDefaultWorkspaceState } from '../../src/core/workspace/defaults'
import { validateRuleProfileRecord } from '../../src/core/workspace/validate'
import { splitAppConfigPreservingStorageMode, composeAppConfig } from '../../src/storage/compat/app-config-projection'
import { createMemoryStorageContext } from '../../src/storage/repositories/memory'
import { createIndexedDbRepositories } from '../../src/storage/repositories/indexeddb'
import { openDatabase } from '../../src/storage/db/open-database'
import { createWorkspaceService } from '../../src/workspace/workspace-service'

describe('AP-03a: non-destructive Profile analysis settings', () => {
  test('legacy RuleProfiles remain unchanged on validation; effective defaults are not persisted', () => {
    const legacy = createDefaultWorkspaceState(100).profile
    expect(legacy.analysis).toBeUndefined()
    expect(validateRuleProfileRecord(legacy)).toEqual(legacy)
    const effective = resolveProfileAnalysisSettings(legacy.analysis)
    expect(effective.packs.core).toBe(true)
    expect(effective.packs.morphology).toBe(false)
    expect(effective.morphology.enabled).toBe(false)
    expect(effective.dictionaries.enabledBuiltInIds).toEqual(['curated-common-typo-ja'])
    expect(validateRuleProfileRecord(legacy).analysis).toBeUndefined()
  })

  test('validates strict Profile metadata and forces required core ON without changing input', () => {
    const defaults = defaultProfileAnalysisSettings()
    const input = {
      ...defaults,
      packs: { ...defaults.packs, core: false, dictionary: false },
      dictionaries: { ...defaults.dictionaries, enabledSharedAssetIds: ['test-ja-v1'] }
    }
    const validated = validateProfileAnalysisSettings(input)
    expect(validated.packs).toMatchObject({ core: true, dictionary: false })
    expect(validated.dictionaries.enabledSharedAssetIds).toEqual(['test-ja-v1'])
    expect(input.packs.core).toBe(false)
    expect(validated).not.toBe(input)
    expect(validated.packs).not.toBe(input.packs)
    expect(validated.dictionaries.enabledSharedAssetIds).not.toBe(input.dictionaries.enabledSharedAssetIds)
  })

  test.each([
    [{ extra: 'raw document bytes' }, 'unrecognized root key'],
    [{ morphology: { providerId: 'unverified-plugin' } }, 'unrecognized provider'],
    [{ morphology: { analyzeQuotedBlocks: true } }, 'quote policy'],
    [{ morphology: { enabled: 'yes' } }, 'invalid boolean'],
    [{ morphology: { dictionaryAssetId: '../private' } }, 'traversal-like dictionary ID'],
    [{ morphology: { automaticMaxUtf16: 0 } }, 'invalid length'],
    [{ morphology: { automaticMaxUtf16: 60_000, manualMaxUtf16: 500 } }, 'invalid length ordering'],
    [{ dictionaries: { enabledSharedAssetIds: ['dup', 'dup'] } }, 'duplicate asset ID'],
    [{ dictionaries: { localUserDictionaryRefs: ['https://example.test/private'] } }, 'URL instead of reference'],
    [{ dictionaries: { rawDictionary: 'secret content' } }, 'private dictionary data'],
    [{ packs: { style: 'on' } }, 'invalid pack flag'],
    [{ packs: { untrusted: true } }, 'new pack without validation']
  ])('rejects malformed or untrusted settings (%s)', (patch) => {
    const input = defaultProfileAnalysisSettings()
    const malformed = {
      ...input,
      ...patch,
      packs: { ...input.packs, ...(patch.packs ?? {}) },
      morphology: { ...input.morphology, ...(patch.morphology ?? {}) },
      dictionaries: { ...input.dictionaries, ...(patch.dictionaries ?? {}) }
    }
    expect(() => validateProfileAnalysisSettings(malformed)).toThrow()
    const legacy = createDefaultWorkspaceState(100).profile
    expect(() => validateRuleProfileRecord({ ...legacy, analysis: malformed }))
      .toThrow(/ruleProfile.analysis is invalid/)
  })

  test('preserves analysis options on legacy AppConfig v1 save without changing workspace privacy', () => {
    const state = createDefaultWorkspaceState(200)
    const settings = defaultProfileAnalysisSettings()
    state.profile.analysis = { ...settings, packs: { ...settings.packs, dictionary: false } }
    const config = composeAppConfig(state)
    const updated = splitAppConfigPreservingStorageMode({
      ...config,
      privacy: { autoSave: true, privacyMode: false },
      ngWords: [{ id: 'other', word: 'お知らせ', severity: 'info' }]
    }, state, 300)
    expect(updated.workspace.storageMode).toBe('private-session')
    expect(updated.profile.analysis).toEqual(state.profile.analysis)
    expect(updated.profile.analysis).not.toBe(state.profile.analysis)
    expect(updated.profile.ngWords[0]?.word).toBe('お知らせ')
    expect(composeAppConfig(updated).privacy).toEqual({ autoSave: false, privacyMode: true })
  })

  test('preserves the optional Profile field on a real WorkspaceService.saveConfig path', async () => {
    const memory = createMemoryStorageContext()
    const seed = createDefaultWorkspaceState(100)
    const settings = defaultProfileAnalysisSettings()
    seed.profile.analysis = { ...settings, packs: { ...settings.packs, dictionary: false } }
    await memory.repositories.preferences.save(seed.preferences)
    await memory.atomicOperations.createWorkspaceAndActivate(seed.workspace, seed.profile)
    const service = createWorkspaceService({
      repositories: memory.repositories, atomic: memory.atomicOperations, now: () => 200
    })
    const before = await service.getActive()
    await service.saveConfig(seed.workspace.id, {
      ...before.config,
      privacy: { autoSave: true, privacyMode: false }
    })
    const after = await service.getActive()
    expect(after.workspace.storageMode).toBe('private-session')
    expect(after.profile.analysis?.packs.dictionary).toBe(false)
    expect((await memory.repositories.profiles.get(seed.profile.id))?.analysis?.packs.dictionary).toBe(false)
  })
})

describe('AP-03a: storage repository roundtrips', () => {
  const implementations = [
    {
      name: 'Memory',
      open: async () => {
        const memory = createMemoryStorageContext()
        return { repositories: memory.repositories, close: () => undefined }
      }
    },
    {
      name: 'IndexedDB v2',
      open: async () => {
        const db = await openDatabase(new IDBFactory())
        return { repositories: createIndexedDbRepositories(db), close: () => db.close() }
      }
    }
  ]

  for (const implementation of implementations) {
    test(`${implementation.name} preserves Profile isolation and refuses bad settings`, async () => {
      const h = await implementation.open()
      try {
        const a = createDefaultWorkspaceState(100).profile
        a.id = 'profile-a'
        const b = createDefaultWorkspaceState(100).profile
        b.id = 'profile-b'
        const settings = defaultProfileAnalysisSettings()
        a.analysis = { ...settings, packs: { ...settings.packs, dictionary: false } }
        b.analysis = { ...settings, packs: { ...settings.packs, morphology: true } }
        await h.repositories.profiles.save(a)
        await h.repositories.profiles.save(b)
        const loadedA = await h.repositories.profiles.get(a.id)
        const loadedB = await h.repositories.profiles.get(b.id)
        expect(loadedA?.analysis?.packs.dictionary).toBe(false)
        expect(loadedB?.analysis?.packs.dictionary).toBe(true)
        expect(loadedB?.analysis?.packs.morphology).toBe(true)
        expect(loadedA?.analysis).not.toBe(a.analysis)
        // Changing the returned value must not modify durable records.
        const modified = loadedA as { analysis: { packs: { dictionary: boolean } } }
        modified.analysis.packs.dictionary = true
        expect((await h.repositories.profiles.get(a.id))?.analysis?.packs.dictionary).toBe(false)
        const bad = { ...a, analysis: { ...a.analysis, secret: 'document contents' } }
        await expect(h.repositories.profiles.save(bad)).rejects.toThrow()
        expect((await h.repositories.profiles.get(a.id))?.analysis?.packs.dictionary).toBe(false)
        await h.repositories.profiles.save({ ...a, analysis: undefined })
        expect((await h.repositories.profiles.get(a.id))?.analysis).toBeUndefined()
      } finally {
        h.close()
      }
    })
  }
})
