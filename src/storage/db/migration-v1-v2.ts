import { createDefaultConfig, migrateConfig, validateAppConfig } from '../../core/config/validate'
import { createDefaultWorkspaceState } from '../../core/workspace/defaults'
import type { DocumentType } from '../../core/types'
import type { ProjectedStorageState } from '../compat/app-config-projection'
import { splitAppConfig } from '../compat/app-config-projection'
import type { MigrationResult, RecoveredDocument } from '../repositories/ports'
import { requestToPromise, transactionDone } from './idb-utils'
import {
  LEGACY_DOCUMENTS_STORE,
  LEGACY_SETTINGS_STORE,
  STORE_META,
  STORE_PREFERENCES,
  STORE_RULE_PROFILES,
  STORE_WORKSPACE_DOCUMENTS,
  STORE_WORKSPACES
} from './schema'

export const META_STORAGE_SCHEMA_VERSION = 'storage-schema-version'
export const META_V1_MIGRATION_STATUS = 'v1-migration-status'

export const MIGRATED_WORKSPACE_ID = 'migrated-v1-workspace'
export const MIGRATED_PROFILE_ID = 'migrated-v1-profile'
export const MIGRATED_DOCUMENT_ID = 'migrated-v1-recent-document'

interface MigrationStatusComplete {
  state: 'complete'
  migratedAt: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseLegacyDocument(raw: unknown): RecoveredDocument | undefined {
  if (!isRecord(raw)) return undefined
  if (typeof raw.name !== 'string' || raw.name.length === 0) return undefined
  if (typeof raw.content !== 'string') return undefined
  if (raw.docType !== 'markdown' && raw.docType !== 'text') return undefined
  if (typeof raw.updatedAt !== 'number' || !Number.isFinite(raw.updatedAt) || raw.updatedAt < 0) return undefined
  return {
    name: raw.name,
    content: raw.content,
    docType: raw.docType as DocumentType,
    updatedAt: raw.updatedAt
  }
}

function migratedDefaults(timestamp: number): ProjectedStorageState {
  const state = createDefaultWorkspaceState(timestamp)
  state.workspace.id = MIGRATED_WORKSPACE_ID
  state.workspace.name = 'Migrated Workspace'
  state.workspace.activeRuleProfileId = MIGRATED_PROFILE_ID
  state.profile.id = MIGRATED_PROFILE_ID
  state.profile.name = 'Migrated profile'
  return state
}

async function readMigrationStatus(db: IDBDatabase): Promise<unknown> {
  const tx = db.transaction(STORE_META, 'readonly')
  const done = transactionDone(tx)
  const value = await requestToPromise(tx.objectStore(STORE_META).get(META_V1_MIGRATION_STATUS))
  await done
  return value
}

function isCompleteStatus(value: unknown): value is MigrationStatusComplete {
  return isRecord(value) && value.state === 'complete' && typeof value.migratedAt === 'number'
}

export async function migrateV1ToV2(
  db: IDBDatabase,
  now: () => number = Date.now
): Promise<MigrationResult> {
  if (isCompleteStatus(await readMigrationStatus(db))) {
    return { state: 'not-needed' }
  }

  const hasLegacySettings = db.objectStoreNames.contains(LEGACY_SETTINGS_STORE)
  const hasLegacyDocuments = db.objectStoreNames.contains(LEGACY_DOCUMENTS_STORE)
  const targetStores = [
    STORE_META,
    STORE_WORKSPACES,
    STORE_PREFERENCES,
    STORE_RULE_PROFILES,
    STORE_WORKSPACE_DOCUMENTS
  ]
  const transactionStores = [
    ...targetStores,
    ...(hasLegacySettings ? [LEGACY_SETTINGS_STORE] : []),
    ...(hasLegacyDocuments ? [LEGACY_DOCUMENTS_STORE] : [])
  ]

  const timestamp = now()
  const tx = db.transaction(transactionStores, 'readwrite')
  const done = transactionDone(tx)

  try {
    const meta = tx.objectStore(STORE_META)
    const statusRequest = meta.get(META_V1_MIGRATION_STATUS)
    const configRequest = hasLegacySettings
      ? tx.objectStore(LEGACY_SETTINGS_STORE).get('app-config')
      : undefined
    const documentRequest = hasLegacyDocuments
      ? tx.objectStore(LEGACY_DOCUMENTS_STORE).get('recent')
      : undefined

    const [status, rawConfig, rawDocument] = await Promise.all([
      requestToPromise(statusRequest),
      configRequest === undefined ? Promise.resolve(undefined) : requestToPromise(configRequest),
      documentRequest === undefined ? Promise.resolve(undefined) : requestToPromise(documentRequest)
    ])

    if (isCompleteStatus(status)) {
      await done
      return { state: 'not-needed' }
    }

    const legacyDocument = parseLegacyDocument(rawDocument)
    const hasAnyLegacyStore = hasLegacySettings || hasLegacyDocuments
    let state: ProjectedStorageState
    let warning: string | undefined
    let configIsValid = false

    if (!hasAnyLegacyStore) {
      state = createDefaultWorkspaceState(timestamp)
    } else if (rawConfig === undefined) {
      state = migratedDefaults(timestamp)
      warning = legacyDocument === undefined
        ? 'Legacy configuration was missing; private defaults were used.'
        : 'Legacy configuration was missing; the document was recovered in memory only.'
    } else {
      try {
        const validatedConfig = validateAppConfig(migrateConfig(rawConfig))
        state = splitAppConfig(validatedConfig, migratedDefaults(timestamp), timestamp)
        configIsValid = true
      } catch (error) {
        state = migratedDefaults(timestamp)
        warning = `Legacy configuration could not be migrated: ${error instanceof Error ? error.message : String(error)}`
      }
    }

    tx.objectStore(STORE_WORKSPACES).put(state.workspace)
    tx.objectStore(STORE_PREFERENCES).put(state.preferences, 'global')
    tx.objectStore(STORE_RULE_PROFILES).put(state.profile)

    if (configIsValid && state.workspace.storageMode === 'local-library' && legacyDocument !== undefined) {
      tx.objectStore(STORE_WORKSPACE_DOCUMENTS).put({
        id: MIGRATED_DOCUMENT_ID,
        workspaceId: state.workspace.id,
        name: legacyDocument.name,
        docType: legacyDocument.docType,
        content: legacyDocument.content,
        sourceKind: 'local',
        createdAt: legacyDocument.updatedAt,
        updatedAt: legacyDocument.updatedAt
      })
    }

    meta.put(2, META_STORAGE_SCHEMA_VERSION)
    meta.put({ state: 'complete', migratedAt: timestamp }, META_V1_MIGRATION_STATUS)
    await done

    if (warning !== undefined) {
      return {
        state: 'recovered-with-warning',
        warning,
        ...(legacyDocument === undefined ? {} : { recoveredDocument: legacyDocument })
      }
    }
    return { state: 'migrated' }
  } catch (error) {
    try {
      tx.abort()
    } catch {
      // The transaction may already be aborted/finished.
    }
    try {
      await done
    } catch {
      // Return the normalized migration failure below.
    }
    return {
      state: 'failed',
      warning: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * Used by compatibility recovery callers that need a validated private config
 * even when no durable storage can be initialized.
 */
export function createPrivateFallbackConfig() {
  return createDefaultConfig()
}
