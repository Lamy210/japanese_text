import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StoredWorkspaceDocument } from '../../src/core/workspace/types'
import { createStorageContext, type StorageContext } from '../../src/storage/bootstrap'
import { createApplicationRuntime, type ApplicationRuntime } from '../../src/state/application-runtime'

function storedDocument(
  workspaceId: string,
  id: string,
  content: string,
  createdAt: number,
  updatedAt: number
): StoredWorkspaceDocument {
  return {
    id,
    workspaceId,
    name: `${id}.md`,
    content,
    docType: 'markdown',
    sourceKind: 'local',
    createdAt,
    updatedAt
  }
}

async function harness(context: StorageContext, runtime: ApplicationRuntime, now = 1000) {
  vi.resetModules()
  const [{ appState }, workspaceModule, documentModule] = await Promise.all([
    import('../../src/state/app-state'),
    import('../../src/state/workspace-controller'),
    import('../../src/state/document-controller')
  ])
  const relint = vi.fn()
  const cancelPendingDocumentPersistence = vi.fn()
  const controller = workspaceModule.createWorkspaceController({
    runtime,
    relint,
    toast: vi.fn(),
    cancelPendingDocumentPersistence,
    now: () => now
  })
  const documentController = documentModule.createDocumentController({
    getDocumentService: runtime.getDocumentService,
    getWorkspaceService: runtime.getWorkspaceService,
    relint,
    toast: vi.fn(),
    cancelPendingDocumentPersistence,
    now: () => now
  })
  return { appState, controller, documentController, cancelPendingDocumentPersistence }
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'indexedDB')
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('multi-document storage mode transitions', () => {
  it('moves every Private Session document and the active ID into Local Library atomically', async () => {
    const context = await createStorageContext({ factory: new IDBFactory(), now: () => 1000 })
    const runtime = createApplicationRuntime({ getContext: async () => context, now: () => 1000 })
    const { appState, controller, documentController } = await harness(context, runtime)
    await controller.bootstrap()
    const workspaceId = appState.activeWorkspaceId()!
    const firstId = appState.activeDocumentId()!

    appState.setDocument('private first', 'first.md', 'markdown')
    await documentController.createDocument()
    const secondId = appState.activeDocumentId()!
    appState.setDocument('private second', 'second.md', 'markdown')
    await documentController.createDocument()
    const thirdId = appState.activeDocumentId()!
    appState.setDocument('private third latest', 'third.md', 'markdown')

    await controller.setStorageMode('local-library')

    expect((await context.repositories.workspaces.get(workspaceId))?.storageMode).toBe('local-library')
    const persisted = await context.repositories.documents.listByWorkspace(workspaceId)
    expect(persisted).toHaveLength(3)
    expect(persisted).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: firstId, content: 'private first' }),
      expect.objectContaining({ id: secondId, content: 'private second' }),
      expect.objectContaining({ id: thirdId, content: 'private third latest' })
    ]))
    await expect(context.repositories.documentSelection.getActiveDocumentId(workspaceId)).resolves.toBe(thirdId)
    expect(runtime.getSessionDocumentLibrary().list(workspaceId)).toEqual([])
    expect(appState.activeDocumentId()).toBe(thirdId)
    expect(appState.documentSummaries()).toHaveLength(3)
    expect(appState.documentText()).toBe('private third latest')
    expect(appState.config.privacy).toEqual({ autoSave: true, privacyMode: false })
  })

  it('moves every Local Library document into Private Session only after durable scrub succeeds', async () => {
    const context = await createStorageContext({ factory: new IDBFactory(), now: () => 1000 })
    const runtime = createApplicationRuntime({ getContext: async () => context, now: () => 1000 })
    const workspaceService = await runtime.getWorkspaceService()
    const workspace = (await workspaceService.getActive()).workspace
    const first = storedDocument(workspace.id, 'local-a', 'A', 10, 10)
    const second = storedDocument(workspace.id, 'local-b', 'B', 20, 20)
    const third = storedDocument(workspace.id, 'local-c', 'C', 30, 30)
    await context.atomic.enableLocalLibrary(workspace.id, [first, second, third], second.id)

    const { appState, controller } = await harness(context, runtime)
    await controller.bootstrap()
    expect(appState.activeDocumentId()).toBe(second.id)
    appState.setDocument('B latest editor', second.name, second.docType)

    await controller.setStorageMode('private-session')

    expect((await context.repositories.workspaces.get(workspace.id))?.storageMode).toBe('private-session')
    await expect(context.repositories.documents.listByWorkspace(workspace.id)).resolves.toEqual([])
    await expect(context.repositories.documentSelection.getActiveDocumentId(workspace.id)).resolves.toBeUndefined()
    const session = runtime.getSessionDocumentLibrary()
    expect(session.list(workspace.id)).toHaveLength(3)
    expect(session.get(workspace.id, first.id)?.content).toBe('A')
    expect(session.get(workspace.id, second.id)?.content).toBe('B latest editor')
    expect(session.get(workspace.id, third.id)?.content).toBe('C')
    expect(session.getActiveDocumentId(workspace.id)).toBe(second.id)
    expect(appState.activeDocumentId()).toBe(second.id)
    expect(appState.documentSummaries()).toHaveLength(3)
    expect(appState.documentText()).toBe('B latest editor')
    expect(appState.config.privacy).toEqual({ autoSave: false, privacyMode: true })
  })

  it('passes the complete Private library to the atomic enable operation and keeps memory on failure', async () => {
    const context = await createStorageContext({ factory: new IDBFactory(), now: () => 1000 })
    const runtime = createApplicationRuntime({ getContext: async () => context, now: () => 1000 })
    const { appState, controller, documentController } = await harness(context, runtime)
    await controller.bootstrap()
    const workspaceId = appState.activeWorkspaceId()!

    appState.setDocument('first', 'first.md', 'markdown')
    await documentController.createDocument()
    appState.setDocument('second', 'second.md', 'markdown')
    await documentController.createDocument()
    appState.setDocument('third', 'third.md', 'markdown')
    const activeId = appState.activeDocumentId()!
    const beforeIds = runtime.getSessionDocumentLibrary().list(workspaceId).map((doc) => doc.id).sort()

    let capturedDocuments: StoredWorkspaceDocument[] = []
    let capturedActiveId = ''
    context.atomic.enableLocalLibrary = async (_workspaceId, documents, activeDocumentId) => {
      capturedDocuments = structuredClone(documents)
      capturedActiveId = activeDocumentId
      throw new Error('forced enable failure')
    }

    await expect(controller.setStorageMode('local-library')).rejects.toThrow('forced enable failure')

    expect(capturedDocuments).toHaveLength(3)
    expect(capturedDocuments.map((doc) => doc.id).sort()).toEqual(beforeIds)
    expect(capturedActiveId).toBe(activeId)
    expect((await context.repositories.workspaces.get(workspaceId))?.storageMode).toBe('private-session')
    await expect(context.repositories.documents.listByWorkspace(workspaceId)).resolves.toEqual([])
    expect(runtime.getSessionDocumentLibrary().list(workspaceId).map((doc) => doc.id).sort()).toEqual(beforeIds)
    expect(runtime.getSessionDocumentLibrary().getActiveDocumentId(workspaceId)).toBe(activeId)
  })

  it('does not publish a Local snapshot into session memory when durable scrub fails', async () => {
    const context = await createStorageContext({ factory: new IDBFactory(), now: () => 1000 })
    const runtime = createApplicationRuntime({ getContext: async () => context, now: () => 1000 })
    const workspaceService = await runtime.getWorkspaceService()
    const workspace = (await workspaceService.getActive()).workspace
    const first = storedDocument(workspace.id, 'local-a', 'A', 10, 10)
    const second = storedDocument(workspace.id, 'local-b', 'B', 20, 20)
    const third = storedDocument(workspace.id, 'local-c', 'C', 30, 30)
    await context.atomic.enableLocalLibrary(workspace.id, [first, second, third], second.id)
    const { appState, controller } = await harness(context, runtime)
    await controller.bootstrap()
    appState.setDocument('B latest', second.name, second.docType)

    context.atomic.makeWorkspacePrivate = async () => {
      throw new Error('forced scrub failure')
    }

    await expect(controller.setStorageMode('private-session')).rejects.toThrow('forced scrub failure')

    expect((await context.repositories.workspaces.get(workspace.id))?.storageMode).toBe('local-library')
    await expect(context.repositories.documents.listByWorkspace(workspace.id)).resolves.toHaveLength(3)
    await expect(context.repositories.documentSelection.getActiveDocumentId(workspace.id)).resolves.toBe(second.id)
    expect(runtime.getSessionDocumentLibrary().list(workspace.id)).toEqual([])
  })
})
