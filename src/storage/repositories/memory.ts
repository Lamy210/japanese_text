/**
 * In-memory implementation of the Phase 2A storage ports.
 *
 * This is the non-durable fallback when IndexedDB is unavailable or cannot be opened.
 * Read/write boundaries are cloned so callers cannot mutate repository state by reference.
 */
import {
  validateDocumentRecord,
  validateDocumentSnapshotRecord,
  validatePreferencesRecord,
  validateRuleProfileRecord,
  validateWorkspaceRecord
} from '../../core/workspace/validate'
import type {
  DocumentSnapshot,
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

function requireLocalWorkspace(workspaces: Map<string, Workspace>, workspaceId: string): Workspace {
  const workspace = workspaces.get(workspaceId)
  if (workspace === undefined) throw new Error(`Workspace not found: ${workspaceId}`)
  if (workspace.storageMode !== 'local-library') {
    throw new Error(`Workspace is not Local Library: ${workspaceId}`)
  }
  return workspace
}

export interface MemoryStorageContext {
  repositories: StorageRepositories
  atomicOperations: AtomicOperationsPort
}

export function createMemoryStorageContext(now: () => number = Date.now): MemoryStorageContext {
  let workspaces = new Map<string, Workspace>()
  let profiles = new Map<string, RuleProfile>()
  let documents = new Map<string, StoredWorkspaceDocument>()
  let snapshots = new Map<string, DocumentSnapshot>()
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
    },
    snapshots: {
      async listByDocument(documentId) {
        if (documentId.length === 0) throw new Error('documentId must not be empty')
        return [...snapshots.values()]
          .filter((snapshot) => snapshot.documentId === documentId)
          .map((snapshot) => clone(validateDocumentSnapshotRecord(snapshot)))
          .sort((a, b) => b.createdAt - a.createdAt || b.revision - a.revision || a.id.localeCompare(b.id))
      },
      async get(id) {
        if (id.length === 0) throw new Error('snapshot id must not be empty')
        const value = snapshots.get(id)
        return value === undefined ? undefined : clone(validateDocumentSnapshotRecord(value))
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
    async createDocumentAndActivate(documentValue) {
      const document = clone(validateDocumentRecord(documentValue))
      requireLocalWorkspace(workspaces, document.workspaceId)
      const existing = documents.get(document.id)
      if (existing !== undefined) {
        throw new Error(`Document already exists: ${document.id}`)
      }

      const nextDocuments = cloneMap(documents)
      const nextSelections = new Map(documentSelections)
      nextDocuments.set(document.id, document)
      nextSelections.set(document.workspaceId, document.id)

      documents = nextDocuments
      documentSelections = nextSelections
    },
    async deleteDocumentAndSelectNext(workspaceId, documentId, nextDocumentId) {
      requireLocalWorkspace(workspaces, workspaceId)
      if (documentId === nextDocumentId) throw new Error('next document must differ from deleted document')
      const target = documents.get(documentId)
      const successor = documents.get(nextDocumentId)
      if (target?.workspaceId !== workspaceId) throw new Error(`Document not found in workspace: ${documentId}`)
      if (successor?.workspaceId !== workspaceId) {
        throw new Error(`Next document not found in workspace: ${nextDocumentId}`)
      }

      const nextDocuments = cloneMap(documents)
      const nextSelections = new Map(documentSelections)
      nextDocuments.delete(documentId)
      nextSelections.set(workspaceId, nextDocumentId)

      documents = nextDocuments
      documentSelections = nextSelections
    },
    async replaceLastDocument(workspaceId, oldDocumentId, replacementValue) {
      requireLocalWorkspace(workspaces, workspaceId)
      const oldDocument = documents.get(oldDocumentId)
      if (oldDocument?.workspaceId !== workspaceId) {
        throw new Error(`Document not found in workspace: ${oldDocumentId}`)
      }
      const replacement = clone(validateDocumentRecord(replacementValue))
      if (replacement.workspaceId !== workspaceId) {
        throw new Error('replacement.workspaceId must match the target workspace')
      }
      const collision = documents.get(replacement.id)
      if (collision !== undefined && collision.id !== oldDocumentId) {
        throw new Error(`Replacement document already exists: ${replacement.id}`)
      }

      const nextDocuments = cloneMap(documents)
      const nextSelections = new Map(documentSelections)
      nextDocuments.delete(oldDocumentId)
      nextDocuments.set(replacement.id, replacement)
      nextSelections.set(workspaceId, replacement.id)

      documents = nextDocuments
      documentSelections = nextSelections
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
      const nextSelections = new Map(documentSelections)

      nextWorkspaces.delete(workspaceId)
      nextSelections.delete(workspaceId)
      for (const [id, document] of nextDocuments) {
        if (document.workspaceId === workspaceId) nextDocuments.delete(id)
      }

      workspaces = nextWorkspaces
      documents = nextDocuments
      documentSelections = nextSelections
    },
    async deleteWorkspaceAndSelectNext(workspaceId, nextWorkspaceId) {
      if (workspaceId === nextWorkspaceId) throw new Error('next workspace must differ from deleted workspace')
      if (!workspaces.has(nextWorkspaceId)) throw new Error(`Next workspace not found: ${nextWorkspaceId}`)

      const nextWorkspaces = cloneMap(workspaces)
      const nextDocuments = cloneMap(documents)
      const nextSelections = new Map(documentSelections)
      nextWorkspaces.delete(workspaceId)
      nextSelections.delete(workspaceId)
      for (const [id, document] of nextDocuments) {
        if (document.workspaceId === workspaceId) nextDocuments.delete(id)
      }

      workspaces = nextWorkspaces
      documents = nextDocuments
      documentSelections = nextSelections
      activeWorkspaceId = nextWorkspaceId
    },
    async enableLocalLibrary(workspaceId, documentValues, activeDocumentId) {
      const workspace = workspaces.get(workspaceId)
      if (workspace === undefined) throw new Error(`Workspace not found: ${workspaceId}`)
      if (workspace.storageMode === 'file-backed') throw new Error('file-backed workspace cannot enable Local Library')

      const validatedDocuments = documentValues.map((value) => clone(validateDocumentRecord(value)))
      const seen = new Set<string>()
      for (const document of validatedDocuments) {
        if (document.workspaceId !== workspaceId) {
          throw new Error('document.workspaceId must match the target workspace')
        }
        if (seen.has(document.id)) throw new Error(`Duplicate document ID: ${document.id}`)
        seen.add(document.id)
        const existing = documents.get(document.id)
        if (existing !== undefined && existing.workspaceId !== workspaceId) {
          throw new Error(`Document ID belongs to another workspace: ${document.id}`)
        }
      }
      if (!seen.has(activeDocumentId)) {
        throw new Error('activeDocumentId must reference one of the supplied documents')
      }

      const nextWorkspaces = cloneMap(workspaces)
      const nextDocuments = cloneMap(documents)
      const nextSelections = new Map(documentSelections)
      nextWorkspaces.set(workspaceId, {
        ...clone(workspace),
        storageMode: 'local-library',
        updatedAt: now()
      })
      for (const [id, document] of nextDocuments) {
        if (document.workspaceId === workspaceId) nextDocuments.delete(id)
      }
      for (const document of validatedDocuments) nextDocuments.set(document.id, document)
      nextSelections.set(workspaceId, activeDocumentId)

      workspaces = nextWorkspaces
      documents = nextDocuments
      documentSelections = nextSelections
    },
    async makeWorkspacePrivate(workspaceId) {
      const workspace = workspaces.get(workspaceId)
      if (workspace === undefined) throw new Error(`Workspace not found: ${workspaceId}`)

      const nextWorkspaces = cloneMap(workspaces)
      const nextDocuments = cloneMap(documents)
      const nextSelections = new Map(documentSelections)
      nextWorkspaces.set(workspaceId, {
        ...clone(workspace),
        storageMode: 'private-session',
        updatedAt: now()
      })
      for (const [id, document] of nextDocuments) {
        if (document.workspaceId === workspaceId) nextDocuments.delete(id)
      }
      nextSelections.delete(workspaceId)

      workspaces = nextWorkspaces
      documents = nextDocuments
      documentSelections = nextSelections
    }
  }

  return { repositories, atomicOperations }
}
