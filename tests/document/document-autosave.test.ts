import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StoredWorkspaceDocument } from '../../src/core/workspace/types'

function installIndexedDb(factory: IDBFactory): void {
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    writable: true,
    value: factory
  })
}

function storedDocument(
  workspaceId: string,
  id: string,
  content: string,
  updatedAt: number
): StoredWorkspaceDocument {
  return {
    id,
    workspaceId,
    name: `${id}.md`,
    content,
    docType: 'markdown',
    sourceKind: 'local',
    createdAt: 10,
    updatedAt
  }
}

async function localHarness() {
  const factory = new IDBFactory()
  installIndexedDb(factory)
  vi.resetModules()

  const [storage, actions, { appState }] = await Promise.all([
    import('../../src/storage/storage'),
    import('../../src/state/actions'),
    import('../../src/state/app-state')
  ])
  const context = await storage.getStorageContext()
  const workspaces = await context.repositories.workspaces.list()
  const workspace = workspaces[0]!
  const first = storedDocument(workspace.id, 'document-a', 'A0', 10)
  const second = storedDocument(workspace.id, 'document-b', 'B0', 20)
  await context.atomic.enableLocalLibrary(workspace.id, [first, second], first.id)

  appState.setActiveWorkspaceId(workspace.id)
  appState.setDocumentSummaries([
    { ...first, content: undefined, active: true } as never,
    { ...second, content: undefined, active: false } as never
  ])
  appState.setActiveDocumentId(first.id)
  appState.setDocument(first.content!, first.name, first.docType)

  return { actions, appState, context, workspace, first, second }
}

async function settleDetachedPersistence(): Promise<void> {
  vi.useRealTimers()
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

async function waitForDocumentContent(
  context: Awaited<ReturnType<typeof import('../../src/storage/storage')['getStorageContext']>>,
  documentId: string,
  expectedContent: string
): Promise<void> {
  vi.useRealTimers()
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const document = await context.repositories.documents.get(documentId)
    if (document?.content === expectedContent) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

afterEach(() => {
  vi.useRealTimers()
  Reflect.deleteProperty(globalThis, 'indexedDB')
  vi.resetModules()
})

describe('explicit document autosave', () => {
  it('captures workspaceId, documentId, and payload so later navigation cannot redirect the save', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { actions, appState, context, workspace, first, second } = await localHarness()

    actions.persistDocumentDebounced({
      workspaceId: workspace.id,
      documentId: first.id,
      name: first.name,
      content: 'A captured',
      docType: first.docType,
      sourceKind: first.sourceKind,
      createdAt: first.createdAt,
      updatedAt: 100
    })

    appState.setActiveDocumentId(second.id)
    appState.setDocument('B current', second.name, second.docType)
    await context.repositories.documentSelection.setActiveDocumentId(workspace.id, second.id)

    await vi.advanceTimersByTimeAsync(800)
    await waitForDocumentContent(context, first.id, 'A captured')

    await expect(context.repositories.documents.get(first.id)).resolves.toMatchObject({
      id: first.id,
      content: 'A captured',
      updatedAt: 100
    })
    await expect(context.repositories.documents.get(second.id)).resolves.toMatchObject({
      id: second.id,
      content: 'B0',
      updatedAt: 20
    })
  })

  it('coalesces repeated saves and persists only the latest captured payload', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { actions, context, workspace, first } = await localHarness()

    actions.persistDocumentDebounced({
      workspaceId: workspace.id,
      documentId: first.id,
      name: first.name,
      content: 'A1',
      docType: first.docType,
      sourceKind: first.sourceKind,
      createdAt: first.createdAt,
      updatedAt: 101
    })
    actions.persistDocumentDebounced({
      workspaceId: workspace.id,
      documentId: first.id,
      name: first.name,
      content: 'A2',
      docType: first.docType,
      sourceKind: first.sourceKind,
      createdAt: first.createdAt,
      updatedAt: 102
    })

    await vi.advanceTimersByTimeAsync(800)
    await waitForDocumentContent(context, first.id, 'A2')

    await expect(context.repositories.documents.get(first.id)).resolves.toMatchObject({
      content: 'A2',
      updatedAt: 102
    })
  })

  it('cancels a pending save before navigation or deletion can let it fire', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { actions, context, workspace, first } = await localHarness()

    actions.persistDocumentDebounced({
      workspaceId: workspace.id,
      documentId: first.id,
      name: first.name,
      content: 'must not persist',
      docType: first.docType,
      sourceKind: first.sourceKind,
      createdAt: first.createdAt,
      updatedAt: 103
    })
    actions.cancelPendingDocumentPersistence()

    await vi.advanceTimersByTimeAsync(800)
    await settleDetachedPersistence()

    await expect(context.repositories.documents.get(first.id)).resolves.toMatchObject({ content: 'A0' })
  })

  it('does not persist document bodies for a private-session workspace', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const factory = new IDBFactory()
    installIndexedDb(factory)
    vi.resetModules()
    const [storage, actions] = await Promise.all([
      import('../../src/storage/storage'),
      import('../../src/state/actions')
    ])
    const context = await storage.getStorageContext()
    const workspace = (await context.repositories.workspaces.list())[0]!

    actions.persistDocumentDebounced({
      workspaceId: workspace.id,
      documentId: 'private-document',
      name: 'private.md',
      content: 'secret',
      docType: 'markdown',
      sourceKind: 'local',
      createdAt: 1,
      updatedAt: 2
    })

    await vi.advanceTimersByTimeAsync(800)
    await settleDetachedPersistence()

    await expect(context.repositories.documents.listByWorkspace(workspace.id)).resolves.toEqual([])
  })

  it('does not resurrect a document that was deleted before the timer fires', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { actions, context, workspace, first, second } = await localHarness()

    actions.persistDocumentDebounced({
      workspaceId: workspace.id,
      documentId: first.id,
      name: first.name,
      content: 'stale body',
      docType: first.docType,
      sourceKind: first.sourceKind,
      createdAt: first.createdAt,
      updatedAt: 104
    })
    await context.atomic.deleteDocumentAndSelectNext(workspace.id, first.id, second.id)

    await vi.advanceTimersByTimeAsync(800)
    await settleDetachedPersistence()

    await expect(context.repositories.documents.get(first.id)).resolves.toBeUndefined()
    await expect(context.repositories.documents.get(second.id)).resolves.toMatchObject({ content: 'B0' })
  })
})
