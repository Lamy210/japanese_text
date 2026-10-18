import { describe, expect, test } from 'vitest'
import { createSessionSnapshotStore } from '../../src/document/session-snapshot-store'
import type { EditableDocument } from '../../src/document/types'

function document(id: string, content = 'current', workspaceId = 'w1'): EditableDocument {
  return {
    id,
    workspaceId,
    name: `${id}.md`,
    docType: 'markdown',
    content,
    sourceKind: 'local',
    createdAt: 1,
    updatedAt: 10
  }
}

describe('SessionSnapshotStore', () => {
  test('assigns monotonic per-document revisions, suppresses duplicates, and prunes oldest', () => {
    const store = createSessionSnapshotStore()

    const first = store.capture({
      id: 's1', documentId: 'd1', content: 'one', reason: 'manual', createdAt: 10, maxSnapshots: 2
    })
    const duplicate = store.capture({
      id: 'duplicate', documentId: 'd1', content: 'one', reason: 'autosave', createdAt: 20, maxSnapshots: 2
    })
    const second = store.capture({
      id: 's2', documentId: 'd1', content: 'two', reason: 'autosave', createdAt: 30, maxSnapshots: 2
    })
    const third = store.capture({
      id: 's3', documentId: 'd1', content: 'three', reason: 'manual', createdAt: 40, maxSnapshots: 2
    })

    expect(first.snapshot?.revision).toBe(1)
    expect(duplicate).toEqual({ skippedDuplicate: true })
    expect(second.snapshot?.revision).toBe(2)
    expect(third.snapshot?.revision).toBe(3)
    expect(store.list('d1').map((snapshot) => [snapshot.id, snapshot.revision])).toEqual([
      ['s3', 3],
      ['s2', 2]
    ])

    const fourth = store.capture({
      id: 's4', documentId: 'd1', content: 'four', reason: 'manual', createdAt: 50, maxSnapshots: 1
    })
    expect(fourth.snapshot?.revision).toBe(4)
    expect(store.list('d1').map((snapshot) => snapshot.revision)).toEqual([4])
  })

  test('restores atomically with maxSnapshots=1 after reading target and creates rollback checkpoint', () => {
    const store = createSessionSnapshotStore()
    store.capture({
      id: 'target', documentId: 'd1', content: 'old', reason: 'manual', createdAt: 10, maxSnapshots: 3
    })

    const result = store.restore({
      workspaceId: 'w1',
      documentId: 'd1',
      snapshotId: 'target',
      currentContent: 'current',
      restoredUpdatedAt: 100,
      beforeRestoreSnapshotId: 'rollback',
      beforeRestoreCreatedAt: 99,
      maxSnapshots: 1
    }, document('d1'))

    expect(result.document.content).toBe('old')
    expect(result.document.updatedAt).toBe(100)
    expect(result.rollbackSnapshot.content).toBe('current')
    expect(result.rollbackSnapshot.reason).toBe('before-restore')
    expect(result.createdRollbackSnapshot).toBe(true)
    expect(result.noOp).toBe(false)
    expect(store.list('d1').map((snapshot) => snapshot.id)).toEqual(['rollback'])
  })

  test('reuses latest snapshot as rollback and treats restoring identical body as no-op', () => {
    const store = createSessionSnapshotStore()
    store.capture({
      id: 'old', documentId: 'd1', content: 'old', reason: 'manual', createdAt: 10, maxSnapshots: 5
    })
    store.capture({
      id: 'current-snapshot', documentId: 'd1', content: 'current', reason: 'manual', createdAt: 20, maxSnapshots: 5
    })

    const restored = store.restore({
      workspaceId: 'w1', documentId: 'd1', snapshotId: 'old', currentContent: 'current',
      restoredUpdatedAt: 100, beforeRestoreSnapshotId: 'unused', beforeRestoreCreatedAt: 99, maxSnapshots: 5
    }, document('d1'))
    expect(restored.rollbackSnapshot.id).toBe('current-snapshot')
    expect(restored.createdRollbackSnapshot).toBe(false)
    expect(store.list('d1')).toHaveLength(2)

    const noOp = store.restore({
      workspaceId: 'w1', documentId: 'd1', snapshotId: 'old', currentContent: 'old',
      restoredUpdatedAt: 200, beforeRestoreSnapshotId: 'unused-2', beforeRestoreCreatedAt: 199, maxSnapshots: 5
    }, { ...restored.document, content: 'old', updatedAt: 100 })
    expect(noOp.noOp).toBe(true)
    expect(noOp.document.updatedAt).toBe(100)
    expect(store.list('d1')).toHaveLength(2)
  })

  test('isolates deletion and returns clones', () => {
    const store = createSessionSnapshotStore()
    store.capture({ id: 'a', documentId: 'd1', content: 'a', reason: 'manual', createdAt: 1, maxSnapshots: 5 })
    store.capture({ id: 'b', documentId: 'd2', content: 'b', reason: 'manual', createdAt: 2, maxSnapshots: 5 })
    store.capture({ id: 'c', documentId: 'd3', content: 'c', reason: 'manual', createdAt: 3, maxSnapshots: 5 })

    const read = store.get('a')!
    read.content = 'mutated'
    expect(store.get('a')?.content).toBe('a')

    store.deleteDocument('d1')
    expect(store.get('a')).toBeUndefined()
    expect(store.get('b')?.content).toBe('b')

    store.deleteDocuments(['d2'])
    expect(store.get('b')).toBeUndefined()
    expect(store.get('c')?.content).toBe('c')

    store.clear()
    expect(store.list('d3')).toEqual([])
  })
})
