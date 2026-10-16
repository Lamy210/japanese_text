import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultWorkspaceState } from '../../src/core/workspace/defaults'
import type { StoredWorkspaceDocument } from '../../src/core/workspace/types'
import { createStorageContext, type StorageContext } from '../../src/storage/bootstrap'
import { createMemoryStorageContext } from '../../src/storage/repositories/memory'
import { createApplicationRuntime, type ApplicationRuntime } from '../../src/state/application-runtime'

function storedDocument(
  workspaceId: string,
  id: string,
  name: string,
  content: string,
  createdAt: number,
  updatedAt: number
): StoredWorkspaceDocument {
  return {
    id,
    workspaceId,
    name,
    content,
    docType: 'markdown',
    sourceKind: 'local',
    createdAt,
    updatedAt
  }
}

function installIndexedDb(factory: IDBFactory): void {
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    writable: true,
    value: factory
  })
}

async function loadControllerHarness(context: StorageContext, runtime: ApplicationRuntime, now = 1000) {
  vi.resetModules()
  const [{ appState }, workspaceModule, documentModule] = await Promise.all([
    import('../../src/state/app-state'),
    import('../../src/state/workspace-controller'),
    import('../../src/state/document-controller')
  ])
  const relint = vi.fn()
  const cancelPendingDocumentPersistence = vi.fn()
  const controller = workspaceModule.createWorkspaceController({
    getContext: async () => context,
    runtime,
    relint,
    toast: vi.fn(),
    cancelPendingDocumentPersistence,
    now: () => now
  } as never)
  const documentController = documentModule.createDocumentController({
    getDocumentService: runtime.getDocumentService,
    getWorkspaceService: runtime.getWorkspaceService,
    relint,
    toast: vi.fn(),
    cancelPendingDocumentPersistence,
    now: () => now
  })
  return { appState, controller, documentController, relint, cancelPendingDocumentPersistence }
}

afterEach(() => {
  vi.useRealTimers()
  Reflect.deleteProperty(globalThis, 'indexedDB')
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('workspace/document integration regressions', () => {
  it('restores explicit Local active document identity instead of choosing the newest document', async () => {
    const context = await createStorageContext({ factory: new IDBFactory(), now: () => 1000 })
    const runtime = createApplicationRuntime({ getContext: async () => context, now: () => 1000 })
    const workspaceService = await runtime.getWorkspaceService()
    const workspaceA = (await workspaceService.getActive()).workspace
    const a1 = storedDocument(workspaceA.id, 'a1', 'a1.md', 'A1 original', 10, 900)
    const a2 = storedDocument(workspaceA.id, 'a2', 'a2.md', 'A2 active', 20, 100)
    await context.atomic.enableLocalLibrary(workspaceA.id, [a1, a2], a2.id)

    const workspaceB = (await workspaceService.create({ name: 'Workspace B' })).workspace
    const b1 = storedDocument(workspaceB.id, 'b1', 'b1.md', 'B1 active', 30, 300)
    await context.atomic.enableLocalLibrary(workspaceB.id, [b1], b1.id)
    await context.repositories.selection.setActiveWorkspaceId(workspaceA.id)

    const { appState, controller } = await loadControllerHarness(context, runtime)
    await controller.bootstrap()
    expect(appState.activeDocumentId()).toBe(a2.id)
    expect(appState.documentText()).toBe('A2 active')

    await controller.switchWorkspace(workspaceB.id)
    expect(appState.activeDocumentId()).toBe(b1.id)
    expect(appState.documentText()).toBe('B1 active')

    await controller.switchWorkspace(workspaceA.id)
    expect(appState.activeDocumentId()).toBe(a2.id)
    expect(appState.documentText()).toBe('A2 active')
    await expect(context.repositories.documents.get(a1.id)).resolves.toMatchObject({
      name: 'a1.md',
      content: 'A1 original',
      updatedAt: 900
    })
  })

  it('restores the active Private Session document across A -> B -> A using the shared library', async () => {
    const context = await createStorageContext({
      factory: { open() { throw new Error('memory only') } } as unknown as IDBFactory,
      now: () => 1000
    })
    const runtime = createApplicationRuntime({ getContext: async () => context, now: () => 1000 })
    const { appState, controller, documentController } = await loadControllerHarness(context, runtime)
    await controller.bootstrap()
    const workspaceA = appState.activeWorkspaceId()!

    await documentController.createDocument()
    const documentA2 = appState.activeDocumentId()!
    appState.setDocument('A2 body', 'a2.md', 'markdown')

    await controller.createWorkspace('Workspace B')
    const workspaceB = appState.activeWorkspaceId()!
    await documentController.createDocument()
    const documentB2 = appState.activeDocumentId()!
    appState.setDocument('B2 body', 'b2.md', 'markdown')

    await controller.switchWorkspace(workspaceA)
    expect(appState.activeDocumentId()).toBe(documentA2)
    expect(appState.documentText()).toBe('A2 body')
    expect(appState.documentSummaries()).toContainEqual(expect.objectContaining({ id: documentA2, active: true }))

    await controller.switchWorkspace(workspaceB)
    expect(appState.activeDocumentId()).toBe(documentB2)
    expect(appState.documentText()).toBe('B2 body')
  })

  it('clears only the deleted Private Workspace session library after workspace deletion succeeds', async () => {
    const context = await createStorageContext({
      factory: { open() { throw new Error('memory only') } } as unknown as IDBFactory,
      now: () => 1000
    })
    const runtime = createApplicationRuntime({ getContext: async () => context, now: () => 1000 })
    const { appState, controller, documentController } = await loadControllerHarness(context, runtime)
    await controller.bootstrap()
    const workspaceA = appState.activeWorkspaceId()!
    const documentA = appState.activeDocumentId()!

    await controller.createWorkspace('Workspace B')
    const workspaceB = appState.activeWorkspaceId()!
    await documentController.createDocument()
    const documentB = appState.activeDocumentId()!
    expect(runtime.getSessionDocumentLibrary().get(workspaceB, documentB)).toBeDefined()

    await controller.switchWorkspace(workspaceA)
    await controller.deleteWorkspace(workspaceB)

    expect(runtime.getSessionDocumentLibrary().get(workspaceB, documentB)).toBeUndefined()
    expect(runtime.getSessionDocumentLibrary().get(workspaceA, documentA)).toBeDefined()
    expect(appState.activeWorkspaceId()).toBe(workspaceA)
  })

  it('does not clear Private session documents when workspace deletion fails', async () => {
    const context = await createStorageContext({
      factory: { open() { throw new Error('memory only') } } as unknown as IDBFactory,
      now: () => 1000
    })
    const runtime = createApplicationRuntime({ getContext: async () => context, now: () => 1000 })
    const { appState, controller, documentController } = await loadControllerHarness(context, runtime)
    await controller.bootstrap()
    const workspaceA = appState.activeWorkspaceId()!

    await controller.createWorkspace('Workspace B')
    const workspaceB = appState.activeWorkspaceId()!
    await documentController.createDocument()
    const documentB = appState.activeDocumentId()!
    await controller.switchWorkspace(workspaceA)

    context.atomic.deleteWorkspaceCascade = async () => {
      throw new Error('forced delete failure')
    }

    await expect(controller.deleteWorkspace(workspaceB)).rejects.toThrow('forced delete failure')
    expect(runtime.getSessionDocumentLibrary().get(workspaceB, documentB)).toBeDefined()
    await expect(context.repositories.workspaces.get(workspaceB)).resolves.toBeDefined()
  })

  it('cancels a stale autosave across document and Workspace navigation before it can overwrite the flushed body', async () => {
    const factory = new IDBFactory()
    installIndexedDb(factory)
    vi.resetModules()
    const storage = await import('../../src/storage/storage')
    const { appState } = await import('../../src/state/app-state')
    const actions = await import('../../src/state/actions')
    const { workspaceController, documentController } = await import('../../src/state/workspace-runtime')
    const context = await storage.getStorageContext()

    await workspaceController.bootstrap()
    await workspaceController.setStorageMode('local-library')
    const firstId = appState.activeDocumentId()!
    await documentController.createDocument()
    const secondId = appState.activeDocumentId()!
    const summary = appState.documentSummaries().find((value) => value.id === secondId)!

    appState.setDocument('fresh body before navigation', summary.name, summary.docType)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    actions.persistDocumentDebounced({
      workspaceId: summary.workspaceId,
      documentId: summary.id,
      name: summary.name,
      content: 'stale timer body',
      docType: summary.docType,
      sourceKind: summary.sourceKind,
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt + 1
    })

    await documentController.switchDocument(firstId)
    await workspaceController.createWorkspace('Workspace B')
    await vi.advanceTimersByTimeAsync(800)
    vi.useRealTimers()

    await expect(context.repositories.documents.get(secondId)).resolves.toMatchObject({
      content: 'fresh body before navigation'
    })
    expect(appState.activeWorkspaceId()).not.toBe(summary.workspaceId)
  })

  it('keeps all three Private documents canonical in memory when Private to Local atomic commit fails', async () => {
    const memory = createMemoryStorageContext(() => 1000)
    const state = createDefaultWorkspaceState(100)
    await memory.repositories.preferences.save(state.preferences)
    await memory.atomicOperations.createWorkspaceAndActivate(state.workspace, state.profile)
    const atomic = {
      ...memory.atomicOperations,
      async enableLocalLibrary(): Promise<void> {
        throw new Error('forced Private to Local failure')
      }
    }
    const context: StorageContext = {
      durable: true,
      repositories: memory.repositories,
      atomic,
      migration: { state: 'not-needed' }
    }
    const runtime = createApplicationRuntime({ getContext: async () => context, now: () => 1000 })
    const { appState, controller, documentController } = await loadControllerHarness(context, runtime)
    await controller.bootstrap()
    await documentController.createDocument()
    await documentController.createDocument()
    const activeId = appState.activeDocumentId()!
    const before = runtime.getSessionDocumentLibrary().list(state.workspace.id).map((value) => value.id).sort()
    expect(before).toHaveLength(3)

    await expect(controller.setStorageMode('local-library')).rejects.toThrow('forced Private to Local failure')

    expect((await memory.repositories.workspaces.get(state.workspace.id))?.storageMode).toBe('private-session')
    expect(runtime.getSessionDocumentLibrary().list(state.workspace.id).map((value) => value.id).sort()).toEqual(before)
    expect(runtime.getSessionDocumentLibrary().getActiveDocumentId(state.workspace.id)).toBe(activeId)
    await expect(memory.repositories.documents.listByWorkspace(state.workspace.id)).resolves.toEqual([])
    await expect(memory.repositories.documentSelection.getActiveDocumentId(state.workspace.id)).resolves.toBeUndefined()
  })

  it('keeps all three Local documents canonical in durable storage when Local to Private atomic scrub fails', async () => {
    const memory = createMemoryStorageContext(() => 1000)
    const state = createDefaultWorkspaceState(100)
    await memory.repositories.preferences.save(state.preferences)
    await memory.atomicOperations.createWorkspaceAndActivate(state.workspace, state.profile)
    const docs = [
      storedDocument(state.workspace.id, 'doc-a', 'a.md', 'A', 1, 1),
      storedDocument(state.workspace.id, 'doc-b', 'b.md', 'B', 2, 2),
      storedDocument(state.workspace.id, 'doc-c', 'c.md', 'C', 3, 3)
    ]
    await memory.atomicOperations.enableLocalLibrary(state.workspace.id, docs, 'doc-b')
    const atomic = {
      ...memory.atomicOperations,
      async makeWorkspacePrivate(): Promise<void> {
        throw new Error('forced Local to Private failure')
      }
    }
    const context: StorageContext = {
      durable: true,
      repositories: memory.repositories,
      atomic,
      migration: { state: 'not-needed' }
    }
    const runtime = createApplicationRuntime({ getContext: async () => context, now: () => 1000 })
    const { appState, controller } = await loadControllerHarness(context, runtime)
    await controller.bootstrap()
    expect(appState.activeDocumentId()).toBe('doc-b')

    await expect(controller.setStorageMode('private-session')).rejects.toThrow('forced Local to Private failure')

    expect((await memory.repositories.workspaces.get(state.workspace.id))?.storageMode).toBe('local-library')
    expect((await memory.repositories.documents.listByWorkspace(state.workspace.id)).map((value) => value.id).sort()).toEqual([
      'doc-a',
      'doc-b',
      'doc-c'
    ])
    await expect(memory.repositories.documentSelection.getActiveDocumentId(state.workspace.id)).resolves.toBe('doc-b')
    expect(runtime.getSessionDocumentLibrary().list(state.workspace.id)).toEqual([])
  })
})