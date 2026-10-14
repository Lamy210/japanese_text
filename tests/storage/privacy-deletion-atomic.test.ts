import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createDefaultConfig } from '../../src/core/config/validate'
import { createIndexedDbAtomicOperations } from '../../src/storage/db/indexeddb-atomic-operations'
import { requestToPromise, transactionDone } from '../../src/storage/db/idb-utils'
import {
  MIGRATED_DOCUMENT_ID,
  MIGRATED_WORKSPACE_ID,
  migrateV1ToV2
} from '../../src/storage/db/migration-v1-v2'
import { openDatabase } from '../../src/storage/db/open-database'
import {
  DB_NAME,
  LEGACY_DOCUMENTS_STORE,
  LEGACY_SETTINGS_STORE,
  STORE_WORKSPACE_DOCUMENTS
} from '../../src/storage/db/schema'

async function createLegacyDatabase(factory: IDBFactory): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(LEGACY_SETTINGS_STORE)
      request.result.createObjectStore(LEGACY_DOCUMENTS_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('legacy open failed'))
  })

  const config = createDefaultConfig()
  config.privacy = { autoSave: true, privacyMode: false }
  const tx = db.transaction([LEGACY_SETTINGS_STORE, LEGACY_DOCUMENTS_STORE], 'readwrite')
  const done = transactionDone(tx)
  tx.objectStore(LEGACY_SETTINGS_STORE).put(config, 'app-config')
  tx.objectStore(LEGACY_DOCUMENTS_STORE).put(
    { name: 'secret.md', content: 'secret body', docType: 'markdown', updatedAt: 123 },
    'recent'
  )
  await done
  db.close()
}

async function get(db: IDBDatabase, store: string, key: IDBValidKey): Promise<unknown> {
  const tx = db.transaction(store, 'readonly')
  const done = transactionDone(tx)
  const value = await requestToPromise(tx.objectStore(store).get(key))
  await done
  return value
}

describe('privacy document deletion atomic operation', () => {
  it('deletes v2 workspace bodies and the retained legacy recent body together', async () => {
    const factory = new IDBFactory()
    await createLegacyDatabase(factory)
    const db = await openDatabase(factory)
    await migrateV1ToV2(db, () => 1000)

    expect(await get(db, STORE_WORKSPACE_DOCUMENTS, MIGRATED_DOCUMENT_ID)).toBeTruthy()
    expect(await get(db, LEGACY_DOCUMENTS_STORE, 'recent')).toBeTruthy()

    await createIndexedDbAtomicOperations(db).deletePersistedDocuments(MIGRATED_WORKSPACE_ID)

    expect(await get(db, STORE_WORKSPACE_DOCUMENTS, MIGRATED_DOCUMENT_ID)).toBeUndefined()
    expect(await get(db, LEGACY_DOCUMENTS_STORE, 'recent')).toBeUndefined()
    db.close()
  })
})
