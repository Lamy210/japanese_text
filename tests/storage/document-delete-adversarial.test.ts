import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createDefaultWorkspaceState } from '../../src/core/workspace/defaults'
import type { StoredWorkspaceDocument, Workspace } from '../../src/core/workspace/types'
import { createIndexedDbAtomicOperations } from '../../src/storage/db/indexeddb-atomic-operations'
import { transactionDone } from '../../src/storage/db/idb-utils'
import { openDatabase } from '../../src/storage/db/open-database'
import { STORE_DOCUMENT_SNAPSHOTS } from '../../src/storage/db/schema'
import { createIndexedDbRepositories } from '../../src/storage/repositories/indexeddb'

function localWorkspace(id: string, createdAt: number): Workspace {
  return {
    ...createDefaultWorkspaceState(createdAt).workspace,
    id,
    name: id,
    storageMode: 'local-library'
  }
}

function document(id: string, workspaceId: string, createdAt: number): StoredWorkspaceDocument {
  return {
    id,
    workspaceId,
    name: `${id}.md`,
    content: id,
    docType: 'markdown',
    sourceKind: 'local',
    createdAt,
    updatedAt: createdAt
  }
}

describe('adversarial document deletion isolation', () => {
  it('handles active, non-active, and last deletion while preserving another Workspace and its snapshots', async () => {
    const db = await openDatabase(new IDBFactory())
    try {
      const repositories = createIndexedDbRepositories(db)
      const atomic = createIndexedDbAtomicOperations(db, () => 9000)
      const workspaceA = localWorkspace('workspace-a', 100)
      const workspaceB = localWorkspace('workspace-b', 200)
      await repositories.workspaces.save(workspaceA)
      await repositories.workspaces.save(workspaceB)

      const a1 = document('a1', workspaceA.id, 1)
      const a2 = document('a2', workspaceA.id, 2)
      const a3 = document('a3', workspaceA.id, 3)
      const b1 = document('b1', workspaceB.id, 4)
      for (const value of [a1, a2, a3, b1]) await repositories.documents.save(value)
      await repositories.documentSelection.setActiveDocumentId(workspaceA.id, a2.id)
      await repositories.documentSelection.setActiveDocumentId(workspaceB.id, b1.id)

      const seedTx = db.transaction(STORE_DOCUMENT_SNAPSHOTS, 'readwrite')
      const seedDone = transactionDone(seedTx)
      const snapshots = seedTx.objectStore(STORE_DOCUMENT_SNAPSHOTS)
      for (const value of [a1, a2, a3, b1]) {
        snapshots.put({
          id: `snapshot-${value.id}`,
          documentId: value.id,
          revision: 1,
          content: `old-${value.id}`,
          reason: 'manual',
          createdAt: value.createdAt
        })
      }
      await seedDone

      // Active deletion chooses A3.
      await atomic.deleteDocumentAndSelectNext(workspaceA.id, a2.id, a3.id)
      expect(await repositories.documentSelection.getActiveDocumentId(workspaceA.id)).toBe(a3.id)

      // Non-active deletion keeps A3 selected.
      await atomic.deleteDocumentAndSelectNext(workspaceA.id, a1.id, a3.id)
      expect(await repositories.documentSelection.getActiveDocumentId(workspaceA.id)).toBe(a3.id)

      // Last-document deletion is represented by an atomic replacement.
      const replacement = document('replacement', workspaceA.id, 5)
      replacement.name = 'untitled.md'
      replacement.content = ''
      await atomic.replaceLastDocument(workspaceA.id, a3.id, replacement)

      expect((await repositories.documents.listByWorkspace(workspaceA.id)).map((value) => value.id)).toEqual([
        replacement.id
      ])
      expect(await repositories.documentSelection.getActiveDocumentId(workspaceA.id)).toBe(replacement.id)
      await expect(repositories.documents.get(b1.id)).resolves.toMatchObject({ id: b1.id, content: b1.id })
      await expect(repositories.documentSelection.getActiveDocumentId(workspaceB.id)).resolves.toBe(b1.id)

      const readTx = db.transaction(STORE_DOCUMENT_SNAPSHOTS, 'readonly')
      const readDone = transactionDone(readTx)
      const remainingSnapshots = await new Promise<Array<{ id: string; documentId: string }>>((resolve, reject) => {
        const request = readTx.objectStore(STORE_DOCUMENT_SNAPSHOTS).getAll()
        request.onsuccess = () => resolve(request.result as Array<{ id: string; documentId: string }>)
        request.onerror = () => reject(request.error)
      })
      await readDone

      expect(remainingSnapshots).toEqual([
        expect.objectContaining({ id: 'snapshot-b1', documentId: b1.id })
      ])
    } finally {
      db.close()
    }
  })
})