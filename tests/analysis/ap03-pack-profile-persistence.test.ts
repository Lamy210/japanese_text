import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, test } from 'vitest'
import { createDefaultWorkspaceState } from '../../src/core/workspace/defaults'
import { createIndexedDbAtomicOperations } from '../../src/storage/db/indexeddb-atomic-operations'
import { openDatabase } from '../../src/storage/db/open-database'
import { createIndexedDbRepositories } from '../../src/storage/repositories/indexeddb'
import { createMemoryStorageContext } from '../../src/storage/repositories/memory'
import { createWorkspaceService } from '../../src/workspace/workspace-service'

describe('AP-03 Pack flag persistence across Workspace / Profile', () => {
  test('memory repository round-trip isolates two Profiles and never changes private storage mode', async () => {
    const context = createMemoryStorageContext(() => 1000)
    const defaults = createDefaultWorkspaceState(100)
    await context.repositories.preferences.save(defaults.preferences)
    await context.atomicOperations.createWorkspaceAndActivate(defaults.workspace, defaults.profile)
    const service = createWorkspaceService({
      repositories: context.repositories,
      atomic: context.atomicOperations,
      now: () => 500,
      generateId: () => 'profile-duplicate'
    })
    const first = await service.getActive()
    const modified = structuredClone(first.config)
    modified.analysisPacks.technical = false
    modified.analysisPacks.dictionary = false
    modified.privacy = { autoSave: true, privacyMode: false }
    await service.saveConfig(first.workspace.id, modified)
    expect((await service.getActive()).config.analysisPacks.dictionary).toBe(false)
    expect((await service.getActive()).workspace.storageMode).toBe('private-session')

    const cloned = await service.duplicateRuleProfile(first.workspace.id, 'Separate Profile')
    expect(cloned.config.analysisPacks.dictionary).toBe(false)
    const second = structuredClone(cloned.config)
    second.analysisPacks.dictionary = true
    await service.saveConfig(cloned.workspace.id, second)
    const switched = await service.switchRuleProfile(cloned.workspace.id, first.profile.id)
    expect(switched.config.analysisPacks.dictionary).toBe(false)
    expect(switched.config.analysisPacks.technical).toBe(false)
    const restored = await service.switchRuleProfile(cloned.workspace.id, cloned.profile.id)
    expect(restored.config.analysisPacks.dictionary).toBe(true)
  })

  test('IndexedDB v2 stores Pack flags without a database schema upgrade', async () => {
    const db = await openDatabase(new IDBFactory())
    try {
      expect(db.version).toBe(2)
      const repositories = createIndexedDbRepositories(db)
      const atomic = createIndexedDbAtomicOperations(db, () => 200)
      const defaults = createDefaultWorkspaceState(100)
      await repositories.preferences.save(defaults.preferences)
      await atomic.createWorkspaceAndActivate(defaults.workspace, defaults.profile)
      const service = createWorkspaceService({ repositories, atomic, now: () => 200 })
      const config = (await service.getActive()).config
      config.analysisPacks.style = false
      config.analysisPacks.grammar = false
      await service.saveConfig(defaults.workspace.id, config)
      const reloaded = await repositories.profiles.get(defaults.profile.id)
      expect(reloaded?.analysisPacks?.style).toBe(false)
      expect(reloaded?.analysisPacks?.grammar).toBe(false)
      expect((await service.getActive()).workspace.storageMode).toBe('private-session')
      expect((await service.getActive()).config.analysisPacks).toMatchObject({
        core: true, style: false, grammar: false, morphology: false
      })
    } finally {
      db.close()
    }
  })
})
