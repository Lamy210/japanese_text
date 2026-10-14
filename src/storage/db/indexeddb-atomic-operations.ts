import {
  validatePreferencesRecord,
  validateRuleProfileRecord,
  validateWorkspaceRecord
} from '../../core/workspace/validate'
import type { AtomicOperationsPort } from '../repositories/ports'
import { requestToPromise, transactionDone } from './idb-utils'
import { migrateV1ToV2 } from './migration-v1-v2'
import {
  INDEX_WORKSPACE_ID,
  LEGACY_DOCUMENTS_STORE,
  STORE_DOCUMENT_SNAPSHOTS,
  STORE_PREFERENCES,
  STORE_RULE_PROFILES,
  STORE_SUPPRESSIONS,
  STORE_WORKSPACE_DOCUMENTS,
  STORE_WORKSPACES
} from './schema'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function abortAndRethrow(tx: IDBTransaction, done: Promise<void>, error: unknown): Promise<never> {
  try {
    tx.abort()
  } catch {
    // The transaction may already have failed or completed.
  }
  try {
    await done
  } catch {
    // Preserve the original operation error.
  }
  throw error
}

export function createIndexedDbAtomicOperations(
  db: IDBDatabase,
  now: () => number = Date.now
): AtomicOperationsPort {
  return {
    migrateV1ToV2() {
      return migrateV1ToV2(db, now)
    },

    async saveProjectedState(value) {
      const preferences = validatePreferencesRecord(value.preferences)
      const profile = validateRuleProfileRecord(value.profile)
      const workspace = validateWorkspaceRecord(value.workspace)
      const tx = db.transaction(
        [STORE_PREFERENCES, STORE_RULE_PROFILES, STORE_WORKSPACES],
        'readwrite'
      )
      const done = transactionDone(tx)

      try {
        await Promise.all([
          requestToPromise(tx.objectStore(STORE_PREFERENCES).put(preferences, 'global')),
          requestToPromise(tx.objectStore(STORE_RULE_PROFILES).put(profile)),
          requestToPromise(tx.objectStore(STORE_WORKSPACES).put(workspace))
        ])
        await done
      } catch (error) {
        return abortAndRethrow(tx, done, error)
      }
    },

    async deletePersistedDocuments(workspaceId) {
      const hasLegacyDocuments = db.objectStoreNames.contains(LEGACY_DOCUMENTS_STORE)
      const stores = [
        STORE_WORKSPACE_DOCUMENTS,
        STORE_DOCUMENT_SNAPSHOTS,
        ...(hasLegacyDocuments ? [LEGACY_DOCUMENTS_STORE] : [])
      ]
      const tx = db.transaction(stores, 'readwrite')
      const done = transactionDone(tx)
      const documentStore = tx.objectStore(STORE_WORKSPACE_DOCUMENTS)
      const snapshotStore = tx.objectStore(STORE_DOCUMENT_SNAPSHOTS)

      try {
        if (hasLegacyDocuments) {
          tx.objectStore(LEGACY_DOCUMENTS_STORE).delete('recent')
        }

        const documentKeysRequest = documentStore.index(INDEX_WORKSPACE_ID).getAllKeys(workspaceId)
        documentKeysRequest.onsuccess = () => {
          const documentIds = new Set(
            documentKeysRequest.result.filter((key): key is string => typeof key === 'string')
          )

          for (const key of documentIds) documentStore.delete(key)

          const snapshotCursorRequest = snapshotStore.openCursor()
          snapshotCursorRequest.onsuccess = () => {
            const cursor = snapshotCursorRequest.result
            if (cursor === null) return
            const raw = cursor.value
            if (isRecord(raw) && typeof raw.documentId === 'string' && documentIds.has(raw.documentId)) {
              cursor.delete()
            }
            cursor.continue()
          }
        }

        await done
      } catch (error) {
        return abortAndRethrow(tx, done, error)
      }
    },

    async deleteWorkspaceCascade(workspaceId) {
      const tx = db.transaction(
        [STORE_WORKSPACES, STORE_WORKSPACE_DOCUMENTS, STORE_DOCUMENT_SNAPSHOTS, STORE_SUPPRESSIONS],
        'readwrite'
      )
      const done = transactionDone(tx)
      const documentStore = tx.objectStore(STORE_WORKSPACE_DOCUMENTS)
      const snapshotStore = tx.objectStore(STORE_DOCUMENT_SNAPSHOTS)
      const suppressionStore = tx.objectStore(STORE_SUPPRESSIONS)

      try {
        // Start with one request, then queue every dependent request from its success callback.
        // This keeps the transaction active in real browsers instead of awaiting getAll() and
        // attempting writes after IndexedDB has had a chance to auto-commit the transaction.
        const documentKeysRequest = documentStore.index(INDEX_WORKSPACE_ID).getAllKeys(workspaceId)
        documentKeysRequest.onsuccess = () => {
          const documentIds = new Set(
            documentKeysRequest.result.filter((key): key is string => typeof key === 'string')
          )

          for (const documentId of documentIds) documentStore.delete(documentId)
          tx.objectStore(STORE_WORKSPACES).delete(workspaceId)

          const snapshotCursorRequest = snapshotStore.openCursor()
          snapshotCursorRequest.onsuccess = () => {
            const cursor = snapshotCursorRequest.result
            if (cursor === null) return
            const raw = cursor.value
            if (isRecord(raw) && typeof raw.documentId === 'string' && documentIds.has(raw.documentId)) {
              cursor.delete()
            }
            cursor.continue()
          }

          const suppressionCursorRequest = suppressionStore.openCursor()
          suppressionCursorRequest.onsuccess = () => {
            const cursor = suppressionCursorRequest.result
            if (cursor === null) return
            const raw = cursor.value
            if (isRecord(raw)) {
              const workspaceScoped = raw.scope === 'workspace' && raw.scopeId === workspaceId
              const documentScoped =
                raw.scope === 'document' && typeof raw.scopeId === 'string' && documentIds.has(raw.scopeId)
              if (workspaceScoped || documentScoped) cursor.delete()
            }
            cursor.continue()
          }
        }

        await done
      } catch (error) {
        return abortAndRethrow(tx, done, error)
      }
    }
  }
}
