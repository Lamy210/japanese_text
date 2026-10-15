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

export function createMemoryStorageContext(now: () => number = Date.now): MemoryStorageContext {
  let workspaces = new Map<string, Workspace>()
  let profiles = new Map<string, RuleProfile>()
  let documents = new Map<string, StoredWorkspaceDocument>()
  let documentSelections = new Map<string, string>()
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
    documentSelection: {
      async getActiveDocumentId(workspaceId) {
        if (workspaceId.length === 0) throw new Error('workspaceId must not be empty')
        return documentSelections.get(workspaceId)
      },
      async setActiveDocumentId(workspaceId, documentId) {
        if (workspaceId.length === 0) throw new Error('workspaceId must not be empty')
        if (documentId.length === 0) throw new Error('documentId must not be empty')
        documentSelections.set(workspaceId, documentId)
      },
      async deleteActiveDocumentId(workspaceId) {
        if (workspaceId.length === 0) throw new Error('workspaceId must not be empty')
        documentSelections.delete(workspaceId)
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
    async createWorkspaceAndActivate(workspace, profile) {
      const validatedWorkspace = clone(validateWorkspaceRecord(workspace))
      const validatedProfile = clone(validateRuleProfileRecord(profile))
      if (validatedWorkspace.activeRuleProfileId !== validatedProfile.id) {
        throw new Error('workspace.activeRuleProfileId must reference the created profile')
      }

      const nextWorkspaces = cloneMap(workspaces)
      const nextProfiles = cloneMap(profiles)
      nextWorkspaces.set(validatedWorkspace.id, validatedWorkspace)
      nextProfiles.set(validatedProfile.id, validatedProfile)

      workspaces = nextWorkspaces
      profiles = nextProfiles
      activeWorkspaceId = validatedWorkspace.id
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
    },
    async deleteWorkspaceAndSelectNext(workspaceId, nextWorkspaceId) {
      if (workspaceId === nextWorkspaceId) throw new Error('next workspace must differ from deleted workspace')
      if (!workspaces.has(nextWorkspaceId)) throw new Error(`Next workspace not found: ${nextWorkspaceId}`)

      const nextWorkspaces = cloneMap(workspaces)
      const nextDocuments = cloneMap(documents)
      nextWorkspaces.delete(workspaceId)
      for (const [id, document] of nextDocuments) {
        if (document.workspaceId === workspaceId) nextDocuments.delete(id)
      }

      workspaces = nextWorkspaces
      documents = nextDocuments
      activeWorkspaceId = nextWorkspaceId
    },
    async enableLocalLibrary(workspaceId, documentValue) {
      const workspace = workspaces.get(workspaceId)
      if (workspace === undefined) throw new Error(`Workspace not found: ${workspaceId}`)
      const document = clone(validateDocumentRecord(documentValue))
      if (document.workspaceId !== workspaceId) {
        throw new Error('document.workspaceId must match the target workspace')
      }

      const nextWorkspaces = cloneMap(workspaces)
      const nextDocuments = cloneMap(documents)
      nextWorkspaces.set(workspaceId, {
        ...clone(workspace),
        storageMode: 'local-library',
        updatedAt: now()
      })
      nextDocuments.set(document.id, document)

      workspaces = nextWorkspaces
      documents = nextDocuments
    },
    async makeWorkspacePrivate(workspaceId) {
      const workspace = workspaces.get(workspaceId)
      if (workspace === undefined) throw new Error(`Workspace not found: ${workspaceId}`)

      const nextWorkspaces = cloneMap(workspaces)
      const nextDocuments = cloneMap(documents)
      nextWorkspaces.set(workspaceId, {
        ...clone(workspace),
        storageMode: 'private-session',
        updatedAt: now()
      })
      for (const [id, document] of nextDocuments) {
        if (document.workspaceId === workspaceId) nextDocuments.delete(id)
      }

      workspaces = nextWorkspaces
      documents = nextDocuments
    }
  }

  return { repositories, atomicOperations }
}
