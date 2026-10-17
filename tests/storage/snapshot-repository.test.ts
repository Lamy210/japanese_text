import { beforeEach, describe, expect, test } from 'vitest'
import 'fake-indexeddb/auto'
import { createIndexedDbRepositories } from '../../src/storage/repositories/indexeddb'
import { openWorkspaceDatabase } from '../../src/storage/db/open-database'
import { validateDocumentSnapshotRecord } from '../../src/core/workspace/validate'

describe('snapshot repository', () => {
  beforeEach(async () => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase('japanese-writing-toolkit')
      request.onsuccess = () => resolve()
      request.onerror = () => resolve()
      request.onblocked = () => resolve()
    })
  })

  test('accepts before-restore and rejects invalid snapshot records', () => {
    expect(validateDocumentSnapshotRecord({
      id: 's1',
      documentId: 'd1',
      revision: 1,
      content: 'before',
      reason: 'before-restore',
      createdAt: 10
    }).reason).toBe('before-restore')

    expect(() => validateDocumentSnapshotRecord({
      id: '', documentId: 'd1', revision: 1, content: '', reason: 'manual', createdAt: 1
    })).toThrow()
    expect(() => validateDocumentSnapshotRecord({
      id: 's1', documentId: '', revision: 1, content: '', reason: 'manual', createdAt: 1
    })).toThrow()
    expect(() => validateDocumentSnapshotRecord({
      id: 's1', documentId: 'd1', revision: 0, content: '', reason: 'manual', createdAt: 1
    })).toThrow()
    expect(() => validateDocumentSnapshotRecord({
      id: 's1', documentId: 'd1', revision: 1, content: '', reason: 'invalid', createdAt: 1
    })).toThrow()
  })

  test('lists one document in deterministic newest-first order and validates reads', async () => {
    const db = await openWorkspaceDatabase()
    const tx = db.transaction('documentSnapshots', 'readwrite')
    const store = tx.objectStore('documentSnapshots')
    store.put({ id: 's1', documentId: 'd1', revision: 1, content: 'one', reason: 'manual', createdAt: 10 })
    store.put({ id: 's2', documentId: 'd1', revision: 2, content: 'two', reason: 'autosave', createdAt: 20 })
    store.put({ id: 's3', documentId: 'd1', revision: 3, content: 'three', reason: 'manual', createdAt: 20 })
    store.put({ id: 'other', documentId: 'd2', revision: 1, content: 'other', reason: 'manual', createdAt: 30 })
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })

    const repositories = createIndexedDbRepositories(db)
    expect((await repositories.snapshots.listByDocument('d1')).map((snapshot) => snapshot.id)).toEqual(['s3', 's2', 's1'])
    expect((await repositories.snapshots.get('s2'))?.content).toBe('two')
    expect(await repositories.snapshots.get('missing')).toBeUndefined()

    const corrupt = db.transaction('documentSnapshots', 'readwrite')
    corrupt.objectStore('documentSnapshots').put({ id: 'bad', documentId: 'd1', revision: 0, content: '', reason: 'manual', createdAt: 40 })
    await new Promise<void>((resolve, reject) => {
      corrupt.oncomplete = () => resolve()
      corrupt.onerror = () => reject(corrupt.error)
      corrupt.onabort = () => reject(corrupt.error)
    })
    await expect(repositories.snapshots.get('bad')).rejects.toThrow()
    db.close()
  })
})
