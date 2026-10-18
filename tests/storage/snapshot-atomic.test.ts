import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, test } from 'vitest'
import { createDefaultWorkspaceState } from '../../src/core/workspace/defaults'
import type { StoredWorkspaceDocument, Workspace } from '../../src/core/workspace/types'
import { createIndexedDbAtomicOperations } from '../../src/storage/db/indexeddb-atomic-operations'
import { openDatabase } from '../../src/storage/db/open-database'
import { createIndexedDbRepositories } from '../../src/storage/repositories/indexeddb'
import { createMemoryStorageContext } from '../../src/storage/repositories/memory'
import type { AtomicOperationsPort, StorageRepositories } from '../../src/storage/repositories/ports'

interface Harness {
  repositories: StorageRepositories
  atomic: AtomicOperationsPort
  close(): void
}

function workspace(id: string): Workspace {
  const base = createDefaultWorkspaceState(1).workspace
  return { ...base, id, name: id, storageMode: 'local-library', snapshotPolicy: { enabled: true, maxSnapshots: 20 } }
}

function document(id: string, workspaceId: string, content = 'current'): StoredWorkspaceDocument {
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

async function seed(harness: Harness, workspaceId = 'w1', documentId = 'd1', content = 'current') {
  const ws = workspace(workspaceId)
  await harness.repositories.workspaces.save(ws)
  await harness.repositories.documents.save(document(documentId, workspaceId, content))
  return ws
}

function defineContract(label: string, createHarness: () => Promise<Harness> | Harness): void {
  describe(`${label} snapshot atomics`, () => {
    test('capture requires an existing document, suppresses duplicates, and keeps monotonic revisions through pruning', async () => {
      const harness = await createHarness()
      await seed(harness)

      await expect(harness.atomic.captureSnapshot({
        id: 'missing', documentId: 'missing', content: 'x', reason: 'manual', createdAt: 1, maxSnapshots: 1
      })).rejects.toThrow()

      const first = await harness.atomic.captureSnapshot({
        id: 's1', documentId: 'd1', content: 'one', reason: 'manual', createdAt: 10, maxSnapshots: 1
      })
      const duplicate = await harness.atomic.captureSnapshot({
        id: 'duplicate', documentId: 'd1', content: 'one', reason: 'autosave', createdAt: 20, maxSnapshots: 1
      })
      const second = await harness.atomic.captureSnapshot({
        id: 's2', documentId: 'd1', content: 'two', reason: 'autosave', createdAt: 30, maxSnapshots: 1
      })
      const third = await harness.atomic.captureSnapshot({
        id: 's3', documentId: 'd1', content: 'three', reason: 'manual', createdAt: 40, maxSnapshots: 1
      })

      expect(first.snapshot?.revision).toBe(1)
      expect(duplicate).toEqual({ skippedDuplicate: true })
      expect(second.snapshot?.revision).toBe(2)
      expect(third.snapshot?.revision).toBe(3)
      expect((await harness.repositories.snapshots.listByDocument('d1')).map((snapshot) => snapshot.revision)).toEqual([3])
      harness.close()
    })

    test('restore rejects cross-document, cross-workspace, and missing targets without partial writes', async () => {
      const harness = await createHarness()
      await seed(harness, 'w1', 'd1', 'current-a')
      await harness.repositories.workspaces.save(workspace('w2'))
      await harness.repositories.documents.save(document('d2', 'w2', 'current-b'))
      await harness.atomic.captureSnapshot({
        id: 'target', documentId: 'd1', content: 'old-a', reason: 'manual', createdAt: 10, maxSnapshots: 10
      })

      const base = {
        currentContent: 'current-b',
        restoredUpdatedAt: 100,
        beforeRestoreSnapshotId: 'rollback',
        beforeRestoreCreatedAt: 99,
        maxSnapshots: 10
      }

      await expect(harness.atomic.restoreDocumentFromSnapshot({
        ...base, workspaceId: 'w2', documentId: 'd2', snapshotId: 'target'
      })).rejects.toThrow()
      await expect(harness.atomic.restoreDocumentFromSnapshot({
        ...base, workspaceId: 'w2', documentId: 'd1', snapshotId: 'target'
      })).rejects.toThrow()
      await expect(harness.atomic.restoreDocumentFromSnapshot({
        ...base, workspaceId: 'w1', documentId: 'd1', snapshotId: 'missing', currentContent: 'current-a'
      })).rejects.toThrow()

      expect((await harness.repositories.documents.get('d1'))?.content).toBe('current-a')
      expect((await harness.repositories.documents.get('d2'))?.content).toBe('current-b')
      expect((await harness.repositories.snapshots.listByDocument('d1')).map((snapshot) => snapshot.id)).toEqual(['target'])
      harness.close()
    })

    test('restore reads target before maxSnapshots=1 pruning and atomically saves rollback plus restored body', async () => {
      const harness = await createHarness()
      await seed(harness, 'w1', 'd1', 'current')
      await harness.atomic.captureSnapshot({
        id: 'target', documentId: 'd1', content: 'old', reason: 'manual', createdAt: 10, maxSnapshots: 1
      })

      const result = await harness.atomic.restoreDocumentFromSnapshot({
        workspaceId: 'w1',
        documentId: 'd1',
        snapshotId: 'target',
        currentContent: 'current',
        restoredUpdatedAt: 100,
        beforeRestoreSnapshotId: 'rollback',
        beforeRestoreCreatedAt: 99,
        maxSnapshots: 1
      })

      expect(result.document.content).toBe('old')
      expect(result.document.updatedAt).toBe(100)
      expect(result.rollbackSnapshot.content).toBe('current')
      expect(result.createdRollbackSnapshot).toBe(true)
      expect((await harness.repositories.documents.get('d1'))?.content).toBe('old')
      expect((await harness.repositories.snapshots.listByDocument('d1')).map((snapshot) => snapshot.id)).toEqual(['rollback'])
      harness.close()
    })

    test('restore reuses a duplicate latest checkpoint instead of creating another snapshot', async () => {
      const harness = await createHarness()
      await seed(harness, 'w1', 'd1', 'current')
      await harness.atomic.captureSnapshot({
        id: 'target', documentId: 'd1', content: 'old', reason: 'manual', createdAt: 10, maxSnapshots: 10
      })
      await harness.atomic.captureSnapshot({
        id: 'current-snapshot', documentId: 'd1', content: 'current', reason: 'manual', createdAt: 20, maxSnapshots: 10
      })

      const result = await harness.atomic.restoreDocumentFromSnapshot({
        workspaceId: 'w1', documentId: 'd1', snapshotId: 'target', currentContent: 'current',
        restoredUpdatedAt: 100, beforeRestoreSnapshotId: 'unused', beforeRestoreCreatedAt: 99, maxSnapshots: 10
      })

      expect(result.rollbackSnapshot.id).toBe('current-snapshot')
      expect(result.createdRollbackSnapshot).toBe(false)
      expect(await harness.repositories.snapshots.get('unused')).toBeUndefined()
      expect(await harness.repositories.snapshots.listByDocument('d1')).toHaveLength(2)
      harness.close()
    })
  })
}

defineContract('memory', () => {
  const context = createMemoryStorageContext(() => 100)
  return { repositories: context.repositories, atomic: context.atomicOperations, close: () => undefined }
})

defineContract('indexeddb', async () => {
  const db = await openDatabase(new IDBFactory())
  return {
    repositories: createIndexedDbRepositories(db),
    atomic: createIndexedDbAtomicOperations(db, () => 100),
    close: () => db.close()
  }
})
