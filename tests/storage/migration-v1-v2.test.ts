import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createDefaultConfig } from '../../src/core/config/validate'
import { openDatabase } from '../../src/storage/db/open-database'
import { requestToPromise, transactionDone } from '../../src/storage/db/idb-utils'
import {
  LEGACY_DOCUMENTS_STORE,
  LEGACY_SETTINGS_STORE,
  STORE_DOCUMENT_SNAPSHOTS,
  STORE_META,
  STORE_RULE_PROFILES,
  STORE_SUPPRESSIONS,
  STORE_WORKSPACE_DOCUMENTS,
  STORE_WORKSPACES
} from '../../src/storage/db/schema'
import {
  META_STORAGE_SCHEMA_VERSION,
  META_V1_MIGRATION_STATUS,
  MIGRATED_DOCUMENT_ID,
  MIGRATED_PROFILE_ID,
  MIGRATED_WORKSPACE_ID,
  migrateV1ToV2
} from '../../src/storage/db/migration-v1-v2'
import { createIndexedDbAtomicOperations } from '../../src/storage/db/indexeddb-atomic-operations'

interface LegacyDocument {
  name: string
  content: string
  docType: 'markdown' | 'text'
  updatedAt: number
}

async function createV1Database(
  factory: IDBFactory,
  options: { config?: unknown; document?: LegacyDocument } = {}
): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open('japanese-writing-toolkit', 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(LEGACY_SETTINGS_STORE)
      request.result.createObjectStore(LEGACY_DOCUMENTS_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('v1 open failed'))
  })

  const tx = db.transaction([LEGACY_SETTINGS_STORE, LEGACY_DOCUMENTS_STORE], 'readwrite')
  const done = transactionDone(tx)
  if (options.config !== undefined) tx.objectStore(LEGACY_SETTINGS_STORE).put(options.config, 'app-config')
  if (options.document !== undefined) tx.objectStore(LEGACY_DOCUMENTS_STORE).put(options.document, 'recent')
  await done
  db.close()
}

async function get(db: IDBDatabase, storeName: string, key: IDBValidKey): Promise<unknown> {
  const tx = db.transaction(storeName, 'readonly')
  const done = transactionDone(tx)
  const value = await requestToPromise(tx.objectStore(storeName).get(key))
  await done
  return value
}

async function put(db: IDBDatabase, storeName: string, key: IDBValidKey | undefined, value: unknown): Promise<void> {
  const tx = db.transaction(storeName, 'readwrite')
  const done = transactionDone(tx)
  if (key === undefined) tx.objectStore(storeName).put(value)
  else tx.objectStore(storeName).put(value, key)
  await done
}

function legacyDocument(): LegacyDocument {
  return { name: 'legacy.md', content: '# Legacy', docType: 'markdown', updatedAt: 123 }
}

describe('v1 to v2 migration', () => {
  it('migrates local-library intent and recent document while preserving legacy data', async () => {
    const factory = new IDBFactory()
    const config = createDefaultConfig()
    config.privacy = { autoSave: true, privacyMode: false }
    config.theme = 'dark'
    config.ngWords = [{ id: 'ng-1', word: 'legacy', severity: 'warning' }]
    const document = legacyDocument()
    await createV1Database(factory, { config, document })
    const db = await openDatabase(factory)

    await expect(migrateV1ToV2(db, () => 1000)).resolves.toEqual({ state: 'migrated' })

    expect(await get(db, STORE_WORKSPACES, MIGRATED_WORKSPACE_ID)).toMatchObject({
      id: MIGRATED_WORKSPACE_ID,
      activeRuleProfileId: MIGRATED_PROFILE_ID,
      storageMode: 'local-library',
      createdAt: 1000,
      updatedAt: 1000
    })
    expect(await get(db, STORE_RULE_PROFILES, MIGRATED_PROFILE_ID)).toMatchObject({
      id: MIGRATED_PROFILE_ID,
      ngWords: config.ngWords,
      sourcePresetId: config.preset
    })
    expect(await get(db, STORE_WORKSPACE_DOCUMENTS, MIGRATED_DOCUMENT_ID)).toMatchObject({
      id: MIGRATED_DOCUMENT_ID,
      workspaceId: MIGRATED_WORKSPACE_ID,
      content: document.content,
      updatedAt: document.updatedAt
    })
    expect(await get(db, LEGACY_SETTINGS_STORE, 'app-config')).toEqual(config)
    expect(await get(db, LEGACY_DOCUMENTS_STORE, 'recent')).toEqual(document)
    expect(await get(db, STORE_META, META_STORAGE_SCHEMA_VERSION)).toBe(2)
    expect(await get(db, STORE_META, META_V1_MIGRATION_STATUS)).toEqual({ state: 'complete', migratedAt: 1000 })
    db.close()
  })

  it('does not manufacture a document when v1 has no recent document', async () => {
    const factory = new IDBFactory()
    const config = createDefaultConfig()
    config.privacy = { autoSave: true, privacyMode: false }
    await createV1Database(factory, { config })
    const db = await openDatabase(factory)

    await migrateV1ToV2(db, () => 1000)

    expect(await get(db, STORE_WORKSPACE_DOCUMENTS, MIGRATED_DOCUMENT_ID)).toBeUndefined()
    db.close()
  })

  it.each([
    { privacy: { autoSave: true, privacyMode: true }, label: 'privacyMode' },
    { privacy: { autoSave: false, privacyMode: false }, label: 'autoSave disabled' }
  ])('does not copy stale body when $label requests private storage', async ({ privacy }) => {
    const factory = new IDBFactory()
    const config = createDefaultConfig()
    config.privacy = privacy
    const document = legacyDocument()
    await createV1Database(factory, { config, document })
    const db = await openDatabase(factory)

    await migrateV1ToV2(db, () => 1000)

    expect(await get(db, STORE_WORKSPACES, MIGRATED_WORKSPACE_ID)).toMatchObject({ storageMode: 'private-session' })
    expect(await get(db, STORE_WORKSPACE_DOCUMENTS, MIGRATED_DOCUMENT_ID)).toBeUndefined()
    expect(await get(db, LEGACY_DOCUMENTS_STORE, 'recent')).toEqual(document)
    db.close()
  })

  it('defaults to private-session when legacy config has no privacy field', async () => {
    const config = structuredClone(createDefaultConfig()) as unknown as Record<string, unknown>
    const factory = new IDBFactory()
    delete config.privacy
    await createV1Database(factory, { config, document: legacyDocument() })
    const db = await openDatabase(factory)

    await migrateV1ToV2(db, () => 1000)

    expect(await get(db, STORE_WORKSPACES, MIGRATED_WORKSPACE_ID)).toMatchObject({ storageMode: 'private-session' })
    expect(await get(db, STORE_WORKSPACE_DOCUMENTS, MIGRATED_DOCUMENT_ID)).toBeUndefined()
    db.close()
  })

  it('recovers a valid legacy document without persisting it when config is corrupt', async () => {
    const factory = new IDBFactory()
    const document = legacyDocument()
    await createV1Database(factory, { config: { schemaVersion: 'broken' }, document })
    const db = await openDatabase(factory)

    const result = await migrateV1ToV2(db, () => 1000)

    expect(result.state).toBe('recovered-with-warning')
    expect(result.warning).toBeTruthy()
    expect(result.recoveredDocument).toEqual(document)
    expect(await get(db, STORE_WORKSPACES, MIGRATED_WORKSPACE_ID)).toMatchObject({ storageMode: 'private-session' })
    expect(await get(db, STORE_WORKSPACE_DOCUMENTS, MIGRATED_DOCUMENT_ID)).toBeUndefined()
    expect(await get(db, LEGACY_DOCUMENTS_STORE, 'recent')).toEqual(document)
    db.close()
  })

  it('initializes a fresh v2 database privately even when legacy stores do not exist', async () => {
    const factory = new IDBFactory()
    const db = await openDatabase(factory)

    await expect(migrateV1ToV2(db, () => 1000)).resolves.toEqual({ state: 'migrated' })
    expect(await get(db, STORE_WORKSPACES, 'local-default-workspace')).toMatchObject({ storageMode: 'private-session' })
    expect(await get(db, STORE_META, META_V1_MIGRATION_STATUS)).toEqual({ state: 'complete', migratedAt: 1000 })
    db.close()
  })

  it('is idempotent after completion and does not rewrite migrated timestamps', async () => {
    const factory = new IDBFactory()
    await createV1Database(factory, { config: createDefaultConfig() })
    const db = await openDatabase(factory)

    await migrateV1ToV2(db, () => 1000)
    await expect(migrateV1ToV2(db, () => 9999)).resolves.toEqual({ state: 'not-needed' })

    expect(await get(db, STORE_WORKSPACES, MIGRATED_WORKSPACE_ID)).toMatchObject({
      createdAt: 1000,
      updatedAt: 1000
    })
    expect(await get(db, STORE_META, META_V1_MIGRATION_STATUS)).toEqual({ state: 'complete', migratedAt: 1000 })
    db.close()
  })

  it.each(['pending', 'failed'] as const)('retries when marker state is %s', async (state) => {
    const factory = new IDBFactory()
    await createV1Database(factory, { config: createDefaultConfig() })
    const db = await openDatabase(factory)
    await put(
      db,
      STORE_META,
      META_V1_MIGRATION_STATUS,
      state === 'pending' ? { state } : { state, message: 'previous failure', failedAt: 500 }
    )

    await expect(migrateV1ToV2(db, () => 1000)).resolves.toEqual({ state: 'migrated' })
    expect(await get(db, STORE_META, META_V1_MIGRATION_STATUS)).toEqual({ state: 'complete', migratedAt: 1000 })
    db.close()
  })
})

describe('IndexedDB atomic operations', () => {
  it('deletes workspace-owned records transactionally without deleting the profile', async () => {
    const factory = new IDBFactory()
    const db = await openDatabase(factory)
    await migrateV1ToV2(db, () => 1000)
    const profileBefore = await get(db, STORE_RULE_PROFILES, 'local-default-profile')

    await put(db, STORE_WORKSPACE_DOCUMENTS, undefined, {
      id: 'doc-1', workspaceId: 'local-default-workspace', name: 'a.md', docType: 'markdown', content: 'a',
      sourceKind: 'local', createdAt: 1, updatedAt: 1
    })
    await put(db, STORE_DOCUMENT_SNAPSHOTS, undefined, {
      id: 'snap-1', documentId: 'doc-1', revision: 1, content: 'a', reason: 'manual', createdAt: 1
    })
    await put(db, STORE_SUPPRESSIONS, undefined, {
      id: 'sup-workspace', scope: 'workspace', scopeId: 'local-default-workspace', kind: 'rule', ruleId: 'x', createdAt: 1
    })
    await put(db, STORE_SUPPRESSIONS, undefined, {
      id: 'sup-document', scope: 'document', scopeId: 'doc-1', kind: 'rule', ruleId: 'x', createdAt: 1
    })
    await put(db, STORE_SUPPRESSIONS, undefined, {
      id: 'sup-profile', scope: 'profile', scopeId: 'local-default-profile', kind: 'rule', ruleId: 'x', createdAt: 1
    })

    await createIndexedDbAtomicOperations(db).deleteWorkspaceCascade('local-default-workspace')

    expect(await get(db, STORE_WORKSPACES, 'local-default-workspace')).toBeUndefined()
    expect(await get(db, STORE_WORKSPACE_DOCUMENTS, 'doc-1')).toBeUndefined()
    expect(await get(db, STORE_DOCUMENT_SNAPSHOTS, 'snap-1')).toBeUndefined()
    expect(await get(db, STORE_SUPPRESSIONS, 'sup-workspace')).toBeUndefined()
    expect(await get(db, STORE_SUPPRESSIONS, 'sup-document')).toBeUndefined()
    expect(await get(db, STORE_SUPPRESSIONS, 'sup-profile')).toBeTruthy()
    expect(await get(db, STORE_RULE_PROFILES, 'local-default-profile')).toEqual(profileBefore)
    db.close()
  })
})
