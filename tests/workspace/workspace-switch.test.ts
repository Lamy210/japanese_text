import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultWorkspaceState } from '../../src/core/workspace/defaults'
import type { AppConfig } from '../../src/core/config/schema'
import type { GlobalPreferences, RuleProfile, Workspace } from '../../src/core/workspace/types'
import type { DocumentType } from '../../src/core/types'
import { createMemoryStorageContext } from '../../src/storage/repositories/memory'
import type { AtomicOperationsPort, StorageRepositories } from '../../src/storage/repositories/ports'
import { createSessionDocumentStore, type SessionDocument } from '../../src/workspace/session-document-store'

interface WorkspaceContext {
  workspace: Workspace
  profile: RuleProfile
  preferences: GlobalPreferences
  config: AppConfig
}

interface WorkspaceSwitchResult {
  context: WorkspaceContext
  document?: SessionDocument
  warning?: string
}

interface SwitchService {
  switchTo(targetWorkspaceId: string, currentDocument: SessionDocument): Promise<WorkspaceSwitchResult>
}

interface WorkspaceServiceModule {
  createWorkspaceService(deps: {
    repositories: StorageRepositories
    atomic: AtomicOperationsPort
    now?: () => number
    sessionDocuments?: ReturnType<typeof createSessionDocumentStore>
  }): SwitchService
}

interface StoredDocument {
  name: string
  content: string
  docType: DocumentType
  updatedAt: number
}

interface ExplicitPersistenceActions {
  persistWorkspaceDocumentDebounced(workspaceId: string, document: StoredDocument): void
  cancelPendingDocumentPersistence(): void
}

async function loadServiceModule(): Promise<WorkspaceServiceModule> {
  return vi.importActual<WorkspaceServiceModule>('../../src/workspace/workspace-service')
}

async function saveWorkspace(
  repositories: StorageRepositories,
  id: string,
  profileId: string,
  storageMode: 'private-session' | 'local-library',
  createdAt: number
): Promise<ReturnType<typeof createDefaultWorkspaceState>> {
  const state = createDefaultWorkspaceState(createdAt)
  state.workspace.id = id
  state.workspace.name = id
  state.workspace.activeRuleProfileId = profileId
  state.workspace.storageMode = storageMode
  state.profile.id = profileId
  await repositories.profiles.save(state.profile)
  await repositories.workspaces.save(state.workspace)
  return state
}

async function seedTwoWorkspaces(
  aMode: 'private-session' | 'local-library' = 'private-session',
  bMode: 'private-session' | 'local-library' = 'private-session'
) {
  const memory = createMemoryStorageContext()
  const preferences = createDefaultWorkspaceState(1).preferences
  await memory.repositories.preferences.save(preferences)
  const a = await saveWorkspace(memory.repositories, 'workspace-a', 'profile-a', aMode, 100)
  const b = await saveWorkspace(memory.repositories, 'workspace-b', 'profile-b', bMode, 200)
  await memory.repositories.selection.setActiveWorkspaceId(a.workspace.id)
  return { memory, a, b }
}

function doc(name: string, content: string, updatedAt: number): SessionDocument {
  return { name, content, docType: name.endsWith('.txt') ? 'text' : 'markdown', updatedAt }
}

afterEach(() => {
  vi.useRealTimers()
  Reflect.deleteProperty(globalThis, 'indexedDB')
  vi.resetModules()
})

describe('Workspace switching', () => {
  it('keeps private-session documents in memory across A -> B -> A without persistence', async () => {
    const module = await loadServiceModule()
    const { memory } = await seedTwoWorkspaces()
    const sessionDocuments = createSessionDocumentStore()
    const service = module.createWorkspaceService({
      repositories: memory.repositories,
      atomic: memory.atomicOperations,
      sessionDocuments
    })
    expect(typeof service.switchTo).toBe('function')
    if (typeof service.switchTo !== 'function') return

    const toB = await service.switchTo('workspace-b', doc('a.md', 'private A', 10))
    expect(toB.context.workspace.id).toBe('workspace-b')
    expect(toB.document).toBeUndefined()
    expect(await memory.repositories.documents.listByWorkspace('workspace-a')).toEqual([])

    const backToA = await service.switchTo('workspace-a', doc('b.md', 'private B', 20))
    expect(backToA.document).toEqual(doc('a.md', 'private A', 10))
    expect(await memory.repositories.documents.listByWorkspace('workspace-b')).toEqual([])
  })

  it('does not move active selection when flushing the current local-library document fails', async () => {
    const module = await loadServiceModule()
    const { memory } = await seedTwoWorkspaces('local-library', 'private-session')
    memory.repositories.documents.save = async () => {
      throw new Error('forced save failure')
    }
    const service = module.createWorkspaceService({
      repositories: memory.repositories,
      atomic: memory.atomicOperations,
      sessionDocuments: createSessionDocumentStore()
    })
    expect(typeof service.switchTo).toBe('function')
    if (typeof service.switchTo !== 'function') return

    await expect(service.switchTo('workspace-b', doc('a.md', 'unsaved A', 10))).rejects.toThrow('forced save failure')
    await expect(memory.repositories.selection.getActiveWorkspaceId()).resolves.toBe('workspace-a')
  })

  it('loads only the target local-library workspace document', async () => {
    const module = await loadServiceModule()
    const { memory } = await seedTwoWorkspaces('private-session', 'local-library')
    await memory.repositories.documents.save({
      id: 'doc-a', workspaceId: 'workspace-a', name: 'a.md', content: 'wrong A', docType: 'markdown',
      sourceKind: 'local', createdAt: 1, updatedAt: 50
    })
    await memory.repositories.documents.save({
      id: 'doc-b', workspaceId: 'workspace-b', name: 'b.md', content: 'target B', docType: 'markdown',
      sourceKind: 'local', createdAt: 1, updatedAt: 40
    })
    const service = module.createWorkspaceService({
      repositories: memory.repositories,
      atomic: memory.atomicOperations,
      sessionDocuments: createSessionDocumentStore()
    })
    expect(typeof service.switchTo).toBe('function')
    if (typeof service.switchTo !== 'function') return

    const result = await service.switchTo('workspace-b', doc('a.md', 'private current A', 60))
    expect(result.document?.content).toBe('target B')
  })
})

describe('Explicit workspace autosave', () => {
  it('captures the workspace id at schedule time so a later active switch cannot redirect the save', async () => {
    const factory = new IDBFactory()
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, writable: true, value: factory })
    vi.resetModules()

    const storage = await import('../../src/storage/storage')
    const context = await storage.getStorageContext()
    const initial = await context.repositories.workspaces.list()
    for (const workspace of initial) await context.atomic.deleteWorkspaceCascade(workspace.id)

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
    await context.repositories.preferences.save(a.preferences)
    await context.atomic.createWorkspaceAndActivate(a.workspace, a.profile)
    await context.atomic.createWorkspaceAndActivate(b.workspace, b.profile)
    await context.repositories.selection.setActiveWorkspaceId('workspace-a')

    const actions = await import('../../src/state/actions') as typeof import('../../src/state/actions') & Partial<ExplicitPersistenceActions>
    expect(typeof actions.persistWorkspaceDocumentDebounced).toBe('function')
    if (typeof actions.persistWorkspaceDocumentDebounced !== 'function') return

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    actions.persistWorkspaceDocumentDebounced('workspace-a', {
      name: 'captured.md', content: 'belongs to A', docType: 'markdown', updatedAt: 500
    })
    await context.repositories.selection.setActiveWorkspaceId('workspace-b')
    await vi.advanceTimersByTimeAsync(800)
    vi.useRealTimers()

    let aDocs = await context.repositories.documents.listByWorkspace('workspace-a')
    for (let attempt = 0; attempt < 20 && aDocs.length === 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      aDocs = await context.repositories.documents.listByWorkspace('workspace-a')
    }
    const bDocs = await context.repositories.documents.listByWorkspace('workspace-b')
    expect(aDocs).toHaveLength(1)
    expect(aDocs[0]?.content).toBe('belongs to A')
    expect(bDocs).toEqual([])
  })
})
