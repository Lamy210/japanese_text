import {
  validateDocumentRecord,
  validatePreferencesRecord,
  validateRuleProfileRecord,
  validateWorkspaceRecord
} from '../../core/workspace/validate'
import type {
  GlobalPreferences,
  RuleProfile,
  StoredWorkspaceDocument,
  Workspace
} from '../../core/workspace/types'
import type { AtomicOperationsPort, StorageRepositories } from './ports'

function clone<T>(value: T): T {
  return structuredClone(value)
}

function cloneMap<T>(source: Map<string, T>): Map<string, T> {
  return new Map([...source.entries()].map(([key, value]) => [key, clone(value)]))
}

export interface MemoryStorageContext {
  repositories: StorageRepositories
  atomicOperations: AtomicOperationsPort
}

export function createMemoryStorageContext(): MemoryStorageContext {
  let workspaces = new Map<string, Workspace>()
  let profiles = new Map<string, RuleProfile>()
  let documents = new Map<string, StoredWorkspaceDocument>()
  let preferences: GlobalPreferences | undefined

  const repositories: StorageRepositories = {
    workspaces: {
      async list() {
        return [...workspaces.values()].map(clone)
      },
      async get(id) {
        const value = workspaces.get(id)
        return value === undefined ? undefined : clone(value)
      },
      async save(value) {
        const validated = validateWorkspaceRecord(value)
        workspaces.set(validated.id, clone(validated))
      },
      async delete(id) {
        workspaces.delete(id)
      }
    },
    preferences: {
      async get() {
        return preferences === undefined ? undefined : clone(preferences)
      },
      async save(value) {
        preferences = clone(validatePreferencesRecord(value))
      }
    },
    profiles: {
      async list() {
        return [...profiles.values()].map(clone)
      },
      async get(id) {
        const value = profiles.get(id)
        return value === undefined ? undefined : clone(value)
      },
      async save(value) {
        const validated = validateRuleProfileRecord(value)
        profiles.set(validated.id, clone(validated))
      },
      async delete(id) {
        profiles.delete(id)
      }
    },
    documents: {
      async listByWorkspace(workspaceId) {
        return [...documents.values()]
          .filter((document) => document.workspaceId === workspaceId)
          .map(clone)
      },
      async get(id) {
        const value = documents.get(id)
        return value === undefined ? undefined : clone(value)
      },
      async save(value) {
        const validated = validateDocumentRecord(value)
        documents.set(validated.id, clone(validated))
      },
      async delete(id) {
        documents.delete(id)
      }
    }
  }

  const atomicOperations: AtomicOperationsPort = {
    async migrateV1ToV2() {
      return { state: 'not-needed' }
    },
    async deleteWorkspaceCascade(workspaceId) {
      const nextWorkspaces = cloneMap(workspaces)
      const nextDocuments = cloneMap(documents)

      nextWorkspaces.delete(workspaceId)
      for (const [id, document] of nextDocuments) {
        if (document.workspaceId === workspaceId) nextDocuments.delete(id)
      }

      workspaces = nextWorkspaces
      documents = nextDocuments
    }
  }

  return { repositories, atomicOperations }
}
