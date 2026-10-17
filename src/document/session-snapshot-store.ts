import { validateDocumentSnapshotRecord } from '../core/workspace/validate'
import type { DocumentSnapshot, SnapshotReason } from '../core/workspace/types'
import type { EditableDocument } from './types'

export interface SessionSnapshotCaptureInput {
  id: string
  documentId: string
  content: string
  reason: SnapshotReason
  createdAt: number
  maxSnapshots: number
}

export interface SessionSnapshotCaptureResult {
  snapshot?: DocumentSnapshot
  skippedDuplicate: boolean
}

export interface SessionSnapshotRestoreInput {
  workspaceId: string
  documentId: string
  snapshotId: string
  currentContent: string
  restoredUpdatedAt: number
  beforeRestoreSnapshotId: string
  beforeRestoreCreatedAt: number
  maxSnapshots: number
}

export interface SessionSnapshotRestoreResult {
  document: EditableDocument
  rollbackSnapshot: DocumentSnapshot
  createdRollbackSnapshot: boolean
  noOp: boolean
}

export interface SessionSnapshotStore {
  list(documentId: string): DocumentSnapshot[]
  get(snapshotId: string): DocumentSnapshot | undefined
  capture(input: SessionSnapshotCaptureInput): SessionSnapshotCaptureResult
  restore(input: SessionSnapshotRestoreInput, document: EditableDocument): SessionSnapshotRestoreResult
  deleteDocument(documentId: string): void
  deleteDocuments(documentIds: Iterable<string>): void
  clear(): void
}

function assertNonEmpty(label: string, value: string): void {
  if (value.length === 0) throw new Error(`${label} must not be empty`)
}

function assertMaxSnapshots(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 1000) {
    throw new Error('maxSnapshots must be an integer between 1 and 1000')
  }
}

function clone(snapshot: DocumentSnapshot): DocumentSnapshot {
  return structuredClone(snapshot)
}

function newestFirst(a: DocumentSnapshot, b: DocumentSnapshot): number {
  return b.createdAt - a.createdAt || b.revision - a.revision || a.id.localeCompare(b.id)
}

export function createSessionSnapshotStore(): SessionSnapshotStore {
  const snapshots = new Map<string, DocumentSnapshot>()
  const highWaterRevision = new Map<string, number>()

  function snapshotsFor(documentId: string): DocumentSnapshot[] {
    return [...snapshots.values()]
      .filter((snapshot) => snapshot.documentId === documentId)
      .sort(newestFirst)
  }

  function latestByRevision(documentId: string): DocumentSnapshot | undefined {
    let latest: DocumentSnapshot | undefined
    for (const snapshot of snapshots.values()) {
      if (snapshot.documentId !== documentId) continue
      if (latest === undefined || snapshot.revision > latest.revision) latest = snapshot
    }
    return latest
  }

  function prune(documentId: string, maxSnapshots: number): void {
    const values = [...snapshots.values()]
      .filter((snapshot) => snapshot.documentId === documentId)
      .sort((a, b) => a.revision - b.revision || a.id.localeCompare(b.id))
    while (values.length > maxSnapshots) {
      const oldest = values.shift()
      if (oldest !== undefined) snapshots.delete(oldest.id)
    }
  }

  const store: SessionSnapshotStore = {
    list(documentId) {
      assertNonEmpty('documentId', documentId)
      return snapshotsFor(documentId).map(clone)
    },

    get(snapshotId) {
      assertNonEmpty('snapshotId', snapshotId)
      const snapshot = snapshots.get(snapshotId)
      return snapshot === undefined ? undefined : clone(snapshot)
    },

    capture(input) {
      assertNonEmpty('snapshot id', input.id)
      assertNonEmpty('documentId', input.documentId)
      assertMaxSnapshots(input.maxSnapshots)
      if (snapshots.has(input.id)) throw new Error(`Snapshot already exists: ${input.id}`)

      const latest = latestByRevision(input.documentId)
      if (latest?.content === input.content) return { skippedDuplicate: true }

      const revision = (highWaterRevision.get(input.documentId) ?? 0) + 1
      const snapshot = validateDocumentSnapshotRecord({
        id: input.id,
        documentId: input.documentId,
        revision,
        content: input.content,
        reason: input.reason,
        createdAt: input.createdAt
      })

      snapshots.set(snapshot.id, clone(snapshot))
      highWaterRevision.set(input.documentId, revision)
      prune(input.documentId, input.maxSnapshots)
      return { snapshot: clone(snapshot), skippedDuplicate: false }
    },

    restore(input, document) {
      assertNonEmpty('workspaceId', input.workspaceId)
      assertNonEmpty('documentId', input.documentId)
      assertNonEmpty('snapshotId', input.snapshotId)
      assertMaxSnapshots(input.maxSnapshots)
      if (document.id !== input.documentId || document.workspaceId !== input.workspaceId) {
        throw new Error('Restore document identity does not match request')
      }

      const target = snapshots.get(input.snapshotId)
      if (target === undefined || target.documentId !== input.documentId) {
        throw new Error(`Snapshot not found for document ${input.documentId}: ${input.snapshotId}`)
      }
      const targetContent = target.content

      if (targetContent === input.currentContent) {
        return {
          document: structuredClone(document),
          rollbackSnapshot: clone(target),
          createdRollbackSnapshot: false,
          noOp: true
        }
      }

      const latest = latestByRevision(input.documentId)
      let rollbackSnapshot: DocumentSnapshot
      let createdRollbackSnapshot = false
      if (latest?.content === input.currentContent) {
        rollbackSnapshot = clone(latest)
      } else {
        const captured = store.capture({
          id: input.beforeRestoreSnapshotId,
          documentId: input.documentId,
          content: input.currentContent,
          reason: 'before-restore',
          createdAt: input.beforeRestoreCreatedAt,
          maxSnapshots: input.maxSnapshots
        })
        if (captured.snapshot === undefined) {
          const fallback = latestByRevision(input.documentId)
          if (fallback === undefined) throw new Error('Rollback snapshot could not be established')
          rollbackSnapshot = clone(fallback)
        } else {
          rollbackSnapshot = captured.snapshot
          createdRollbackSnapshot = true
        }
      }

      return {
        document: {
          ...structuredClone(document),
          content: targetContent,
          updatedAt: input.restoredUpdatedAt
        },
        rollbackSnapshot: clone(rollbackSnapshot),
        createdRollbackSnapshot,
        noOp: false
      }
    },

    deleteDocument(documentId) {
      assertNonEmpty('documentId', documentId)
      for (const [id, snapshot] of snapshots) {
        if (snapshot.documentId === documentId) snapshots.delete(id)
      }
      highWaterRevision.delete(documentId)
    },

    deleteDocuments(documentIds) {
      const ids = new Set(documentIds)
      for (const documentId of ids) store.deleteDocument(documentId)
    },

    clear() {
      snapshots.clear()
      highWaterRevision.clear()
    }
  }

  return store
}
