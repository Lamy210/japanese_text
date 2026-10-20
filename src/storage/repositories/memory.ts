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

function validateMaxSnapshots(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 1000) {
    throw new Error('maxSnapshots must be an integer between 1 and 1000')
  }
}

function snapshotsForDocument(
  values: Map<string, DocumentSnapshot>,
  documentId: string
): DocumentSnapshot[] {
  return [...values.values()]
    .filter((snapshot) => snapshot.documentId === documentId)
    .map(validateDocumentSnapshotRecord)
}

function latestSnapshot(values: Map<string, DocumentSnapshot>, documentId: string): DocumentSnapshot | undefined {
  return snapshotsForDocument(values, documentId)
    .sort((a, b) => b.revision - a.revision || b.createdAt - a.createdAt || a.id.localeCompare(b.id))[0]
}

function pruneSnapshots(
  values: Map<string, DocumentSnapshot>,
  documentId: string,
  maxSnapshots: number
): void {
  const ordered = snapshotsForDocument(values, documentId)
    .sort((a, b) => a.revision - b.revision || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  while (ordered.length > maxSnapshots) {
    const oldest = ordered.shift()
    if (oldest !== undefined) values.delete(oldest.id)
  }
}

function withoutDocumentSnapshots(
  source: Map<string, DocumentSnapshot>,
  documentIds: Iterable<string>
): Map<string, DocumentSnapshot> {
  const ids = new Set(documentIds)
  const next = cloneMap(source)
  for (const [snapshotId, snapshot] of next) {
    if (ids.has(snapshot.documentId)) next.delete(snapshotId)
  }
  return next
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
        return snapshotsForDocument(snapshots, documentId)
          .map(clone)
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
    async duplicateProfileAndActivate(workspaceId, profileValue) {
      const workspace = workspaces.get(workspaceId)
      if (workspace === undefined) throw new Error(`Workspace not found: ${workspaceId}`)
      const profile = clone(validateRuleProfileRecord(profileValue))
      if (profiles.has(profile.id)) throw new Error(`RuleProfile already exists: ${profile.id}`)
      const members = workspace.ruleProfileIds ?? [workspace.activeRuleProfileId]
      if (members.includes(profile.id)) throw new Error(`RuleProfile already belongs to workspace: ${profile.id}`)
      const nextWorkspaces = cloneMap(workspaces)
      const nextProfiles = cloneMap(profiles)
      nextProfiles.set(profile.id, profile)
      nextWorkspaces.set(workspaceId, clone(validateWorkspaceRecord({
        ...workspace, activeRuleProfileId: profile.id,
        ruleProfileIds: [...members, profile.id], updatedAt: now()
      })))
      profiles = nextProfiles
      workspaces = nextWorkspaces
    },
    async activateProfile(workspaceId, profileId) {
      const workspace = workspaces.get(workspaceId)
      if (workspace === undefined) throw new Error(`Workspace not found: ${workspaceId}`)
      const members = workspace.ruleProfileIds ?? [workspace.activeRuleProfileId]
      if (!members.includes(profileId)) throw new Error(`RuleProfile does not belong to workspace: ${profileId}`)
      if (!profiles.has(profileId)) throw new Error(`RuleProfile not found: ${profileId}`)
      const nextWorkspaces = cloneMap(workspaces)
      nextWorkspaces.set(workspaceId, clone(validateWorkspaceRecord({
        ...workspace, activeRuleProfileId: profileId, updatedAt: now()
      })))
      workspaces = nextWorkspaces
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
      const nextSnapshots = withoutDocumentSnapshots(snapshots, [documentId])
      nextDocuments.delete(documentId)
      nextSelections.set(workspaceId, nextDocumentId)

      documents = nextDocuments
      documentSelections = nextSelections
      snapshots = nextSnapshots
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
      const nextSnapshots = withoutDocumentSnapshots(snapshots, [oldDocumentId])
      nextDocuments.delete(oldDocumentId)
      nextDocuments.set(replacement.id, replacement)
      nextSelections.set(workspaceId, replacement.id)

      documents = nextDocuments
      documentSelections = nextSelections
      snapshots = nextSnapshots
    },
    async deletePersistedDocuments(workspaceId) {
      const nextDocuments = cloneMap(documents)
      const removedDocumentIds = new Set<string>()
      for (const [id, document] of nextDocuments) {
        if (document.workspaceId === workspaceId) {
          removedDocumentIds.add(id)
          nextDocuments.delete(id)
        }
      }
      const nextSnapshots = withoutDocumentSnapshots(snapshots, removedDocumentIds)
      documents = nextDocuments
      snapshots = nextSnapshots
    },
    async deleteWorkspaceCascade(workspaceId) {
      const nextWorkspaces = cloneMap(workspaces)
      const nextDocuments = cloneMap(documents)
      const nextSelections = new Map(documentSelections)
      const removedDocumentIds = new Set<string>()

      nextWorkspaces.delete(workspaceId)
      nextSelections.delete(workspaceId)
      for (const [id, document] of nextDocuments) {
        if (document.workspaceId === workspaceId) {
          removedDocumentIds.add(id)
          nextDocuments.delete(id)
        }
      }
      const nextSnapshots = withoutDocumentSnapshots(snapshots, removedDocumentIds)

      workspaces = nextWorkspaces
      documents = nextDocuments
      documentSelections = nextSelections
      snapshots = nextSnapshots
    },
    async deleteWorkspaceAndSelectNext(workspaceId, nextWorkspaceId) {
      if (workspaceId === nextWorkspaceId) throw new Error('next workspace must differ from deleted workspace')
      if (!workspaces.has(nextWorkspaceId)) throw new Error(`Next workspace not found: ${nextWorkspaceId}`)

      const nextWorkspaces = cloneMap(workspaces)
      const nextDocuments = cloneMap(documents)
      const nextSelections = new Map(documentSelections)
      const removedDocumentIds = new Set<string>()
      nextWorkspaces.delete(workspaceId)
      nextSelections.delete(workspaceId)
      for (const [id, document] of nextDocuments) {
        if (document.workspaceId === workspaceId) {
          removedDocumentIds.add(id)
          nextDocuments.delete(id)
        }
      }
      const nextSnapshots = withoutDocumentSnapshots(snapshots, removedDocumentIds)

      workspaces = nextWorkspaces
      documents = nextDocuments
      documentSelections = nextSelections
      snapshots = nextSnapshots
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
      const removedDocumentIds = new Set<string>()
      nextWorkspaces.set(workspaceId, {
        ...clone(workspace),
        storageMode: 'local-library',
        updatedAt: now()
      })
      for (const [id, document] of nextDocuments) {
        if (document.workspaceId === workspaceId) {
          removedDocumentIds.add(id)
          nextDocuments.delete(id)
        }
      }
      const nextSnapshots = withoutDocumentSnapshots(snapshots, removedDocumentIds)
      for (const document of validatedDocuments) nextDocuments.set(document.id, document)
      nextSelections.set(workspaceId, activeDocumentId)

      workspaces = nextWorkspaces
      documents = nextDocuments
      documentSelections = nextSelections
      snapshots = nextSnapshots
    },
    async makeWorkspacePrivate(workspaceId) {
      const workspace = workspaces.get(workspaceId)
      if (workspace === undefined) throw new Error(`Workspace not found: ${workspaceId}`)

      const nextWorkspaces = cloneMap(workspaces)
      const nextDocuments = cloneMap(documents)
      const nextSelections = new Map(documentSelections)
      const removedDocumentIds = new Set<string>()
      nextWorkspaces.set(workspaceId, {
        ...clone(workspace),
        storageMode: 'private-session',
        updatedAt: now()
      })
      for (const [id, document] of nextDocuments) {
        if (document.workspaceId === workspaceId) {
          removedDocumentIds.add(id)
          nextDocuments.delete(id)
        }
      }
      nextSelections.delete(workspaceId)
      const nextSnapshots = withoutDocumentSnapshots(snapshots, removedDocumentIds)

      workspaces = nextWorkspaces
      documents = nextDocuments
      documentSelections = nextSelections
      snapshots = nextSnapshots
    },
    async saveLocalDocumentIfActive(value) {
      const document = clone(validateDocumentRecord(value))
      const workspace = workspaces.get(document.workspaceId)
      const existing = documents.get(document.id)
      if (workspace?.storageMode !== 'local-library' ||
          existing === undefined || existing.workspaceId !== document.workspaceId) return false
      const nextDocuments = cloneMap(documents)
      nextDocuments.set(document.id, document)
      documents = nextDocuments
      return true
    },
    async captureSnapshot(input) {
      validateMaxSnapshots(input.maxSnapshots)
      const document = documents.get(input.documentId)
      if (document === undefined) throw new Error(`Document not found: ${input.documentId}`)

      const latest = latestSnapshot(snapshots, input.documentId)
      if (latest?.content === input.content) return { skippedDuplicate: true }
      if (snapshots.has(input.id)) throw new Error(`Snapshot already exists: ${input.id}`)

      const revision = (latest?.revision ?? 0) + 1
      const snapshot = validateDocumentSnapshotRecord({
        id: input.id,
        documentId: input.documentId,
        revision,
        content: input.content,
        reason: input.reason,
        createdAt: input.createdAt
      })
      const nextSnapshots = cloneMap(snapshots)
      nextSnapshots.set(snapshot.id, clone(snapshot))
      pruneSnapshots(nextSnapshots, input.documentId, input.maxSnapshots)
      snapshots = nextSnapshots
      return { snapshot: clone(snapshot), skippedDuplicate: false }
    },
    async restoreDocumentFromSnapshot(input) {
      validateMaxSnapshots(input.maxSnapshots)
      requireLocalWorkspace(workspaces, input.workspaceId)
      const document = documents.get(input.documentId)
      if (document === undefined || document.workspaceId !== input.workspaceId) {
        throw new Error(`Document not found in workspace: ${input.documentId}`)
      }
      const target = snapshots.get(input.snapshotId)
      if (target === undefined || target.documentId !== input.documentId) {
        throw new Error(`Snapshot not found for document ${input.documentId}: ${input.snapshotId}`)
      }
      const targetContent = target.content

      if (targetContent === input.currentContent) {
        return {
          document: clone(document),
          rollbackSnapshot: clone(validateDocumentSnapshotRecord(target)),
          createdRollbackSnapshot: false,
          noOp: true
        }
      }

      const nextSnapshots = cloneMap(snapshots)
      const latest = latestSnapshot(nextSnapshots, input.documentId)
      let rollbackSnapshot: DocumentSnapshot
      let createdRollbackSnapshot = false
      if (latest?.content === input.currentContent) {
        rollbackSnapshot = clone(latest)
      } else {
        if (nextSnapshots.has(input.beforeRestoreSnapshotId)) {
          throw new Error(`Snapshot already exists: ${input.beforeRestoreSnapshotId}`)
        }
        const revision = (latest?.revision ?? 0) + 1
        rollbackSnapshot = validateDocumentSnapshotRecord({
          id: input.beforeRestoreSnapshotId,
          documentId: input.documentId,
          revision,
          content: input.currentContent,
          reason: 'before-restore',
          createdAt: input.beforeRestoreCreatedAt
        })
        nextSnapshots.set(rollbackSnapshot.id, clone(rollbackSnapshot))
        createdRollbackSnapshot = true
      }
      pruneSnapshots(nextSnapshots, input.documentId, input.maxSnapshots)

      const restored = validateDocumentRecord({
        ...clone(document),
        content: targetContent,
        updatedAt: input.restoredUpdatedAt
      })
      const nextDocuments = cloneMap(documents)
      nextDocuments.set(restored.id, clone(restored))

      snapshots = nextSnapshots
      documents = nextDocuments
      return {
        document: clone(restored),
        rollbackSnapshot: clone(rollbackSnapshot),
        createdRollbackSnapshot,
        noOp: false
      }
    }
  }

  return { repositories, atomicOperations }
}
