import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createDefaultWorkspaceState } from '../../src/core/workspace/defaults'
import type { StoredWorkspaceDocument } from '../../src/core/workspace/types'
import { createIndexedDbAtomicOperations } from '../../src/storage/db/indexeddb-atomic-operations'
import { transactionDone } from '../../src/storage/db/idb-utils'
import { openDatabase } from '../../src/storage/db/open-database'
import { STORE_DOCUMENT_SNAPSHOTS } from '../../src/storage/db/schema'
import { createIndexedDbRepositories } from '../../src/storage/repositories/indexeddb'

function document(id: string, workspaceId: string, content: string): StoredWorkspaceDocument {
  return {
    id,
    workspaceId,
    name: `${id}.md`,
    content,
    docType: 'markdown',
    sourceKind: 'local',
    createdAt: 1,
    updatedAt: 1
  }
}

describe('IndexedDB Private to Local canonical replacement', () => {
  it('scrubs stale target Workspace documents and snapshots before committing the session snapshot', async () => {
    const db = await openDatabase(new IDBFactory())
    try {
      const repositories = createIndexedDbRepositories(db)
      const atomic = createIndexedDbAtomicOperations(db, () => 5000)
      const state = createDefaultWorkspaceState(100)
      await repositories.workspaces.save(state.workspace)

      // Simulate residue from an older bug/corrupt Private state. Transition must not re-expose it.
      const stale = document('stale-private-body', state.workspace.id, 'must disappear')
      await repositories.documents.save(stale)
      await repositories.documentSelection.setActiveDocumentId(state.workspace.id, stale.id)
      const snapshotTx = db.transaction(STORE_DOCUMENT_SNAPSHOTS, 'readwrite')
      const snapshotDone = transactionDone(snapshotTx)
      snapshotTx.objectStore(STORE_DOCUMENT_SNAPSHOTS).put({
        id: 'stale-snapshot',
        documentId: stale.id,
        revision: 1,
        content: 'stale history',
        reason: 'manual',
        createdAt: 1
      })
      await snapshotDone

      const freshA = document('fresh-a', state.workspace.id, 'A')
      const freshB = document('fresh-b', state.workspace.id, 'B')
      await atomic.enableLocalLibrary(state.workspace.id, [freshA, freshB], freshB.id)

      expect((await repositories.documents.listByWorkspace(state.workspace.id)).map((value) => value.id).sort()).toEqual([
        freshA.id,
        freshB.id
      ])
      await expect(repositories.documentSelection.getActiveDocumentId(state.workspace.id)).resolves.toBe(freshB.id)

      const readTx = db.transaction(STORE_DOCUMENT_SNAPSHOTS, 'readonly')
      const readDone = transactionDone(readTx)
      const snapshots = await new Promise<unknown[]>((resolve, reject) => {
        const request = readTx.objectStore(STORE_DOCUMENT_SNAPSHOTS).getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      await readDone
      expect(snapshots).toEqual([])
    } finally {
      db.close()
    }
  })
})