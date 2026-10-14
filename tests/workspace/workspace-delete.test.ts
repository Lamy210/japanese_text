import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { createDefaultWorkspaceState } from '../../src/core/workspace/defaults'
import type { AppConfig } from '../../src/core/config/schema'
import type { GlobalPreferences, RuleProfile, Workspace } from '../../src/core/workspace/types'
import { createIndexedDbAtomicOperations } from '../../src/storage/db/indexeddb-atomic-operations'
import { requestToPromise, transactionDone } from '../../src/storage/db/idb-utils'
import { openDatabase } from '../../src/storage/db/open-database'
import {
  STORE_DOCUMENT_SNAPSHOTS,
  STORE_SUPPRESSIONS,
  STORE_WORKSPACE_DOCUMENTS
} from '../../src/storage/db/schema'
import { createIndexedDbRepositories } from '../../src/storage/repositories/indexeddb'
import { createMemoryStorageContext } from '../../src/storage/repositories/memory'
import type { AtomicOperationsPort, StorageRepositories } from '../../src/storage/repositories/ports'
import { createSessionDocumentStore } from '../../src/workspace/session-document-store'

interface WorkspaceContext {
  workspace: Workspace
  profile: RuleProfile
  preferences: GlobalPreferences
  config: AppConfig
}

interface DeleteResult {
  active: WorkspaceContext
  deletedWorkspaceId: string
}

interface DeleteService {
  delete(workspaceId: string): Promise<DeleteResult>
}

interface WorkspaceServiceModule {
  createWorkspaceService(deps: {
    repositories: StorageRepositories
    atomic: AtomicOperationsPort
    now?: () => number
    sessionDocuments?: ReturnType<typeof createSessionDocumentStore>
  }): DeleteService
}

type AtomicWithDeleteAndSelect = AtomicOperationsPort & {
  deleteWorkspaceAndSelectNext(workspaceId: string, nextWorkspaceId: string): Promise<void>
}

async function loadServiceModule(): Promise<WorkspaceServiceModule> {
  return vi.importActual<WorkspaceServiceModule>('../../src/workspace/workspace-service')
}

async function addWorkspace(
  repositories: StorageRepositories,
  id: string,
  profileId: string,
  createdAt: number
): Promise<ReturnType<typeof createDefaultWorkspaceState>> {
  const state = createDefaultWorkspaceState(createdAt)
  state.workspace.id = id
  state.workspace.name = id
  state.workspace.activeRuleProfileId = profileId
  state.profile.id = profileId
  await repositories.profiles.save(state.profile)
  await repositories.workspaces.save(state.workspace)
  return state
}

async function seedMemory(ids: string[]) {
  const memory = createMemoryStorageContext()
  await memory.repositories.preferences.save(createDefaultWorkspaceState(1).preferences)
  for (const [index, id] of ids.entries()) {
    await addWorkspace(memory.repositories, id, `profile-${id}`, (index + 1) * 100)
  }
  await memory.repositories.selection.setActiveWorkspaceId(ids[0]!)
  return memory
}

async function rawGet(db: IDBDatabase, storeName: string, key: IDBValidKey): Promise<unknown> {
  const tx = db.transaction(storeName, 'readonly')
  const done = transactionDone(tx)
  const value = await requestToPromise(tx.objectStore(storeName).get(key))
  await done
  return value
}

describe('WorkspaceService delete', () => {
  it('refuses to delete the last workspace', async () => {
    const module = await loadServiceModule()
    const memory = await seedMemory(['workspace-only'])
    const service = module.createWorkspaceService({ repositories: memory.repositories, atomic: memory.atomicOperations })
    expect(typeof service.delete).toBe('function')
    if (typeof service.delete !== 'function') return

    await expect(service.delete('workspace-only')).rejects.toThrow()
    await expect(memory.repositories.workspaces.get('workspace-only')).resolves.toBeDefined()
  })

  it('deletes the active workspace, chooses the next stable workspace, and clears its session body only after success', async () => {
    const module = await loadServiceModule()
    const memory = await seedMemory(['workspace-a', 'workspace-b', 'workspace-c'])
    await memory.repositories.selection.setActiveWorkspaceId('workspace-b')
    const sessionDocuments = createSessionDocumentStore()
    sessionDocuments.set('workspace-b', { name: 'b.md', content: 'B', docType: 'markdown', updatedAt: 1 })
    sessionDocuments.set('workspace-c', { name: 'c.md', content: 'C', docType: 'markdown', updatedAt: 1 })
    const service = module.createWorkspaceService({
      repositories: memory.repositories,
      atomic: memory.atomicOperations,
      sessionDocuments
    })
    expect(typeof service.delete).toBe('function')
    if (typeof service.delete !== 'function') return

    const result = await service.delete('workspace-b')

    expect(result.deletedWorkspaceId).toBe('workspace-b')
    expect(result.active.workspace.id).toBe('workspace-c')
    await expect(memory.repositories.selection.getActiveWorkspaceId()).resolves.toBe('workspace-c')
    await expect(memory.repositories.workspaces.get('workspace-b')).resolves.toBeUndefined()
    await expect(memory.repositories.profiles.get('profile-workspace-b')).resolves.toBeDefined()
    expect(sessionDocuments.get('workspace-b')).toBeUndefined()
    expect(sessionDocuments.get('workspace-c')?.content).toBe('C')
  })

  it('deletes a non-active workspace without changing active selection', async () => {
    const module = await loadServiceModule()
    const memory = await seedMemory(['workspace-a', 'workspace-b'])
    const service = module.createWorkspaceService({ repositories: memory.repositories, atomic: memory.atomicOperations })
    expect(typeof service.delete).toBe('function')
    if (typeof service.delete !== 'function') return

    const result = await service.delete('workspace-b')
    expect(result.active.workspace.id).toBe('workspace-a')
    await expect(memory.repositories.selection.getActiveWorkspaceId()).resolves.toBe('workspace-a')
  })
})

describe('IndexedDB atomic active workspace deletion', () => {
  it('commits cascade deletion and successor selection together while retaining profiles', async () => {
    const db = await openDatabase(new IDBFactory())
    try {
      const repositories = createIndexedDbRepositories(db)
      const atomic = createIndexedDbAtomicOperations(db) as AtomicWithDeleteAndSelect
      expect(typeof atomic.deleteWorkspaceAndSelectNext).toBe('function')
      if (typeof atomic.deleteWorkspaceAndSelectNext !== 'function') return

      await repositories.preferences.save(createDefaultWorkspaceState(1).preferences)
      const a = createDefaultWorkspaceState(100)
      a.workspace.id = 'workspace-a'
      a.workspace.activeRuleProfileId = 'profile-a'
      a.profile.id = 'profile-a'
      const b = createDefaultWorkspaceState(200)
      b.workspace.id = 'workspace-b'
      b.workspace.activeRuleProfileId = 'profile-b'
      b.profile.id = 'profile-b'
      await atomic.createWorkspaceAndActivate(a.workspace, a.profile)
      await atomic.createWorkspaceAndActivate(b.workspace, b.profile)
      await repositories.selection.setActiveWorkspaceId('workspace-a')
      await repositories.documents.save({
        id: 'doc-a', workspaceId: 'workspace-a', name: 'a.md', content: 'A', docType: 'markdown',
        sourceKind: 'local', createdAt: 1, updatedAt: 1
      })

      const tx = db.transaction([STORE_DOCUMENT_SNAPSHOTS, STORE_SUPPRESSIONS], 'readwrite')
      const done = transactionDone(tx)
      tx.objectStore(STORE_DOCUMENT_SNAPSHOTS).put({
        id: 'snapshot-a', documentId: 'doc-a', revision: 1, content: 'A', reason: 'manual', createdAt: 1
      })
      tx.objectStore(STORE_SUPPRESSIONS).put({
        id: 'suppression-workspace-a', scope: 'workspace', scopeId: 'workspace-a', kind: 'rule', createdAt: 1
      })
      tx.objectStore(STORE_SUPPRESSIONS).put({
        id: 'suppression-document-a', scope: 'document', scopeId: 'doc-a', kind: 'rule', createdAt: 1
      })
      await done

      await atomic.deleteWorkspaceAndSelectNext('workspace-a', 'workspace-b')

      await expect(repositories.workspaces.get('workspace-a')).resolves.toBeUndefined()
      await expect(repositories.workspaces.get('workspace-b')).resolves.toBeDefined()
      await expect(repositories.selection.getActiveWorkspaceId()).resolves.toBe('workspace-b')
      await expect(repositories.profiles.get('profile-a')).resolves.toBeDefined()
      expect(await rawGet(db, STORE_WORKSPACE_DOCUMENTS, 'doc-a')).toBeUndefined()
      expect(await rawGet(db, STORE_DOCUMENT_SNAPSHOTS, 'snapshot-a')).toBeUndefined()
      expect(await rawGet(db, STORE_SUPPRESSIONS, 'suppression-workspace-a')).toBeUndefined()
      expect(await rawGet(db, STORE_SUPPRESSIONS, 'suppression-document-a')).toBeUndefined()
    } finally {
      db.close()
    }
  })
})
