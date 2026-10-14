import {
  DB_NAME,
  DB_VERSION,
  INDEX_DOCUMENT_CREATED_AT,
  INDEX_DOCUMENT_ID,
  INDEX_RULE_ID,
  INDEX_SCOPE_AND_SCOPE_ID,
  INDEX_UPDATED_AT,
  INDEX_WORKSPACE_ID,
  STORE_DOCUMENT_SNAPSHOTS,
  STORE_META,
  STORE_PREFERENCES,
  STORE_RULE_PROFILES,
  STORE_SUPPRESSIONS,
  STORE_WORKSPACE_DOCUMENTS,
  STORE_WORKSPACES
} from './schema'

function ensureStore(db: IDBDatabase, name: string, options?: IDBObjectStoreParameters): IDBObjectStore | undefined {
  if (db.objectStoreNames.contains(name)) return undefined
  return db.createObjectStore(name, options)
}

function ensureIndex(
  store: IDBObjectStore,
  name: string,
  keyPath: string | string[],
  options?: IDBIndexParameters
): void {
  if (!store.indexNames.contains(name)) {
    store.createIndex(name, keyPath, options)
  }
}

export function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      const tx = request.transaction
      if (tx === null) throw new Error('IndexedDB upgrade transaction is unavailable')

      ensureStore(db, STORE_META)
      ensureStore(db, STORE_PREFERENCES)
      ensureStore(db, STORE_WORKSPACES, { keyPath: 'id' })
      ensureStore(db, STORE_RULE_PROFILES, { keyPath: 'id' })

      const documentStore =
        ensureStore(db, STORE_WORKSPACE_DOCUMENTS, { keyPath: 'id' }) ?? tx.objectStore(STORE_WORKSPACE_DOCUMENTS)
      ensureIndex(documentStore, INDEX_WORKSPACE_ID, 'workspaceId')
      ensureIndex(documentStore, INDEX_UPDATED_AT, 'updatedAt')

      const snapshotStore =
        ensureStore(db, STORE_DOCUMENT_SNAPSHOTS, { keyPath: 'id' }) ?? tx.objectStore(STORE_DOCUMENT_SNAPSHOTS)
      ensureIndex(snapshotStore, INDEX_DOCUMENT_ID, 'documentId')
      ensureIndex(snapshotStore, INDEX_DOCUMENT_CREATED_AT, ['documentId', 'createdAt'])

      const suppressionStore =
        ensureStore(db, STORE_SUPPRESSIONS, { keyPath: 'id' }) ?? tx.objectStore(STORE_SUPPRESSIONS)
      ensureIndex(suppressionStore, INDEX_SCOPE_AND_SCOPE_ID, ['scope', 'scopeId'])
      ensureIndex(suppressionStore, INDEX_RULE_ID, 'ruleId')
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
    request.onblocked = () => reject(new Error('IndexedDB upgrade blocked'))
  })
}
