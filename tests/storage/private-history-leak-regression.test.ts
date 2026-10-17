import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createDefaultWorkspaceState } from '../../src/core/workspace/defaults'
import type { EditableDocument } from '../../src/document/types'
import { createSessionDocumentLibraryStore } from '../../src/document/session-document-library'
import { createSessionSnapshotStore } from '../../src/document/session-snapshot-store'
import { createDocumentService } from '../../src/document/document-service'
import { createStorageContext } from '../../src/storage/bootstrap'
import { createMemoryStorageContext } from '../../src/storage/repositories/memory'

function editable(id: string, workspaceId: string, content: string): EditableDocument {
  return {
    id,
    workspaceId,
    name: `${id}.md`,
    docType: 'markdown',
    content,
    sourceKind: 'local',
    createdAt: 1,
    updatedAt: 1
  }
}

afterEach(() => {
  vi.resetModules()
})

describe('history lifecycle privacy boundaries', () => {
  test('Memory adapter cascades snapshots for deleted/replaced documents and private transition without touching another workspace', async () => {
    const memory = createMemoryStorageContext(() => 100)
    const a = createDefaultWorkspaceState(1)
    a.workspace.id = 'wa'
    a.workspace.activeRuleProfileId = 'pa'
    a.workspace.storageMode = 'local-library'
    a.profile.id = 'pa'
    const b = createDefaultWorkspaceState(2)
    b.workspace.id = 'wb'
    b.workspace.activeRuleProfileId = 'pb'
    b.workspace.storageMode = 'local-library'
    b.profile.id = 'pb'
    await memory.repositories.preferences.save(a.preferences)
    await memory.atomicOperations.createWorkspaceAndActivate(a.workspace, a.profile)
    await memory.atomicOperations.createWorkspaceAndActivate(b.workspace, b.profile)

    await memory.repositories.documents.save({ ...editable('a1', 'wa', 'A1') })
    await memory.repositories.documents.save({ ...editable('a2', 'wa', 'A2') })
    await memory.repositories.documents.save({ ...editable('b1', 'wb', 'B1') })
    await memory.atomicOperations.captureSnapshot({ id: 'sa1', documentId: 'a1', content: 'old A1', reason: 'manual', createdAt: 1, maxSnapshots: 20 })
    await memory.atomicOperations.captureSnapshot({ id: 'sa2', documentId: 'a2', content: 'old A2', reason: 'manual', createdAt: 2, maxSnapshots: 20 })
    await memory.atomicOperations.captureSnapshot({ id: 'sb1', documentId: 'b1', content: 'old B1', reason: 'manual', createdAt: 3, maxSnapshots: 20 })

    await memory.atomicOperations.deleteDocumentAndSelectNext('wa', 'a1', 'a2')
    expect(await memory.repositories.snapshots.listByDocument('a1')).toEqual([])
    expect(await memory.repositories.snapshots.listByDocument('a2')).toHaveLength(1)
    expect(await memory.repositories.snapshots.listByDocument('b1')).toHaveLength(1)

    await memory.atomicOperations.replaceLastDocument('wa', 'a2', { ...editable('a3', 'wa', 'A3') })
    expect(await memory.repositories.snapshots.listByDocument('a2')).toEqual([])
    expect(await memory.repositories.snapshots.listByDocument('b1')).toHaveLength(1)

    await memory.atomicOperations.captureSnapshot({ id: 'sa3', documentId: 'a3', content: 'old A3', reason: 'manual', createdAt: 4, maxSnapshots: 20 })
    await memory.atomicOperations.makeWorkspacePrivate('wa')
    expect(await memory.repositories.snapshots.listByDocument('a3')).toEqual([])
    expect(await memory.repositories.snapshots.listByDocument('b1')).toHaveLength(1)
  })

  test('Private document delete clears only the deleted document history including last-document replacement', async () => {
    const memory = createMemoryStorageContext()
    const sessionLibrary = createSessionDocumentLibraryStore()
    const sessionSnapshots = createSessionSnapshotStore()
    const state = createDefaultWorkspaceState(1)
    state.workspace.id = 'w1'
    state.workspace.activeRuleProfileId = 'p1'
    state.profile.id = 'p1'
    await memory.repositories.preferences.save(state.preferences)
    await memory.atomicOperations.createWorkspaceAndActivate(state.workspace, state.profile)

    let nextId = 0
    const service = createDocumentService({
      repositories: memory.repositories,
      atomic: memory.atomicOperations,
      sessionLibrary,
      sessionSnapshots,
      now: () => 10,
      generateId: () => `d${++nextId}`
    })
    const first = await service.create(state.workspace, { name: 'first.md', content: 'first' })
    const second = await service.create(state.workspace, { name: 'second.md', content: 'second' })
    if (!('id' in first.document) || !('id' in second.document)) throw new Error('expected editable documents')
    sessionSnapshots.capture({ id: 's-first', documentId: first.document.id, content: 'first old', reason: 'manual', createdAt: 1, maxSnapshots: 20 })
    sessionSnapshots.capture({ id: 's-second', documentId: second.document.id, content: 'second old', reason: 'manual', createdAt: 2, maxSnapshots: 20 })

    await service.delete(state.workspace, first.document.id)
    expect(sessionSnapshots.list(first.document.id)).toEqual([])
    expect(sessionSnapshots.list(second.document.id)).toHaveLength(1)

    const replaced = await service.delete(state.workspace, second.document.id)
    expect(sessionSnapshots.list(second.document.id)).toEqual([])
    expect('id' in replaced.document).toBe(true)
  })

  test('Private to Local starts a new Local history and Local to Private scrubs durable history without importing it', async () => {
    const context = await createStorageContext({ factory: new IDBFactory(), now: () => 100 })
    vi.resetModules()
    const [{ appState }, { createApplicationRuntime }, { createWorkspaceController }] = await Promise.all([
      import('../../src/state/app-state'),
      import('../../src/state/application-runtime'),
      import('../../src/state/workspace-controller')
    ])
    const runtime = createApplicationRuntime({ getContext: async () => context, now: () => 100 })
    const controller = createWorkspaceController({ runtime, now: () => 100 })
    await controller.bootstrap()
    await controller.setSnapshotPolicy({ enabled: true, maxSnapshots: 20 })

    const workspaceId = appState.activeWorkspaceId()!
    const documentId = appState.activeDocumentId()!
    const privateWorkspace = (await (await runtime.getWorkspaceService()).getActive()).workspace
    const privateDocument = (await runtime.getDocumentService()).resolveActive(privateWorkspace).then((value) => value.document)
    const resolvedPrivate = await privateDocument
    if (!('id' in resolvedPrivate)) throw new Error('expected private document')
    await (await runtime.getSnapshotService()).capture(privateWorkspace, resolvedPrivate, 'manual')
    expect(runtime.getSessionSnapshotStore().list(documentId)).toHaveLength(1)

    await controller.setStorageMode('local-library')
    expect(runtime.getSessionSnapshotStore().list(documentId)).toEqual([])
    expect(await context.repositories.snapshots.listByDocument(documentId)).toEqual([])

    const localWorkspace = (await (await runtime.getWorkspaceService()).getActive()).workspace
    const localDocument = (await runtime.getDocumentService()).resolveActive(localWorkspace).then((value) => value.document)
    const resolvedLocal = await localDocument
    if (!('id' in resolvedLocal)) throw new Error('expected local document')
    await (await runtime.getSnapshotService()).capture(localWorkspace, resolvedLocal, 'manual')
    expect(await context.repositories.snapshots.listByDocument(documentId)).toHaveLength(1)

    await controller.setStorageMode('private-session')
    expect(await context.repositories.snapshots.listByDocument(documentId)).toEqual([])
    expect(runtime.getSessionSnapshotStore().list(documentId)).toEqual([])
  })

  test('Private workspace deletion clears its history only after successful delete and keeps history when delete is rejected', async () => {
    const context = await createStorageContext({ factory: new IDBFactory(), now: () => 200 })
    vi.resetModules()
    const [{ appState }, { createApplicationRuntime }, { createWorkspaceController }] = await Promise.all([
      import('../../src/state/app-state'),
      import('../../src/state/application-runtime'),
      import('../../src/state/workspace-controller')
    ])
    const runtime = createApplicationRuntime({ getContext: async () => context, now: () => 200 })
    const controller = createWorkspaceController({ runtime, now: () => 200 })
    await controller.bootstrap()
    await controller.setSnapshotPolicy({ enabled: true, maxSnapshots: 20 })

    const firstWorkspaceId = appState.activeWorkspaceId()!
    const firstDocumentId = appState.activeDocumentId()!
    const firstWorkspace = (await (await runtime.getWorkspaceService()).getActive()).workspace
    const firstDoc = (await runtime.getDocumentService()).resolveActive(firstWorkspace).then((value) => value.document)
    const firstResolved = await firstDoc
    if (!('id' in firstResolved)) throw new Error('expected document')
    await (await runtime.getSnapshotService()).capture(firstWorkspace, firstResolved, 'manual')

    await expect(controller.deleteWorkspace(firstWorkspaceId)).rejects.toThrow('last workspace')
    expect(runtime.getSessionSnapshotStore().list(firstDocumentId)).toHaveLength(1)

    await controller.createWorkspace('Second')
    await controller.deleteWorkspace(firstWorkspaceId)
    expect(runtime.getSessionSnapshotStore().list(firstDocumentId)).toEqual([])
  })
})
