import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createDefaultConfig } from '../../src/core/config/validate'
import { createDefaultWorkspaceState } from '../../src/core/workspace/defaults'
import { createIndexedDbAtomicOperations } from '../../src/storage/db/indexeddb-atomic-operations'
import { requestToPromise, transactionDone } from '../../src/storage/db/idb-utils'
import {
  META_STORAGE_SCHEMA_VERSION,
  META_V1_MIGRATION_STATUS,
  MIGRATED_DOCUMENT_ID,
  MIGRATED_PROFILE_ID,
  MIGRATED_WORKSPACE_ID,
  migrateV1ToV2
} from '../../src/storage/db/migration-v1-v2'
import {
  DB_NAME,
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

async function createFailureInjectionDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DB_NAME, 2)
    request.onupgradeneeded = () => {
      const database = request.result
      database.createObjectStore(LEGACY_SETTINGS_STORE)
      database.createObjectStore(LEGACY_DOCUMENTS_STORE)
      database.createObjectStore(STORE_META)
      database.createObjectStore(STORE_PREFERENCES)

      const workspaces = database.createObjectStore(STORE_WORKSPACES, { keyPath: 'id' })
      workspaces.createIndex('failureInjectionUniqueName', 'name', { unique: true })
      database.createObjectStore(STORE_RULE_PROFILES, { keyPath: 'id' })

      const documents = database.createObjectStore(STORE_WORKSPACE_DOCUMENTS, { keyPath: 'id' })
      documents.createIndex(INDEX_WORKSPACE_ID, 'workspaceId')
      documents.createIndex(INDEX_UPDATED_AT, 'updatedAt')

      const snapshots = database.createObjectStore(STORE_DOCUMENT_SNAPSHOTS, { keyPath: 'id' })
      snapshots.createIndex(INDEX_DOCUMENT_ID, 'documentId')
      snapshots.createIndex(INDEX_DOCUMENT_CREATED_AT, ['documentId', 'createdAt'])

      const suppressions = database.createObjectStore(STORE_SUPPRESSIONS, { keyPath: 'id' })
      suppressions.createIndex(INDEX_SCOPE_AND_SCOPE_ID, ['scope', 'scopeId'])
      suppressions.createIndex(INDEX_RULE_ID, 'ruleId')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('open failed'))
  })

  const config = createDefaultConfig()
  config.privacy = { autoSave: true, privacyMode: false }
  const tx = db.transaction(
    [STORE_WORKSPACES, LEGACY_SETTINGS_STORE, LEGACY_DOCUMENTS_STORE],
    'readwrite'
  )
  const done = transactionDone(tx)
  tx.objectStore(STORE_WORKSPACES).put({
    id: 'failure-injection-blocker',
    name: 'Migrated Workspace',
    activeRuleProfileId: 'unused',
    storageMode: 'private-session',
    snapshotPolicy: { enabled: false, maxSnapshots: 20 },
    createdAt: 1,
    updatedAt: 1
  })
  tx.objectStore(LEGACY_SETTINGS_STORE).put(config, 'app-config')
  tx.objectStore(LEGACY_DOCUMENTS_STORE).put(
    { name: 'legacy.md', content: 'legacy body', docType: 'markdown', updatedAt: 123 },
    'recent'
  )
  await done
  return db
}

async function get(db: IDBDatabase, storeName: string, key: IDBValidKey): Promise<unknown> {
  const tx = db.transaction(storeName, 'readonly')
  const done = transactionDone(tx)
  const value = await requestToPromise(tx.objectStore(storeName).get(key))
  await done
  return value
}

describe('migration failure containment', () => {
  it('aborts all target writes, records failure separately, preserves legacy data, and retries', async () => {
    const factory = new IDBFactory()
    const db = await createFailureInjectionDatabase(factory)

    const first = await migrateV1ToV2(db, () => 1000)

    expect(first.state).toBe('failed')
    expect(await get(db, STORE_WORKSPACES, MIGRATED_WORKSPACE_ID)).toBeUndefined()
    expect(await get(db, STORE_RULE_PROFILES, MIGRATED_PROFILE_ID)).toBeUndefined()
    expect(await get(db, STORE_WORKSPACE_DOCUMENTS, MIGRATED_DOCUMENT_ID)).toBeUndefined()
    expect(await get(db, STORE_META, META_STORAGE_SCHEMA_VERSION)).toBeUndefined()
    expect(await get(db, STORE_META, META_V1_MIGRATION_STATUS)).toMatchObject({
      state: 'failed',
      failedAt: 1000
    })
    expect(await get(db, LEGACY_SETTINGS_STORE, 'app-config')).toBeTruthy()
    expect(await get(db, LEGACY_DOCUMENTS_STORE, 'recent')).toMatchObject({ content: 'legacy body' })

    const cleanup = db.transaction(STORE_WORKSPACES, 'readwrite')
    const cleanupDone = transactionDone(cleanup)
    cleanup.objectStore(STORE_WORKSPACES).delete('failure-injection-blocker')
    await cleanupDone

    await expect(migrateV1ToV2(db, () => 2000)).resolves.toEqual({ state: 'migrated' })
    expect(await get(db, STORE_META, META_V1_MIGRATION_STATUS)).toEqual({
      state: 'complete',
      migratedAt: 2000
    })
    expect(await get(db, STORE_WORKSPACES, MIGRATED_WORKSPACE_ID)).toMatchObject({
      storageMode: 'local-library'
    })
    expect(await get(db, STORE_WORKSPACE_DOCUMENTS, MIGRATED_DOCUMENT_ID)).toMatchObject({
      content: 'legacy body'
    })
    db.close()
  })
})

describe('atomic projected storage updates', () => {
  it('rolls back preferences and profile when the workspace write fails', async () => {
    const factory = new IDBFactory()
    const db = await createFailureInjectionDatabase(factory)
    const baseline = createDefaultWorkspaceState(1000)
    baseline.workspace.id = 'atomic-workspace'
    baseline.workspace.name = 'Baseline Workspace'
    baseline.workspace.activeRuleProfileId = 'atomic-profile'
    baseline.profile.id = 'atomic-profile'
    baseline.profile.name = 'Baseline Profile'

    const seed = db.transaction(
      [STORE_WORKSPACES, STORE_PREFERENCES, STORE_RULE_PROFILES],
      'readwrite'
    )
    const seedDone = transactionDone(seed)
    seed.objectStore(STORE_WORKSPACES).put(baseline.workspace)
    seed.objectStore(STORE_PREFERENCES).put(baseline.preferences, 'global')
    seed.objectStore(STORE_RULE_PROFILES).put(baseline.profile)
    await seedDone

    const next = structuredClone(baseline)
    next.preferences.theme = 'dark'
    next.profile.name = 'Changed Profile'
    next.workspace.name = 'Migrated Workspace'

    const atomic = createIndexedDbAtomicOperations(db)
    await expect(atomic.saveProjectedState(next)).rejects.toBeTruthy()

    expect(await get(db, STORE_PREFERENCES, 'global')).toMatchObject({ theme: 'system' })
    expect(await get(db, STORE_RULE_PROFILES, 'atomic-profile')).toMatchObject({ name: 'Baseline Profile' })
    expect(await get(db, STORE_WORKSPACES, 'atomic-workspace')).toMatchObject({ name: 'Baseline Workspace' })
    db.close()
  })
})
