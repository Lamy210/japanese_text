import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDocumentService } from '../../src/document/document-service'
import { createSessionDocumentLibraryStore } from '../../src/document/session-document-library'
import { createWorkspaceService } from '../../src/workspace/workspace-service'

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

describe('Phase 2B recent-document compatibility', () => {
  it('keeps local-recent-document as one library document when the legacy facade saves repeatedly', async () => {
    installIndexedDb(new IDBFactory())
    vi.resetModules()
    const storage = await import('../../src/storage/storage')
    const context = await storage.getStorageContext()
    const workspaceService = createWorkspaceService({
      repositories: context.repositories,
      atomic: context.atomic,
      durableBackend: context.durable
    })
    const active = await workspaceService.getActive()
    const legacyId = `local-recent-document:${active.workspace.id}`
    const initial = {
      id: legacyId,
      workspaceId: active.workspace.id,
      name: 'legacy.md',
      content: 'first',
      docType: 'markdown' as const,
      sourceKind: 'local' as const,
      createdAt: 100,
      updatedAt: 100
    }
    await workspaceService.enableLocalLibrary(active.workspace.id, [initial], legacyId)

    await storage.saveRecentDocument({
      name: 'legacy.md',
      content: 'second',
      docType: 'markdown',
      updatedAt: 200
    })
    await storage.saveRecentDocument({
      name: 'renamed.md',
      content: 'third',
      docType: 'markdown',
      updatedAt: 300
    })

    const documents = await context.repositories.documents.listByWorkspace(active.workspace.id)
    expect(documents).toHaveLength(1)
    expect(documents[0]).toMatchObject({
      id: legacyId,
      name: 'renamed.md',
      content: 'third',
      createdAt: 100,
      updatedAt: 300
    })
  })

  it('repairs missing active-document meta by choosing the newest Phase 2B-compatible record', async () => {
    installIndexedDb(new IDBFactory())
    vi.resetModules()
    const storage = await import('../../src/storage/storage')
    const context = await storage.getStorageContext()
    const workspaceService = createWorkspaceService({
      repositories: context.repositories,
      atomic: context.atomic,
      durableBackend: context.durable
    })
    const active = await workspaceService.getActive()
    const legacyId = `local-recent-document:${active.workspace.id}`
    const legacy = {
      id: legacyId,
      workspaceId: active.workspace.id,
      name: 'legacy.md',
      content: 'legacy newest body',
      docType: 'markdown' as const,
      sourceKind: 'local' as const,
      createdAt: 100,
      updatedAt: 900
    }
    await workspaceService.enableLocalLibrary(active.workspace.id, [legacy], legacyId)
    await context.repositories.documents.save({
      ...legacy,
      id: 'older-library-document',
      name: 'older.md',
      content: 'older body',
      createdAt: 200,
      updatedAt: 300
    })
    await context.repositories.documentSelection.deleteActiveDocumentId(active.workspace.id)
    const localWorkspace = (await context.repositories.workspaces.get(active.workspace.id))!
    const documentService = createDocumentService({
      repositories: context.repositories,
      atomic: context.atomic,
      sessionLibrary: createSessionDocumentLibraryStore(),
      now: () => 1000,
      generateId: () => 'unused'
    })

    const resolved = await documentService.resolveActive(localWorkspace)

    expect(resolved.document).toMatchObject({ id: legacyId, content: 'legacy newest body' })
    await expect(context.repositories.documentSelection.getActiveDocumentId(active.workspace.id)).resolves.toBe(legacyId)
  })
})