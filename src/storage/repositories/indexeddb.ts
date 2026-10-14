import {
  validateDocumentRecord,
  validatePreferencesRecord,
  validateRuleProfileRecord,
  validateWorkspaceRecord
} from '../../core/workspace/validate'
import { requestToPromise, transactionDone } from '../db/idb-utils'
import {
  INDEX_WORKSPACE_ID,
  META_ACTIVE_WORKSPACE_ID,
  STORE_META,
  STORE_PREFERENCES,
  STORE_RULE_PROFILES,
  STORE_WORKSPACE_DOCUMENTS,
  STORE_WORKSPACES
} from '../db/schema'
import type { StorageRepositories } from './ports'

const GLOBAL_PREFERENCES_KEY = 'global'

async function completeRequest<T>(tx: IDBTransaction, request: IDBRequest<T>): Promise<T> {
  const done = transactionDone(tx)
  const result = await requestToPromise(request)
  await done
  return result
}

export function createIndexedDbRepositories(db: IDBDatabase): StorageRepositories {
  return {
    workspaces: {
      async list() {
        const tx = db.transaction(STORE_WORKSPACES, 'readonly')
        const raw = await completeRequest(tx, tx.objectStore(STORE_WORKSPACES).getAll())
        return raw.map(validateWorkspaceRecord)
      },
      async get(id) {
        const tx = db.transaction(STORE_WORKSPACES, 'readonly')
        const raw = await completeRequest(tx, tx.objectStore(STORE_WORKSPACES).get(id))
        return raw === undefined ? undefined : validateWorkspaceRecord(raw)
      },
      async save(value) {
        const validated = validateWorkspaceRecord(value)
        const tx = db.transaction(STORE_WORKSPACES, 'readwrite')
        await completeRequest(tx, tx.objectStore(STORE_WORKSPACES).put(validated))
      },
      async delete(id) {
        const tx = db.transaction(STORE_WORKSPACES, 'readwrite')
        await completeRequest(tx, tx.objectStore(STORE_WORKSPACES).delete(id))
      }
    },

    selection: {
      async getActiveWorkspaceId() {
        const tx = db.transaction(STORE_META, 'readonly')
        const raw = await completeRequest(tx, tx.objectStore(STORE_META).get(META_ACTIVE_WORKSPACE_ID))
        return typeof raw === 'string' && raw.length > 0 ? raw : undefined
      },
      async setActiveWorkspaceId(workspaceId) {
        if (workspaceId.length === 0) throw new Error('workspaceId must not be empty')
        const tx = db.transaction(STORE_META, 'readwrite')
        await completeRequest(tx, tx.objectStore(STORE_META).put(workspaceId, META_ACTIVE_WORKSPACE_ID))
      }
    },

    preferences: {
      async get() {
        const tx = db.transaction(STORE_PREFERENCES, 'readonly')
        const raw = await completeRequest(tx, tx.objectStore(STORE_PREFERENCES).get(GLOBAL_PREFERENCES_KEY))
        return raw === undefined ? undefined : validatePreferencesRecord(raw)
      },
      async save(value) {
        const validated = validatePreferencesRecord(value)
        const tx = db.transaction(STORE_PREFERENCES, 'readwrite')
        await completeRequest(tx, tx.objectStore(STORE_PREFERENCES).put(validated, GLOBAL_PREFERENCES_KEY))
      }
    },

    profiles: {
      async list() {
        const tx = db.transaction(STORE_RULE_PROFILES, 'readonly')
        const raw = await completeRequest(tx, tx.objectStore(STORE_RULE_PROFILES).getAll())
        return raw.map(validateRuleProfileRecord)
      },
      async get(id) {
        const tx = db.transaction(STORE_RULE_PROFILES, 'readonly')
        const raw = await completeRequest(tx, tx.objectStore(STORE_RULE_PROFILES).get(id))
        return raw === undefined ? undefined : validateRuleProfileRecord(raw)
      },
      async save(value) {
        const validated = validateRuleProfileRecord(value)
        const tx = db.transaction(STORE_RULE_PROFILES, 'readwrite')
        await completeRequest(tx, tx.objectStore(STORE_RULE_PROFILES).put(validated))
      },
      async delete(id) {
        const tx = db.transaction(STORE_RULE_PROFILES, 'readwrite')
        await completeRequest(tx, tx.objectStore(STORE_RULE_PROFILES).delete(id))
      }
    },

    documents: {
      async listByWorkspace(workspaceId) {
        const tx = db.transaction(STORE_WORKSPACE_DOCUMENTS, 'readonly')
        const store = tx.objectStore(STORE_WORKSPACE_DOCUMENTS)
        const raw = await completeRequest(tx, store.index(INDEX_WORKSPACE_ID).getAll(workspaceId))
        return raw.map(validateDocumentRecord)
      },
      async get(id) {
        const tx = db.transaction(STORE_WORKSPACE_DOCUMENTS, 'readonly')
        const raw = await completeRequest(tx, tx.objectStore(STORE_WORKSPACE_DOCUMENTS).get(id))
        return raw === undefined ? undefined : validateDocumentRecord(raw)
      },
      async save(value) {
        const validated = validateDocumentRecord(value)
        const tx = db.transaction(STORE_WORKSPACE_DOCUMENTS, 'readwrite')
        await completeRequest(tx, tx.objectStore(STORE_WORKSPACE_DOCUMENTS).put(validated))
      },
      async delete(id) {
        const tx = db.transaction(STORE_WORKSPACE_DOCUMENTS, 'readwrite')
        await completeRequest(tx, tx.objectStore(STORE_WORKSPACE_DOCUMENTS).delete(id))
      }
    }
  }
}
