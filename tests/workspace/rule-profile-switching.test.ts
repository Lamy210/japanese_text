import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, test } from 'vitest'
import { createDefaultWorkspaceState } from '../../src/core/workspace/defaults'
import { validateWorkspaceRecord } from '../../src/core/workspace/validate'
import { openDatabase } from '../../src/storage/db/open-database'
import { createIndexedDbRepositories } from '../../src/storage/repositories/indexeddb'
import { createIndexedDbAtomicOperations } from '../../src/storage/db/indexeddb-atomic-operations'
import { createMemoryStorageContext } from '../../src/storage/repositories/memory'
import { createWorkspaceService } from '../../src/workspace/workspace-service'
import type { AtomicOperationsPort, StorageRepositories } from '../../src/storage/repositories/ports'

function state(id: string, profileId: string) {
  const s = createDefaultWorkspaceState(100)
  s.workspace.id = id
  s.workspace.activeRuleProfileId = profileId
  s.profile.id = profileId
  return s
}

async function runContract(label: string, create: () => Promise<{
  repositories: StorageRepositories,
  atomic: AtomicOperationsPort,
  close: () => void
}>) {
  describe(label, () => {
    test('deleting a Workspace retains RuleProfiles for backward compatibility', async () => {
      const h = await create()
      try {
        const first = state('w1', 'p1')
        const second = state('w2', 'p2')
        await h.repositories.preferences.save(first.preferences)
        await h.atomic.createWorkspaceAndActivate(first.workspace, first.profile)
        await h.atomic.createWorkspaceAndActivate(second.workspace, second.profile)
        await h.atomic.duplicateProfileAndActivate('w1', { ...first.profile, id: 'p3', name: 'Extra' })
        await h.atomic.deleteWorkspaceAndSelectNext('w1', 'w2')
        expect(await h.repositories.workspaces.get('w1')).toBeUndefined()
        expect((await h.repositories.profiles.get('p1'))?.id).toBe('p1')
        expect((await h.repositories.profiles.get('p3'))?.id).toBe('p3')
        expect((await h.repositories.profiles.get('p2'))?.id).toBe('p2')
        expect(await h.repositories.selection.getActiveWorkspaceId()).toBe('w2')
      } finally {
        h.close()
      }
    })

    test('duplicates profile atomically and switches only within its Workspace', async () => {
      const h = await create()
      try {
        const first = state('w1', 'p1')
        const other = state('w2', 'p2')
        await h.repositories.preferences.save(first.preferences)
        await h.atomic.createWorkspaceAndActivate(first.workspace, first.profile)
        await h.atomic.createWorkspaceAndActivate(other.workspace, other.profile)
        await h.repositories.selection.setActiveWorkspaceId('w1')
        const service = createWorkspaceService({
          repositories: h.repositories,
          atomic: h.atomic,
          now: () => 500,
          generateId: () => 'p3'
        })
        expect((await service.listRuleProfiles('w1')).map((p) => p.id)).toEqual(['p1'])
        const duplicate = await service.duplicateRuleProfile('w1', '  Variant  ')
        expect(duplicate.profile.id).toBe('p3')
        expect(duplicate.profile.name).toBe('Variant')
        expect(duplicate.workspace.activeRuleProfileId).toBe('p3')
        expect(duplicate.workspace.ruleProfileIds).toEqual(['p1', 'p3'])
        expect((await service.listRuleProfiles('w1')).map((p) => p.id)).toEqual(['p1', 'p3'])
        expect((await h.repositories.profiles.get('p1'))?.name).toBe(first.profile.name)

        await expect(service.switchRuleProfile('w1', 'p2')).rejects.toThrow()
        expect((await h.repositories.workspaces.get('w1'))?.activeRuleProfileId).toBe('p3')
        await service.switchRuleProfile('w1', 'p1')
        expect((await h.repositories.workspaces.get('w1'))?.activeRuleProfileId).toBe('p1')
        expect((await h.repositories.workspaces.get('w2'))?.activeRuleProfileId).toBe('p2')
        await expect(service.duplicateRuleProfile('w1', 'collision')).rejects.toThrow()
        expect((await h.repositories.workspaces.get('w1'))?.ruleProfileIds).toEqual(['p1', 'p3'])
      } finally {
        h.close()
      }
    })
  })
}
void runContract('Memory RuleProfiles', async () => {
  const memory = createMemoryStorageContext(() => 500)
  return { repositories: memory.repositories, atomic: memory.atomicOperations, close: () => {} }
})
void runContract('IndexedDB RuleProfiles', async () => {
  const db = await openDatabase(new IDBFactory())
  return { repositories: createIndexedDbRepositories(db), atomic: createIndexedDbAtomicOperations(db, () => 500), close: () => db.close() }
})

describe('RuleProfile membership backward compatibility', () => {
  test('legacy Workspace implies one profile and rejects malformed collections', () => {
    const original = state('w1', 'p1').workspace
    expect(validateWorkspaceRecord(original).ruleProfileIds).toBeUndefined()
    expect(validateWorkspaceRecord({ ...original, ruleProfileIds: ['p1', 'p2'] }).ruleProfileIds).toEqual(['p1', 'p2'])
    expect(() => validateWorkspaceRecord({ ...original, ruleProfileIds: [] })).toThrow()
    expect(() => validateWorkspaceRecord({ ...original, ruleProfileIds: ['p2'] })).toThrow()
    expect(() => validateWorkspaceRecord({ ...original, ruleProfileIds: ['p1', 'p1'] })).toThrow()
    expect(() => validateWorkspaceRecord({ ...original, ruleProfileIds: ['p1', ''] })).toThrow()
  })

  test('preserves independent config when switching back to a different profile', async () => {
    const memory = createMemoryStorageContext()
    const seed = state('w1', 'p1')
    await memory.repositories.preferences.save(seed.preferences)
    await memory.atomicOperations.createWorkspaceAndActivate(seed.workspace, seed.profile)
    const service = createWorkspaceService({
      repositories: memory.repositories,
      atomic: memory.atomicOperations,
      generateId: () => 'p-new'
    })
    const source = await service.getActive()
    await service.saveConfig('w1', {
      ...source.config,
      ngWords: [{ id: 'source-word', word: 'original', severity: 'warning' }]
    })
    const cloned = await service.duplicateRuleProfile('w1', 'New')
    await service.saveConfig('w1', {
      ...cloned.config,
      ngWords: [{ id: 'target-word', word: 'different', severity: 'error' }]
    })
    const old = await service.switchRuleProfile('w1', 'p1')
    expect(old.config.ngWords.map(w => w.word)).toEqual(['original'])
    const updated = await service.switchRuleProfile('w1', 'p-new')
    expect(updated.config.ngWords.map(w => w.word)).toEqual(['different'])
  })
})
