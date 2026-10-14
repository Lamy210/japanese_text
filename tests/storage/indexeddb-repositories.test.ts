import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/storage/db/open-database'
import { STORE_WORKSPACES } from '../../src/storage/db/schema'
import { transactionDone } from '../../src/storage/db/idb-utils'
import { createIndexedDbRepositories } from '../../src/storage/repositories/indexeddb'
import { WorkspaceRecordValidationError } from '../../src/core/workspace/validate'
import { defineRepositoryContract } from './repository-contract'

defineRepositoryContract('indexeddb', async () => {
  const factory = new IDBFactory()
  const db = await openDatabase(factory)
  return createIndexedDbRepositories(db)
})

describe('IndexedDB repository validation', () => {
  it('rejects a corrupt persisted workspace instead of type-asserting it', async () => {
    const factory = new IDBFactory()
    const db = await openDatabase(factory)
    const repositories = createIndexedDbRepositories(db)

    const tx = db.transaction(STORE_WORKSPACES, 'readwrite')
    const done = transactionDone(tx)
    tx.objectStore(STORE_WORKSPACES).put({ id: 'corrupt', storageMode: 'local-library' })
    await done

    await expect(repositories.workspaces.get('corrupt')).rejects.toBeInstanceOf(WorkspaceRecordValidationError)
    db.close()
  })
})
