import {
  validateDocumentRecord,
  validatePreferencesRecord,
  validateRuleProfileRecord,
  validateWorkspaceRecord
} from '../../core/workspace/validate'
import type { AtomicOperationsPort } from '../repositories/ports'
import { requestToPromise, transactionDone } from './idb-utils'
import { MIGRATED_WORKSPACE_ID, migrateV1ToV2 } from './migration-v1-v2'
import {
  INDEX_WORKSPACE_ID,
  LEGACY_DOCUMENTS_STORE,
  META_ACTIVE_WORKSPACE_ID,
  STORE_DOCUMENT_SNAPSHOTS,
  STORE_META,
  STORE_PREFERENCES,
  STORE_RULE_PROFILES,
  STORE_SUPPRESSIONS,
  STORE_WORKSPACE_DOCUMENTS,
  STORE_WORKSPACES
} from './schema'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function shouldScrubLegacyDocument(db: IDBDatabase, workspaceId: string): boolean {
  return workspaceId === MIGRATED_WORKSPACE_ID && db.objectStoreNames.contains(LEGACY_DOCUMENTS_STORE)
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

    async createWorkspaceAndActivate(workspaceValue, profileValue) {
      const workspace = validateWorkspaceRecord(workspaceValue)
      const profile = validateRuleProfileRecord(profileValue)
      if (workspace.activeRuleProfileId !== profile.id) {
        throw new Error('workspace.activeRuleProfileId must reference the created profile')
      }

      const tx = db.transaction([STORE_RULE_PROFILES, STORE_WORKSPACES, STORE_META], 'readwrite')
      const done = transactionDone(tx)

      try {
        await Promise.all([
          requestToPromise(tx.objectStore(STORE_RULE_PROFILES).put(profile)),
          requestToPromise(tx.objectStore(STORE_WORKSPACES).put(workspace)),
          requestToPromise(tx.objectStore(STORE_META).put(workspace.id, META_ACTIVE_WORKSPACE_ID))
        ])
        await done
      } catch (error) {
        return abortAndRethrow(tx, done, error)
      }
    },

    async deletePersistedDocuments(workspaceId) {
      const scrubLegacy = shouldScrubLegacyDocument(db, workspaceId)
      const stores = [
        STORE_WORKSPACE_DOCUMENTS,
        STORE_DOCUMENT_SNAPSHOTS,
        ...(scrubLegacy ? [LEGACY_DOCUMENTS_STORE] : [])
      ]
      const tx = db.transaction(stores, 'readwrite')
      const done = transactionDone(tx)
      const documentStore = tx.objectStore(STORE_WORKSPACE_DOCUMENTS)
      const snapshotStore = tx.objectStore(STORE_DOCUMENT_SNAPSHOTS)

      try {
        if (scrubLegacy) tx.objectStore(LEGACY_DOCUMENTS_STORE).delete('recent')

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
      const scrubLegacy = shouldScrubLegacyDocument(db, workspaceId)
      const stores = [
        STORE_WORKSPACES,
        STORE_WORKSPACE_DOCUMENTS,
        STORE_DOCUMENT_SNAPSHOTS,
        STORE_SUPPRESSIONS,
        ...(scrubLegacy ? [LEGACY_DOCUMENTS_STORE] : [])
      ]
      const tx = db.transaction(stores, 'readwrite')
      const done = transactionDone(tx)
      const documentStore = tx.objectStore(STORE_WORKSPACE_DOCUMENTS)
      const snapshotStore = tx.objectStore(STORE_DOCUMENT_SNAPSHOTS)
      const suppressionStore = tx.objectStore(STORE_SUPPRESSIONS)

      try {
        if (scrubLegacy) tx.objectStore(LEGACY_DOCUMENTS_STORE).delete('recent')

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
    },

    async deleteWorkspaceAndSelectNext(workspaceId, nextWorkspaceId) {
      if (workspaceId === nextWorkspaceId) throw new Error('next workspace must differ from deleted workspace')

      const scrubLegacy = shouldScrubLegacyDocument(db, workspaceId)
      const stores = [
        STORE_META,
        STORE_WORKSPACES,
        STORE_WORKSPACE_DOCUMENTS,
        STORE_DOCUMENT_SNAPSHOTS,
        STORE_SUPPRESSIONS,
        ...(scrubLegacy ? [LEGACY_DOCUMENTS_STORE] : [])
      ]
      const tx = db.transaction(stores, 'readwrite')
      const done = transactionDone(tx)
      const workspaceStore = tx.objectStore(STORE_WORKSPACES)
      const documentStore = tx.objectStore(STORE_WORKSPACE_DOCUMENTS)
      const snapshotStore = tx.objectStore(STORE_DOCUMENT_SNAPSHOTS)
      const suppressionStore = tx.objectStore(STORE_SUPPRESSIONS)
      let validationError: Error | undefined

      try {
        const nextWorkspaceRequest = workspaceStore.get(nextWorkspaceId)
        nextWorkspaceRequest.onsuccess = () => {
          if (nextWorkspaceRequest.result === undefined) {
            validationError = new Error(`Next workspace not found: ${nextWorkspaceId}`)
            tx.abort()
            return
          }

          if (scrubLegacy) tx.objectStore(LEGACY_DOCUMENTS_STORE).delete('recent')

          const documentKeysRequest = documentStore.index(INDEX_WORKSPACE_ID).getAllKeys(workspaceId)
          documentKeysRequest.onsuccess = () => {
            const documentIds = new Set(
              documentKeysRequest.result.filter((key): key is string => typeof key === 'string')
            )

            for (const documentId of documentIds) documentStore.delete(documentId)
            workspaceStore.delete(workspaceId)
            tx.objectStore(STORE_META).put(nextWorkspaceId, META_ACTIVE_WORKSPACE_ID)

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
        }

        await done
      } catch (error) {
        if (validationError !== undefined) throw validationError
        return abortAndRethrow(tx, done, error)
      }
    },

    async enableLocalLibrary(workspaceId, documentValue) {
      const document = validateDocumentRecord(documentValue)
      if (document.workspaceId !== workspaceId) {
        throw new Error('document.workspaceId must match the target workspace')
      }

      const tx = db.transaction([STORE_WORKSPACES, STORE_WORKSPACE_DOCUMENTS], 'readwrite')
      const done = transactionDone(tx)
      const workspaceStore = tx.objectStore(STORE_WORKSPACES)
      const documentStore = tx.objectStore(STORE_WORKSPACE_DOCUMENTS)
      let validationError: Error | undefined

      try {
        const workspaceRequest = workspaceStore.get(workspaceId)
        workspaceRequest.onsuccess = () => {
          if (workspaceRequest.result === undefined) {
            validationError = new Error(`Workspace not found: ${workspaceId}`)
            tx.abort()
            return
          }

          try {
            const workspace = validateWorkspaceRecord(workspaceRequest.result)
            workspaceStore.put({ ...workspace, storageMode: 'local-library', updatedAt: now() })
            documentStore.put(document)
          } catch (error) {
            validationError = error instanceof Error ? error : new Error(String(error))
            tx.abort()
          }
        }

        await done
      } catch (error) {
        if (validationError !== undefined) throw validationError
        return abortAndRethrow(tx, done, error)
      }
    },

    async makeWorkspacePrivate(workspaceId) {
      const scrubLegacy = shouldScrubLegacyDocument(db, workspaceId)
      const stores = [
        STORE_WORKSPACES,
        STORE_WORKSPACE_DOCUMENTS,
        STORE_DOCUMENT_SNAPSHOTS,
        ...(scrubLegacy ? [LEGACY_DOCUMENTS_STORE] : [])
      ]
      const tx = db.transaction(stores, 'readwrite')
      const done = transactionDone(tx)
      const workspaceStore = tx.objectStore(STORE_WORKSPACES)
      const documentStore = tx.objectStore(STORE_WORKSPACE_DOCUMENTS)
      const snapshotStore = tx.objectStore(STORE_DOCUMENT_SNAPSHOTS)
      let validationError: Error | undefined

      try {
        const workspaceRequest = workspaceStore.get(workspaceId)
        workspaceRequest.onsuccess = () => {
          if (workspaceRequest.result === undefined) {
            validationError = new Error(`Workspace not found: ${workspaceId}`)
            tx.abort()
            return
          }

          let workspace
          try {
            workspace = validateWorkspaceRecord(workspaceRequest.result)
          } catch (error) {
            validationError = error instanceof Error ? error : new Error(String(error))
            tx.abort()
            return
          }

          workspaceStore.put({ ...workspace, storageMode: 'private-session', updatedAt: now() })
          if (scrubLegacy) tx.objectStore(LEGACY_DOCUMENTS_STORE).delete('recent')

          const documentKeysRequest = documentStore.index(INDEX_WORKSPACE_ID).getAllKeys(workspaceId)
          documentKeysRequest.onsuccess = () => {
            const documentIds = new Set(
              documentKeysRequest.result.filter((key): key is string => typeof key === 'string')
            )
            for (const documentId of documentIds) documentStore.delete(documentId)

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
        }

        await done
      } catch (error) {
        if (validationError !== undefined) throw validationError
        return abortAndRethrow(tx, done, error)
      }
    }
  }
}
