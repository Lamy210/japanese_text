import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultWorkspaceState } from '../../src/core/workspace/defaults'
import type { AppConfig } from '../../src/core/config/schema'
import type { GlobalPreferences, RuleProfile, Workspace } from '../../src/core/workspace/types'
import { createIndexedDbAtomicOperations } from '../../src/storage/db/indexeddb-atomic-operations'
import { requestToPromise, transactionDone } from '../../src/storage/db/idb-utils'
import { openDatabase } from '../../src/storage/db/open-database'
import { STORE_DOCUMENT_SNAPSHOTS } from '../../src/storage/db/schema'
import { createIndexedDbRepositories } from '../../src/storage/repositories/indexeddb'
import { createMemoryStorageContext } from '../../src/storage/repositories/memory'
import type { AtomicOperationsPort, StorageRepositories } from '../../src/storage/repositories/ports'
import { createSessionDocumentStore, type SessionDocument } from '../../src/workspace/session-document-store'

interface WorkspaceContext {
  workspace: Workspace
  profile: RuleProfile
  preferences: GlobalPreferences
  config: AppConfig
}

interface StorageModeService {
  setStorageMode(
    workspaceId: string,
    mode: 'private-session' | 'local-library',
    currentDocument?: SessionDocument
  ): Promise<WorkspaceContext>
}

interface WorkspaceServiceModule {
  createWorkspaceService(deps: {
    repositories: StorageRepositories
    atomic: AtomicOperationsPort
    durableBackend?: boolean
    sessionDocuments?: ReturnType<typeof createSessionDocumentStore>
  }): StorageModeService
}

type TransitionAtomic = AtomicOperationsPort & {
  enableLocalLibrary(
    workspaceId: string,
    document: {
      id: string
      workspaceId: string
      name: string
      content?: string
      docType: 'markdown' | 'text'
      sourceKind: 'local' | 'file'
      createdAt: number
      updatedAt: number
    }
  ): Promise<void>
  makeWorkspacePrivate(workspaceId: string): Promise<void>
}

function sessionDoc(content = 'current body'): SessionDocument {
  return { name: 'draft.md', content, docType: 'markdown', updatedAt: 500 }
}

async function loadServiceModule(): Promise<WorkspaceServiceModule> {
  return vi.importActual<WorkspaceServiceModule>('../../src/workspace/workspace-service')
}

async function rawGet(db: IDBDatabase, storeName: string, key: IDBValidKey): Promise<unknown> {
  const tx = db.transaction(storeName, 'readonly')
  const done = transactionDone(tx)
  const value = await requestToPromise(tx.objectStore(storeName).get(key))
  await done
  return value
}

function installIndexedDb(factory: IDBFactory): void {
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    writable: true,
    value: factory
  })
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'indexedDB')
  vi.resetModules()
})

describe('canonical config persistence', () => {
  it('does not let normal saveConfig enable Local Library on a private workspace', async () => {
    const factory = new IDBFactory()
    installIndexedDb(factory)
    vi.resetModules()
    const storage = await import('../../src/storage/storage')

    const config = (await storage.loadConfig())!
    expect(config.privacy).toEqual({ autoSave: false, privacyMode: true })
    config.privacy = { autoSave: true, privacyMode: false }
    await storage.saveConfig(config)

    await expect(storage.loadConfig()).resolves.toMatchObject({
      privacy: { autoSave: false, privacyMode: true }
    })
    const context = await storage.getStorageContext()
    const activeId = await context.repositories.selection.getActiveWorkspaceId()
    expect((await context.repositories.workspaces.get(activeId!))?.storageMode).toBe('private-session')
  })

  it('does not let config import change the in-memory compatibility privacy view', async () => {
    const factory = new IDBFactory()
    installIndexedDb(factory)
    vi.resetModules()
    const storage = await import('../../src/storage/storage')
    const { appState } = await import('../../src/state/app-state')
    const actions = await import('../../src/state/actions')

    const current = (await storage.loadConfig())!
    expect(appState.loadConfigFrom(current).ok).toBe(true)
    const imported = structuredClone(current)
    imported.privacy = { autoSave: true, privacyMode: false }
    const file = new File([JSON.stringify(imported)], 'config.json', { type: 'application/json' })

    await actions.importConfigFile(file)

    expect(appState.config.privacy).toEqual({ autoSave: false, privacyMode: true })
  })
})

describe('atomic storage mode operations', () => {
  it('atomically enables Local Library and writes the first body', async () => {
    const db = await openDatabase(new IDBFactory())
    try {
      const repositories = createIndexedDbRepositories(db)
      const atomic = createIndexedDbAtomicOperations(db, () => 600) as TransitionAtomic
      expect(typeof atomic.enableLocalLibrary).toBe('function')
      if (typeof atomic.enableLocalLibrary !== 'function') return

      const state = createDefaultWorkspaceState(100)
      await repositories.preferences.save(state.preferences)
      await atomic.createWorkspaceAndActivate(state.workspace, state.profile)

      await atomic.enableLocalLibrary(state.workspace.id, {
        id: `local-recent-document:${state.workspace.id}`,
        workspaceId: state.workspace.id,
        name: 'draft.md',
        content: 'first body',
        docType: 'markdown',
        sourceKind: 'local',
        createdAt: 500,
        updatedAt: 500
      })

      expect((await repositories.workspaces.get(state.workspace.id))?.storageMode).toBe('local-library')
      await expect(repositories.documents.listByWorkspace(state.workspace.id)).resolves.toEqual([
        expect.objectContaining({ content: 'first body' })
      ])
    } finally {
      db.close()
    }
  })

  it('atomically makes one Local workspace private and scrubs its bodies/snapshots only', async () => {
    const db = await openDatabase(new IDBFactory())
    try {
      const repositories = createIndexedDbRepositories(db)
      const atomic = createIndexedDbAtomicOperations(db, () => 900) as TransitionAtomic
      expect(typeof atomic.makeWorkspacePrivate).toBe('function')
      if (typeof atomic.makeWorkspacePrivate !== 'function') return

      const a = createDefaultWorkspaceState(100)
      a.workspace.id = 'workspace-a'
      a.workspace.activeRuleProfileId = 'profile-a'
      a.workspace.storageMode = 'local-library'
      a.profile.id = 'profile-a'
      const b = createDefaultWorkspaceState(200)
      b.workspace.id = 'workspace-b'
      b.workspace.activeRuleProfileId = 'profile-b'
      b.workspace.storageMode = 'local-library'
      b.profile.id = 'profile-b'
      await repositories.preferences.save(a.preferences)
      await atomic.createWorkspaceAndActivate(a.workspace, a.profile)
      await atomic.createWorkspaceAndActivate(b.workspace, b.profile)
      await repositories.documents.save({
        id: 'doc-a', workspaceId: 'workspace-a', name: 'a.md', content: 'A', docType: 'markdown',
        sourceKind: 'local', createdAt: 1, updatedAt: 1
      })
      await repositories.documents.save({
        id: 'doc-b', workspaceId: 'workspace-b', name: 'b.md', content: 'B', docType: 'markdown',
        sourceKind: 'local', createdAt: 1, updatedAt: 1
      })
      const tx = db.transaction(STORE_DOCUMENT_SNAPSHOTS, 'readwrite')
      const done = transactionDone(tx)
      tx.objectStore(STORE_DOCUMENT_SNAPSHOTS).put({
        id: 'snapshot-a', documentId: 'doc-a', revision: 1, content: 'A old', reason: 'manual', createdAt: 1
      })
      tx.objectStore(STORE_DOCUMENT_SNAPSHOTS).put({
        id: 'snapshot-b', documentId: 'doc-b', revision: 1, content: 'B old', reason: 'manual', createdAt: 1
      })
      await done

      await atomic.makeWorkspacePrivate('workspace-a')

      expect((await repositories.workspaces.get('workspace-a'))?.storageMode).toBe('private-session')
      await expect(repositories.documents.listByWorkspace('workspace-a')).resolves.toEqual([])
      await expect(repositories.documents.listByWorkspace('workspace-b')).resolves.toHaveLength(1)
      expect(await rawGet(db, STORE_DOCUMENT_SNAPSHOTS, 'snapshot-a')).toBeUndefined()
      expect(await rawGet(db, STORE_DOCUMENT_SNAPSHOTS, 'snapshot-b')).toBeDefined()
    } finally {
      db.close()
    }
  })
})

describe('WorkspaceService storage policy', () => {
  it('rejects Local Library on a non-durable memory fallback', async () => {
    const module = await loadServiceModule()
    const memory = createMemoryStorageContext()
    const state = createDefaultWorkspaceState(100)
    await memory.repositories.preferences.save(state.preferences)
    await memory.atomicOperations.createWorkspaceAndActivate(state.workspace, state.profile)
    const service = module.createWorkspaceService({
      repositories: memory.repositories,
      atomic: memory.atomicOperations,
      durableBackend: false,
      sessionDocuments: createSessionDocumentStore()
    })
    expect(typeof service.setStorageMode).toBe('function')
    if (typeof service.setStorageMode !== 'function') return

    await expect(service.setStorageMode(state.workspace.id, 'local-library', sessionDoc())).rejects.toThrow()
    expect((await memory.repositories.workspaces.get(state.workspace.id))?.storageMode).toBe('private-session')
    await expect(memory.repositories.documents.listByWorkspace(state.workspace.id)).resolves.toEqual([])
  })

  it('retains the current body in session memory after Local -> Private and does not partially mutate on failure', async () => {
    const module = await loadServiceModule()
    const memory = createMemoryStorageContext()
    const state = createDefaultWorkspaceState(100)
    state.workspace.storageMode = 'local-library'
    await memory.repositories.preferences.save(state.preferences)
    await memory.atomicOperations.createWorkspaceAndActivate(state.workspace, state.profile)
    await memory.repositories.documents.save({
      id: 'doc', workspaceId: state.workspace.id, name: 'draft.md', content: 'persisted', docType: 'markdown',
      sourceKind: 'local', createdAt: 1, updatedAt: 1
    })
    const sessionDocuments = createSessionDocumentStore()
    const failingAtomic: AtomicOperationsPort = {
      ...memory.atomicOperations,
      async makeWorkspacePrivate() {
        throw new Error('forced transition failure')
      }
    } as AtomicOperationsPort
    const service = module.createWorkspaceService({
      repositories: memory.repositories,
      atomic: failingAtomic,
      durableBackend: true,
      sessionDocuments
    })
    expect(typeof service.setStorageMode).toBe('function')
    if (typeof service.setStorageMode !== 'function') return

    await expect(service.setStorageMode(state.workspace.id, 'private-session', sessionDoc('editor body')))
      .rejects.toThrow('forced transition failure')
    expect((await memory.repositories.workspaces.get(state.workspace.id))?.storageMode).toBe('local-library')
    await expect(memory.repositories.documents.listByWorkspace(state.workspace.id)).resolves.toHaveLength(1)
    expect(sessionDocuments.get(state.workspace.id)).toBeUndefined()
  })
})
