import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createDefaultWorkspaceState } from '../../src/core/workspace/defaults'
import type { StoredWorkspaceDocument, Workspace } from '../../src/core/workspace/types'
import { createIndexedDbAtomicOperations } from '../../src/storage/db/indexeddb-atomic-operations'
import { transactionDone } from '../../src/storage/db/idb-utils'
import { openDatabase } from '../../src/storage/db/open-database'
import { STORE_DOCUMENT_SNAPSHOTS } from '../../src/storage/db/schema'
import { createIndexedDbRepositories } from '../../src/storage/repositories/indexeddb'
import { createMemoryStorageContext } from '../../src/storage/repositories/memory'
import type { AtomicOperationsPort, StorageRepositories } from '../../src/storage/repositories/ports'

interface Harness {
  repositories: StorageRepositories
  atomic: AtomicOperationsPort
  db?: IDBDatabase
}

function localWorkspace(id: string): Workspace {
  const workspace = createDefaultWorkspaceState(1000).workspace
  return { ...workspace, id, name: id, storageMode: 'local-library' }
}

function privateWorkspace(id: string): Workspace {
  const workspace = createDefaultWorkspaceState(1000).workspace
  return { ...workspace, id, name: id, storageMode: 'private-session' }
}

function doc(id: string, workspaceId: string): StoredWorkspaceDocument {
  return {
    id,
    workspaceId,
    name: `${id}.md`,
    docType: 'markdown',
    content: id,
    sourceKind: 'local',
    createdAt: 1000,
    updatedAt: 1000
  }
}

function defineAtomicContract(label: string, createHarness: () => Promise<Harness> | Harness): void {
  describe(`${label} atomic document operations`, () => {
    it('creates a Local Library document and activates it atomically', async () => {
      const { repositories, atomic } = await createHarness()
      const workspace = localWorkspace('workspace-a')
      await repositories.workspaces.save(workspace)

      await atomic.createDocumentAndActivate(doc('doc-a', workspace.id))

      expect((await repositories.documents.get('doc-a'))?.content).toBe('doc-a')
      expect(await repositories.documentSelection.getActiveDocumentId(workspace.id)).toBe('doc-a')
    })

    it('deletes an active document and selects an existing successor in the same workspace', async () => {
      const { repositories, atomic } = await createHarness()
      const workspace = localWorkspace('workspace-a')
      await repositories.workspaces.save(workspace)
      await repositories.documents.save(doc('doc-a', workspace.id))
      await repositories.documents.save(doc('doc-b', workspace.id))
      await repositories.documentSelection.setActiveDocumentId(workspace.id, 'doc-a')

      await atomic.deleteDocumentAndSelectNext(workspace.id, 'doc-a', 'doc-b')

      expect(await repositories.documents.get('doc-a')).toBeUndefined()
      expect((await repositories.documents.get('doc-b'))?.id).toBe('doc-b')
      expect(await repositories.documentSelection.getActiveDocumentId(workspace.id)).toBe('doc-b')
    })

    it('rejects a successor from another workspace without deleting the target', async () => {
      const { repositories, atomic } = await createHarness()
      const workspaceA = localWorkspace('workspace-a')
      const workspaceB = localWorkspace('workspace-b')
      await repositories.workspaces.save(workspaceA)
      await repositories.workspaces.save(workspaceB)
      await repositories.documents.save(doc('doc-a', workspaceA.id))
      await repositories.documents.save(doc('doc-b', workspaceB.id))
      await repositories.documentSelection.setActiveDocumentId(workspaceA.id, 'doc-a')

      await expect(
        atomic.deleteDocumentAndSelectNext(workspaceA.id, 'doc-a', 'doc-b')
      ).rejects.toThrow()

      expect((await repositories.documents.get('doc-a'))?.id).toBe('doc-a')
      expect(await repositories.documentSelection.getActiveDocumentId(workspaceA.id)).toBe('doc-a')
    })

    it('replaces the last document and activates the replacement', async () => {
      const { repositories, atomic } = await createHarness()
      const workspace = localWorkspace('workspace-a')
      await repositories.workspaces.save(workspace)
      await repositories.documents.save(doc('old', workspace.id))
      await repositories.documentSelection.setActiveDocumentId(workspace.id, 'old')

      await atomic.replaceLastDocument(workspace.id, 'old', doc('replacement', workspace.id))

      expect(await repositories.documents.get('old')).toBeUndefined()
      expect((await repositories.documents.get('replacement'))?.id).toBe('replacement')
      expect(await repositories.documentSelection.getActiveDocumentId(workspace.id)).toBe('replacement')
    })

    it('enables Local Library with every document and the explicit active ID', async () => {
      const { repositories, atomic } = await createHarness()
      const workspace = privateWorkspace('workspace-a')
      await repositories.workspaces.save(workspace)

      await atomic.enableLocalLibrary(
        workspace.id,
        [doc('doc-a', workspace.id), doc('doc-b', workspace.id), doc('doc-c', workspace.id)],
        'doc-b'
      )

      expect((await repositories.workspaces.get(workspace.id))?.storageMode).toBe('local-library')
      expect((await repositories.documents.listByWorkspace(workspace.id)).map((value) => value.id).sort()).toEqual([
        'doc-a',
        'doc-b',
        'doc-c'
      ])
      expect(await repositories.documentSelection.getActiveDocumentId(workspace.id)).toBe('doc-b')
    })

    it('rejects an invalid active ID during Private to Local transition without partial writes', async () => {
      const { repositories, atomic } = await createHarness()
      const workspace = privateWorkspace('workspace-a')
      await repositories.workspaces.save(workspace)

      await expect(
        atomic.enableLocalLibrary(workspace.id, [doc('doc-a', workspace.id)], 'missing')
      ).rejects.toThrow()

      expect((await repositories.workspaces.get(workspace.id))?.storageMode).toBe('private-session')
      expect(await repositories.documents.listByWorkspace(workspace.id)).toEqual([])
      expect(await repositories.documentSelection.getActiveDocumentId(workspace.id)).toBeUndefined()
    })

    it('making a workspace private scrubs its documents and active document selection only', async () => {
      const { repositories, atomic } = await createHarness()
      const workspaceA = localWorkspace('workspace-a')
      const workspaceB = localWorkspace('workspace-b')
      await repositories.workspaces.save(workspaceA)
      await repositories.workspaces.save(workspaceB)
      await repositories.documents.save(doc('doc-a', workspaceA.id))
      await repositories.documents.save(doc('doc-b', workspaceB.id))
      await repositories.documentSelection.setActiveDocumentId(workspaceA.id, 'doc-a')
      await repositories.documentSelection.setActiveDocumentId(workspaceB.id, 'doc-b')

      await atomic.makeWorkspacePrivate(workspaceA.id)

      expect((await repositories.workspaces.get(workspaceA.id))?.storageMode).toBe('private-session')
      expect(await repositories.documents.get('doc-a')).toBeUndefined()
      expect(await repositories.documentSelection.getActiveDocumentId(workspaceA.id)).toBeUndefined()
      expect((await repositories.documents.get('doc-b'))?.id).toBe('doc-b')
      expect(await repositories.documentSelection.getActiveDocumentId(workspaceB.id)).toBe('doc-b')
    })

    it('workspace deletion removes only the deleted workspace active document selection', async () => {
      const { repositories, atomic } = await createHarness()
      const workspaceA = localWorkspace('workspace-a')
      const workspaceB = localWorkspace('workspace-b')
      await repositories.workspaces.save(workspaceA)
      await repositories.workspaces.save(workspaceB)
      await repositories.documentSelection.setActiveDocumentId(workspaceA.id, 'doc-a')
      await repositories.documentSelection.setActiveDocumentId(workspaceB.id, 'doc-b')

      await atomic.deleteWorkspaceCascade(workspaceA.id)

      expect(await repositories.documentSelection.getActiveDocumentId(workspaceA.id)).toBeUndefined()
      expect(await repositories.documentSelection.getActiveDocumentId(workspaceB.id)).toBe('doc-b')
    })
  })
}

defineAtomicContract('memory', () => {
  const context = createMemoryStorageContext(() => 2000)
  return { repositories: context.repositories, atomic: context.atomicOperations }
})

defineAtomicContract('indexeddb', async () => {
  const db = await openDatabase(new IDBFactory())
  return {
    repositories: createIndexedDbRepositories(db),
    atomic: createIndexedDbAtomicOperations(db, () => 2000),
    db
  }
})

describe('IndexedDB snapshot cascade', () => {
  it('deleting a document removes snapshots for that document but not its successor', async () => {
    const db = await openDatabase(new IDBFactory())
    const repositories = createIndexedDbRepositories(db)
    const atomic = createIndexedDbAtomicOperations(db, () => 2000)
    const workspace = localWorkspace('workspace-a')
    await repositories.workspaces.save(workspace)
    await repositories.documents.save(doc('doc-a', workspace.id))
    await repositories.documents.save(doc('doc-b', workspace.id))
    await repositories.documentSelection.setActiveDocumentId(workspace.id, 'doc-a')

    const tx = db.transaction(STORE_DOCUMENT_SNAPSHOTS, 'readwrite')
    const done = transactionDone(tx)
    const store = tx.objectStore(STORE_DOCUMENT_SNAPSHOTS)
    store.put({ id: 'snap-a', documentId: 'doc-a', revision: 1, content: 'A', reason: 'manual', createdAt: 1000 })
    store.put({ id: 'snap-b', documentId: 'doc-b', revision: 1, content: 'B', reason: 'manual', createdAt: 1000 })
    await done

    await atomic.deleteDocumentAndSelectNext(workspace.id, 'doc-a', 'doc-b')

    const readTx = db.transaction(STORE_DOCUMENT_SNAPSHOTS, 'readonly')
    const readDone = transactionDone(readTx)
    const snapshots = await new Promise<unknown[]>((resolve, reject) => {
      const request = readTx.objectStore(STORE_DOCUMENT_SNAPSHOTS).getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await readDone

    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]).toMatchObject({ id: 'snap-b', documentId: 'doc-b' })
    db.close()
  })
})
