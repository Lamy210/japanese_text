/**
 * In-memory implementation of the Phase 2A storage ports.
 *
 * This is the non-durable fallback when IndexedDB is unavailable or cannot be opened.
 * Read/write boundaries are cloned so callers cannot mutate repository state by reference.
 */
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
  let activeWorkspaceId: string | undefined

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
    selection: {
      async getActiveWorkspaceId() {
        return activeWorkspaceId
      },
      async setActiveWorkspaceId(workspaceId) {
        if (workspaceId.length === 0) throw new Error('workspaceId must not be empty')
        activeWorkspaceId = workspaceId
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
    async saveProjectedState(value) {
      const validatedPreferences = clone(validatePreferencesRecord(value.preferences))
      const validatedProfile = clone(validateRuleProfileRecord(value.profile))
      const validatedWorkspace = clone(validateWorkspaceRecord(value.workspace))
      const nextWorkspaces = cloneMap(workspaces)
      const nextProfiles = cloneMap(profiles)

      nextWorkspaces.set(validatedWorkspace.id, validatedWorkspace)
      nextProfiles.set(validatedProfile.id, validatedProfile)

      preferences = validatedPreferences
      profiles = nextProfiles
      workspaces = nextWorkspaces
    },
    async deletePersistedDocuments(workspaceId) {
      const nextDocuments = cloneMap(documents)
      for (const [id, document] of nextDocuments) {
        if (document.workspaceId === workspaceId) nextDocuments.delete(id)
      }
      documents = nextDocuments
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
