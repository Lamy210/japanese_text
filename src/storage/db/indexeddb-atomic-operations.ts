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
  activeDocumentMetaKey,
  INDEX_DOCUMENT_ID,
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

function deleteSnapshotsForDocument(snapshotStore: IDBObjectStore, documentId: string): void {
  const keysRequest = snapshotStore.index(INDEX_DOCUMENT_ID).getAllKeys(documentId)
  keysRequest.onsuccess = () => {
    for (const key of keysRequest.result) snapshotStore.delete(key)
  }
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

    async createDocumentAndActivate(documentValue) {
      const document = validateDocumentRecord(documentValue)
      const tx = db.transaction([STORE_WORKSPACES, STORE_WORKSPACE_DOCUMENTS, STORE_META], 'readwrite')
      const done = transactionDone(tx)
      const workspaceStore = tx.objectStore(STORE_WORKSPACES)
      const documentStore = tx.objectStore(STORE_WORKSPACE_DOCUMENTS)
      const metaStore = tx.objectStore(STORE_META)
      let validationError: Error | undefined

      try {
        const workspaceRequest = workspaceStore.get(document.workspaceId)
        const existingDocumentRequest = documentStore.get(document.id)
        let workspaceReady = false
        let documentReady = false
        let workspaceValid = false
        let documentAvailable = false

        const commitIfReady = () => {
          if (!workspaceReady || !documentReady) return
          if (!workspaceValid || !documentAvailable) {
            tx.abort()
            return
          }
          documentStore.put(document)
          metaStore.put(document.id, activeDocumentMetaKey(document.workspaceId))
        }

        workspaceRequest.onsuccess = () => {
          workspaceReady = true
          if (workspaceRequest.result === undefined) {
            validationError = new Error(`Workspace not found: ${document.workspaceId}`)
          } else {
            try {
              const workspace = validateWorkspaceRecord(workspaceRequest.result)
              if (workspace.storageMode !== 'local-library') {
                validationError = new Error(`Workspace is not Local Library: ${document.workspaceId}`)
              } else {
                workspaceValid = true
              }
            } catch (error) {
              validationError = error instanceof Error ? error : new Error(String(error))
            }
          }
          commitIfReady()
        }

        existingDocumentRequest.onsuccess = () => {
          documentReady = true
          if (existingDocumentRequest.result !== undefined) {
            validationError = new Error(`Document already exists: ${document.id}`)
          } else {
            documentAvailable = true
          }
          commitIfReady()
        }

        await done
      } catch (error) {
        if (validationError !== undefined) throw validationError
        return abortAndRethrow(tx, done, error)
      }
    },

    async deleteDocumentAndSelectNext(workspaceId, documentId, nextDocumentId) {
      if (documentId === nextDocumentId) throw new Error('next document must differ from deleted document')
      const tx = db.transaction(
        [STORE_WORKSPACES, STORE_WORKSPACE_DOCUMENTS, STORE_DOCUMENT_SNAPSHOTS, STORE_META],
        'readwrite'
      )
      const done = transactionDone(tx)
      const workspaceStore = tx.objectStore(STORE_WORKSPACES)
      const documentStore = tx.objectStore(STORE_WORKSPACE_DOCUMENTS)
      const snapshotStore = tx.objectStore(STORE_DOCUMENT_SNAPSHOTS)
      const metaStore = tx.objectStore(STORE_META)
      let validationError: Error | undefined

      try {
        const workspaceRequest = workspaceStore.get(workspaceId)
        const targetRequest = documentStore.get(documentId)
        const nextRequest = documentStore.get(nextDocumentId)
        let pending = 3
        let valid = true

        const completeValidation = () => {
          pending -= 1
          if (pending !== 0) return
          if (!valid) {
            tx.abort()
            return
          }
          documentStore.delete(documentId)
          deleteSnapshotsForDocument(snapshotStore, documentId)
          metaStore.put(nextDocumentId, activeDocumentMetaKey(workspaceId))
        }

        workspaceRequest.onsuccess = () => {
          try {
            const raw = workspaceRequest.result
            if (raw === undefined) throw new Error(`Workspace not found: ${workspaceId}`)
            const workspace = validateWorkspaceRecord(raw)
            if (workspace.storageMode !== 'local-library') throw new Error(`Workspace is not Local Library: ${workspaceId}`)
          } catch (error) {
            valid = false
            validationError = error instanceof Error ? error : new Error(String(error))
          }
          completeValidation()
        }
        targetRequest.onsuccess = () => {
          const raw = targetRequest.result
          if (raw === undefined) {
            valid = false
            validationError = new Error(`Document not found: ${documentId}`)
          } else {
            try {
              const target = validateDocumentRecord(raw)
              if (target.workspaceId !== workspaceId) throw new Error(`Document not found in workspace: ${documentId}`)
            } catch (error) {
              valid = false
              validationError = error instanceof Error ? error : new Error(String(error))
            }
          }
          completeValidation()
        }
        nextRequest.onsuccess = () => {
          const raw = nextRequest.result
          if (raw === undefined) {
            valid = false
            validationError = new Error(`Next document not found: ${nextDocumentId}`)
          } else {
            try {
              const nextDocument = validateDocumentRecord(raw)
              if (nextDocument.workspaceId !== workspaceId) {
                throw new Error(`Next document not found in workspace: ${nextDocumentId}`)
              }
            } catch (error) {
              valid = false
              validationError = error instanceof Error ? error : new Error(String(error))
            }
          }
          completeValidation()
        }

        await done
      } catch (error) {
        if (validationError !== undefined) throw validationError
        return abortAndRethrow(tx, done, error)
      }
    },

    async replaceLastDocument(workspaceId, oldDocumentId, replacementValue) {
      const replacement = validateDocumentRecord(replacementValue)
      if (replacement.workspaceId !== workspaceId) {
        throw new Error('replacement.workspaceId must match the target workspace')
      }
      const tx = db.transaction(
        [STORE_WORKSPACES, STORE_WORKSPACE_DOCUMENTS, STORE_DOCUMENT_SNAPSHOTS, STORE_META],
        'readwrite'
      )
      const done = transactionDone(tx)
      const workspaceStore = tx.objectStore(STORE_WORKSPACES)
      const documentStore = tx.objectStore(STORE_WORKSPACE_DOCUMENTS)
      const snapshotStore = tx.objectStore(STORE_DOCUMENT_SNAPSHOTS)
      const metaStore = tx.objectStore(STORE_META)
      let validationError: Error | undefined

      try {
        const workspaceRequest = workspaceStore.get(workspaceId)
        const oldRequest = documentStore.get(oldDocumentId)
        const replacementRequest = replacement.id === oldDocumentId ? undefined : documentStore.get(replacement.id)
        let pending = replacementRequest === undefined ? 2 : 3
        let valid = true

        const completeValidation = () => {
          pending -= 1
          if (pending !== 0) return
          if (!valid) {
            tx.abort()
            return
          }
          documentStore.delete(oldDocumentId)
          deleteSnapshotsForDocument(snapshotStore, oldDocumentId)
          documentStore.put(replacement)
          metaStore.put(replacement.id, activeDocumentMetaKey(workspaceId))
        }

        workspaceRequest.onsuccess = () => {
          try {
            const raw = workspaceRequest.result
            if (raw === undefined) throw new Error(`Workspace not found: ${workspaceId}`)
            const workspace = validateWorkspaceRecord(raw)
            if (workspace.storageMode !== 'local-library') throw new Error(`Workspace is not Local Library: ${workspaceId}`)
          } catch (error) {
            valid = false
            validationError = error instanceof Error ? error : new Error(String(error))
          }
          completeValidation()
        }
        oldRequest.onsuccess = () => {
          const raw = oldRequest.result
          if (raw === undefined) {
            valid = false
            validationError = new Error(`Document not found: ${oldDocumentId}`)
          } else {
            try {
              const oldDocument = validateDocumentRecord(raw)
              if (oldDocument.workspaceId !== workspaceId) throw new Error(`Document not found in workspace: ${oldDocumentId}`)
            } catch (error) {
              valid = false
              validationError = error instanceof Error ? error : new Error(String(error))
            }
          }
          completeValidation()
        }
        if (replacementRequest !== undefined) {
          replacementRequest.onsuccess = () => {
            if (replacementRequest.result !== undefined) {
              valid = false
              validationError = new Error(`Replacement document already exists: ${replacement.id}`)
            }
            completeValidation()
          }
        }

        await done
      } catch (error) {
        if (validationError !== undefined) throw validationError
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
        STORE_META,
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
        tx.objectStore(STORE_META).delete(activeDocumentMetaKey(workspaceId))

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
          tx.objectStore(STORE_META).delete(activeDocumentMetaKey(workspaceId))

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

    async enableLocalLibrary(workspaceId, documentValues, activeDocumentId) {
      const documents = documentValues.map(validateDocumentRecord)
      const ids = new Set<string>()
      for (const document of documents) {
        if (document.workspaceId !== workspaceId) {
          throw new Error('document.workspaceId must match the target workspace')
        }
        if (ids.has(document.id)) throw new Error(`Duplicate document ID: ${document.id}`)
        ids.add(document.id)
      }
      if (!ids.has(activeDocumentId)) {
        throw new Error('activeDocumentId must reference one of the supplied documents')
      }

      const tx = db.transaction([STORE_WORKSPACES, STORE_WORKSPACE_DOCUMENTS, STORE_META], 'readwrite')
      const done = transactionDone(tx)
      const workspaceStore = tx.objectStore(STORE_WORKSPACES)
      const documentStore = tx.objectStore(STORE_WORKSPACE_DOCUMENTS)
      const metaStore = tx.objectStore(STORE_META)
      let validationError: Error | undefined

      try {
        const workspaceRequest = workspaceStore.get(workspaceId)
        const collisionRequests = documents.map((document) => documentStore.get(document.id))
        let pending = collisionRequests.length + 1
        let valid = true

        const completeValidation = () => {
          pending -= 1
          if (pending !== 0) return
          if (!valid) {
            tx.abort()
            return
          }
          const raw = workspaceRequest.result
          if (raw === undefined) {
            validationError = new Error(`Workspace not found: ${workspaceId}`)
            tx.abort()
            return
          }
          try {
            const workspace = validateWorkspaceRecord(raw)
            if (workspace.storageMode === 'file-backed') throw new Error('file-backed workspace cannot enable Local Library')
            workspaceStore.put({ ...workspace, storageMode: 'local-library', updatedAt: now() })
            for (const document of documents) documentStore.put(document)
            metaStore.put(activeDocumentId, activeDocumentMetaKey(workspaceId))
          } catch (error) {
            validationError = error instanceof Error ? error : new Error(String(error))
            tx.abort()
          }
        }

        workspaceRequest.onsuccess = completeValidation
        for (let index = 0; index < collisionRequests.length; index += 1) {
          const request = collisionRequests[index]!
          const document = documents[index]!
          request.onsuccess = () => {
            if (request.result !== undefined) {
              try {
                const existing = validateDocumentRecord(request.result)
                if (existing.workspaceId !== workspaceId) {
                  valid = false
                  validationError = new Error(`Document ID belongs to another workspace: ${document.id}`)
                }
              } catch (error) {
                valid = false
                validationError = error instanceof Error ? error : new Error(String(error))
              }
            }
            completeValidation()
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
        STORE_META,
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
      const metaStore = tx.objectStore(STORE_META)
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
          metaStore.delete(activeDocumentMetaKey(workspaceId))
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
