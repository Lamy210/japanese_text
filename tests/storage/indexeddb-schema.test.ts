import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/storage/db/open-database'
import {
  DB_NAME,
  DB_VERSION,
  INDEX_DOCUMENT_CREATED_AT,
  INDEX_DOCUMENT_ID,
  INDEX_RULE_ID,
  INDEX_SCOPE_AND_SCOPE_ID,
  INDEX_UPDATED_AT,
  INDEX_WORKSPACE_ID,
  LEGACY_DOCUMENTS_STORE,
  LEGACY_SETTINGS_STORE,
  STORE_DOCUMENT_SNAPSHOTS,
  STORE_META,
  STORE_PREFERENCES,
  STORE_RULE_PROFILES,
  STORE_SUPPRESSIONS,
  STORE_WORKSPACE_DOCUMENTS,
  STORE_WORKSPACES
} from '../../src/storage/db/schema'

function openV1(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(LEGACY_SETTINGS_STORE)
      request.result.createObjectStore(LEGACY_DOCUMENTS_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('v1 open failed'))
  })
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'))
  })
}

async function createLegacyFixture(factory: IDBFactory): Promise<void> {
  const db = await openV1(factory)
  const tx = db.transaction([LEGACY_SETTINGS_STORE, LEGACY_DOCUMENTS_STORE], 'readwrite')
  tx.objectStore(LEGACY_SETTINGS_STORE).put({ schemaVersion: 1, marker: 'legacy-config' }, 'app-config')
  tx.objectStore(LEGACY_DOCUMENTS_STORE).put(
    { name: 'legacy.md', content: 'legacy body', docType: 'markdown', updatedAt: 123 },
    'recent'
  )
  await transactionDone(tx)
  db.close()
}

function getValue(store: IDBObjectStore, key: IDBValidKey): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = store.get(key)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('get failed'))
  })
}

describe('IndexedDB v2 schema', () => {
  it('upgrades a v1 database without changing legacy records', async () => {
    const factory = new IDBFactory()
    await createLegacyFixture(factory)

    const db = await openDatabase(factory)
    expect(db.version).toBe(DB_VERSION)
    expect(db.version).toBe(2)

    const stores = [...db.objectStoreNames]
    for (const name of [
      LEGACY_SETTINGS_STORE,
      LEGACY_DOCUMENTS_STORE,
      STORE_META,
      STORE_WORKSPACES,
      STORE_PREFERENCES,
      STORE_RULE_PROFILES,
      STORE_WORKSPACE_DOCUMENTS,
      STORE_DOCUMENT_SNAPSHOTS,
      STORE_SUPPRESSIONS
    ]) {
      expect(stores).toContain(name)
    }

    const legacyTx = db.transaction([LEGACY_SETTINGS_STORE, LEGACY_DOCUMENTS_STORE], 'readonly')
    await expect(getValue(legacyTx.objectStore(LEGACY_SETTINGS_STORE), 'app-config')).resolves.toEqual({
      schemaVersion: 1,
      marker: 'legacy-config'
    })
    await expect(getValue(legacyTx.objectStore(LEGACY_DOCUMENTS_STORE), 'recent')).resolves.toEqual({
      name: 'legacy.md',
      content: 'legacy body',
      docType: 'markdown',
      updatedAt: 123
    })
    await transactionDone(legacyTx)

    const v2Tx = db.transaction(
      [STORE_WORKSPACES, STORE_RULE_PROFILES, STORE_WORKSPACE_DOCUMENTS, STORE_DOCUMENT_SNAPSHOTS, STORE_SUPPRESSIONS],
      'readonly'
    )
    await expect(getValue(v2Tx.objectStore(STORE_WORKSPACES), 'migrated-v1-workspace')).resolves.toBeUndefined()
    await expect(getValue(v2Tx.objectStore(STORE_RULE_PROFILES), 'migrated-v1-profile')).resolves.toBeUndefined()
    await expect(getValue(v2Tx.objectStore(STORE_WORKSPACE_DOCUMENTS), 'migrated-v1-recent-document')).resolves.toBeUndefined()

    const documents = v2Tx.objectStore(STORE_WORKSPACE_DOCUMENTS)
    expect(documents.index(INDEX_WORKSPACE_ID).keyPath).toBe('workspaceId')
    expect(documents.index(INDEX_UPDATED_AT).keyPath).toBe('updatedAt')

    const snapshots = v2Tx.objectStore(STORE_DOCUMENT_SNAPSHOTS)
    expect(snapshots.index(INDEX_DOCUMENT_ID).keyPath).toBe('documentId')
    expect(snapshots.index(INDEX_DOCUMENT_CREATED_AT).keyPath).toEqual(['documentId', 'createdAt'])

    const suppressions = v2Tx.objectStore(STORE_SUPPRESSIONS)
    expect(suppressions.index(INDEX_SCOPE_AND_SCOPE_ID).keyPath).toEqual(['scope', 'scopeId'])
    expect(suppressions.index(INDEX_RULE_ID).keyPath).toBe('ruleId')
    await transactionDone(v2Tx)
    db.close()
  })

  it('opens a fresh v2 database without manufacturing legacy stores', async () => {
    const factory = new IDBFactory()
    const db = await openDatabase(factory)

    expect(db.name).toBe(DB_NAME)
    expect(db.version).toBe(2)
    expect([...db.objectStoreNames]).not.toContain(LEGACY_SETTINGS_STORE)
    expect([...db.objectStoreNames]).not.toContain(LEGACY_DOCUMENTS_STORE)
    expect([...db.objectStoreNames]).toEqual(
      expect.arrayContaining([
        STORE_META,
        STORE_WORKSPACES,
        STORE_PREFERENCES,
        STORE_RULE_PROFILES,
        STORE_WORKSPACE_DOCUMENTS,
        STORE_DOCUMENT_SNAPSHOTS,
        STORE_SUPPRESSIONS
      ])
    )
    db.close()
  })
})
