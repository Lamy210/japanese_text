import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createDefaultWorkspaceState } from '../../src/core/workspace/defaults'
import { createIndexedDbAtomicOperations } from '../../src/storage/db/indexeddb-atomic-operations'
import { requestToPromise, transactionDone } from '../../src/storage/db/idb-utils'
import { MIGRATED_WORKSPACE_ID } from '../../src/storage/db/migration-v1-v2'
import { openDatabase } from '../../src/storage/db/open-database'
import { DB_NAME, LEGACY_DOCUMENTS_STORE } from '../../src/storage/db/schema'
import { createIndexedDbRepositories } from '../../src/storage/repositories/indexeddb'

async function createLegacyDatabase(factory: IDBFactory): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('settings')
      request.result.createObjectStore(LEGACY_DOCUMENTS_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('legacy open failed'))
  })
  try {
    const tx = db.transaction(LEGACY_DOCUMENTS_STORE, 'readwrite')
    const done = transactionDone(tx)
    tx.objectStore(LEGACY_DOCUMENTS_STORE).put({
      name: 'legacy.md',
      content: 'legacy migrated body',
      docType: 'markdown',
      updatedAt: 1
    }, 'recent')
    await done
  } finally {
    db.close()
  }
}

async function readLegacyRecent(db: IDBDatabase): Promise<unknown> {
  const tx = db.transaction(LEGACY_DOCUMENTS_STORE, 'readonly')
  const done = transactionDone(tx)
  const value = await requestToPromise(tx.objectStore(LEGACY_DOCUMENTS_STORE).get('recent'))
  await done
  return value
}

describe('legacy recent privacy scrub scope', () => {
  it('does not delete migrated legacy recent data when a different workspace becomes private', async () => {
    const factory = new IDBFactory()
    await createLegacyDatabase(factory)
    const db = await openDatabase(factory)
    try {
      const repositories = createIndexedDbRepositories(db)
      const atomic = createIndexedDbAtomicOperations(db, () => 900)
      const unrelated = createDefaultWorkspaceState(100)
      unrelated.workspace.id = 'workspace-unrelated'
      unrelated.workspace.activeRuleProfileId = 'profile-unrelated'
      unrelated.workspace.storageMode = 'local-library'
      unrelated.profile.id = 'profile-unrelated'
      await repositories.preferences.save(unrelated.preferences)
      await atomic.createWorkspaceAndActivate(unrelated.workspace, unrelated.profile)

      await atomic.makeWorkspacePrivate(unrelated.workspace.id)

      expect(await readLegacyRecent(db)).toMatchObject({ content: 'legacy migrated body' })
    } finally {
      db.close()
    }
  })

  it('deletes legacy recent data when the migrated workspace itself becomes private', async () => {
    const factory = new IDBFactory()
    await createLegacyDatabase(factory)
    const db = await openDatabase(factory)
    try {
      const repositories = createIndexedDbRepositories(db)
      const atomic = createIndexedDbAtomicOperations(db, () => 900)
      const migrated = createDefaultWorkspaceState(100)
      migrated.workspace.id = MIGRATED_WORKSPACE_ID
      migrated.workspace.activeRuleProfileId = 'profile-migrated'
      migrated.workspace.storageMode = 'local-library'
      migrated.profile.id = 'profile-migrated'
      await repositories.preferences.save(migrated.preferences)
      await atomic.createWorkspaceAndActivate(migrated.workspace, migrated.profile)

      await atomic.makeWorkspacePrivate(migrated.workspace.id)

      expect(await readLegacyRecent(db)).toBeUndefined()
    } finally {
      db.close()
    }
  })

  it('does not delete migrated legacy recent data when persisted documents are scrubbed for a different workspace', async () => {
    const factory = new IDBFactory()
    await createLegacyDatabase(factory)
    const db = await openDatabase(factory)
    try {
      const atomic = createIndexedDbAtomicOperations(db, () => 900)

      await atomic.deletePersistedDocuments('workspace-unrelated')

      expect(await readLegacyRecent(db)).toMatchObject({ content: 'legacy migrated body' })
    } finally {
      db.close()
    }
  })

  it('deletes legacy recent data when persisted documents are scrubbed for the migrated workspace', async () => {
    const factory = new IDBFactory()
    await createLegacyDatabase(factory)
    const db = await openDatabase(factory)
    try {
      const atomic = createIndexedDbAtomicOperations(db, () => 900)

      await atomic.deletePersistedDocuments(MIGRATED_WORKSPACE_ID)

      expect(await readLegacyRecent(db)).toBeUndefined()
    } finally {
      db.close()
    }
  })
})
