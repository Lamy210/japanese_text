import type { AtomicOperationsPort } from '../repositories/ports'
import { requestToPromise, transactionDone } from './idb-utils'
import { migrateV1ToV2 } from './migration-v1-v2'
import {
  STORE_DOCUMENT_SNAPSHOTS,
  STORE_SUPPRESSIONS,
  STORE_WORKSPACE_DOCUMENTS,
  STORE_WORKSPACES
} from './schema'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function createIndexedDbAtomicOperations(
  db: IDBDatabase,
  now: () => number = Date.now
): AtomicOperationsPort {
  return {
    migrateV1ToV2() {
      return migrateV1ToV2(db, now)
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
        const [documents, snapshots, suppressions] = await Promise.all([
          requestToPromise(documentStore.getAll()),
          requestToPromise(snapshotStore.getAll()),
          requestToPromise(suppressionStore.getAll())
        ])

        const documentIds = new Set<string>()
        for (const raw of documents) {
          if (isRecord(raw) && raw.workspaceId === workspaceId && typeof raw.id === 'string') {
            documentIds.add(raw.id)
            documentStore.delete(raw.id)
          }
        }

        for (const raw of snapshots) {
          if (
            isRecord(raw) &&
            typeof raw.id === 'string' &&
            typeof raw.documentId === 'string' &&
            documentIds.has(raw.documentId)
          ) {
            snapshotStore.delete(raw.id)
          }
        }

        for (const raw of suppressions) {
          if (!isRecord(raw) || typeof raw.id !== 'string') continue
          const workspaceScoped = raw.scope === 'workspace' && raw.scopeId === workspaceId
          const documentScoped = raw.scope === 'document' && typeof raw.scopeId === 'string' && documentIds.has(raw.scopeId)
          if (workspaceScoped || documentScoped) suppressionStore.delete(raw.id)
        }

        tx.objectStore(STORE_WORKSPACES).delete(workspaceId)
        await done
      } catch (error) {
        try {
          tx.abort()
        } catch {
          // Transaction may already have failed.
        }
        try {
          await done
        } catch {
          // Preserve original operation error.
        }
        throw error
      }
    }
  }
}
