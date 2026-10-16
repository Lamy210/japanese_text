import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStorageContext } from '../../src/storage/bootstrap'
import { createApplicationRuntime } from '../../src/state/application-runtime'

function installIndexedDb(factory: IDBFactory): void {
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    writable: true,
    value: factory
  })
}

afterEach(() => {
  vi.useRealTimers()
  Reflect.deleteProperty(globalThis, 'indexedDB')
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('Phase 2C adversarial cross-boundary regressions', () => {
  it('does not let a stale autosave survive document navigation followed by Workspace navigation', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    installIndexedDb(new IDBFactory())
    vi.resetModules()

    const [{ appState }, actions, runtimeModule, storage] = await Promise.all([
      import('../../src/state/app-state'),
      import('../../src/state/actions'),
      import('../../src/state/workspace-runtime'),
      import('../../src/storage/storage')
    ])

    await runtimeModule.workspaceController.bootstrap()
    appState.setDocument('A latest editor body', 'a.md', 'markdown')
    await runtimeModule.workspaceController.setStorageMode('local-library')

    const workspaceA = appState.activeWorkspaceId()!
    const documentA = appState.activeDocumentId()!
    const summaryA = appState.documentSummaries().find((value) => value.id === documentA)!

    appState.setDocument('A newest before navigation', summaryA.name, summaryA.docType)
    actions.persistDocumentDebounced({
      workspaceId: workspaceA,
      documentId: documentA,
      name: summaryA.name,
      content: 'STALE TIMER BODY',
      docType: summaryA.docType,
      sourceKind: summaryA.sourceKind,
      createdAt: summaryA.createdAt,
      updatedAt: 9000
    })

    await runtimeModule.documentController.createDocument()
    await runtimeModule.workspaceController.createWorkspace('Workspace B')
    await vi.advanceTimersByTimeAsync(800)
    vi.useRealTimers()
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    const context = await storage.getStorageContext()
    await expect(context.repositories.documents.get(documentA)).resolves.toMatchObject({
      workspaceId: workspaceA,
      content: 'A newest before navigation'
    })
  })

  it('keeps Private Session document library and active selection out of durable storage through bootstrap and import', async () => {
    const context = await createStorageContext({ factory: new IDBFactory(), now: () => 1000 })
    const runtime = createApplicationRuntime({ getContext: async () => context, now: () => 1000 })
    vi.resetModules()
    const [{ appState }, workspaceModule, documentModule] = await Promise.all([
      import('../../src/state/app-state'),
      import('../../src/state/workspace-controller'),
      import('../../src/state/document-controller')
    ])
    const workspaceController = workspaceModule.createWorkspaceController({
      runtime,
      relint: vi.fn(),
      toast: vi.fn(),
      cancelPendingDocumentPersistence: vi.fn(),
      now: () => 1000
    })
    const documentController = documentModule.createDocumentController({
      getDocumentService: runtime.getDocumentService,
      getWorkspaceService: runtime.getWorkspaceService,
      relint: vi.fn(),
      toast: vi.fn(),
      cancelPendingDocumentPersistence: vi.fn(),
      now: () => 1000
    })

    await workspaceController.bootstrap()
    const workspaceId = appState.activeWorkspaceId()!
    await documentController.importFile(new File(['private imported body'], 'private.md', { type: 'text/markdown' }))

    await expect(context.repositories.documents.listByWorkspace(workspaceId)).resolves.toEqual([])
    await expect(context.repositories.documentSelection.getActiveDocumentId(workspaceId)).resolves.toBeUndefined()
    expect(runtime.getSessionDocumentLibrary().list(workspaceId)).toHaveLength(2)
  })

  it('treats a Phase 2B local-recent document as one library document and repairs missing active meta to it', async () => {
    const context = await createStorageContext({ factory: new IDBFactory(), now: () => 1000 })
    const runtime = createApplicationRuntime({ getContext: async () => context, now: () => 1000 })
    const workspaceService = await runtime.getWorkspaceService()
    const active = await workspaceService.getActive()
    const workspaceId = active.workspace.id
    await context.repositories.workspaces.save({
      ...active.workspace,
      storageMode: 'local-library',
      updatedAt: 1100
    })
    const legacyId = `local-recent-document:${workspaceId}`
    await context.repositories.documents.save({
      id: legacyId,
      workspaceId,
      name: 'legacy.md',
      content: 'legacy Phase 2B body',
      docType: 'markdown',
      sourceKind: 'local',
      createdAt: 900,
      updatedAt: 950
    })
    await context.repositories.documentSelection.deleteActiveDocumentId(workspaceId)

    const result = await (await runtime.getDocumentService()).resolveActive({
      ...active.workspace,
      storageMode: 'local-library',
      updatedAt: 1100
    })

    expect(result.document).toMatchObject({ id: legacyId, content: 'legacy Phase 2B body' })
    expect(result.summaries).toHaveLength(1)
    expect(result.summaries[0]).toMatchObject({ id: legacyId, active: true })
    await expect(context.repositories.documentSelection.getActiveDocumentId(workspaceId)).resolves.toBe(legacyId)
  })
})
