import type { DocumentSnapshot, Workspace } from '../core/workspace/types'
import type { SessionSnapshotStore } from '../document/session-snapshot-store'
import type { EditableDocument } from '../document/types'
import type {
  AtomicOperationsPort,
  SnapshotCaptureResult,
  StorageRepositories
} from '../storage/repositories/ports'
import type { AutosaveSnapshotResult, SnapshotRestoreResult, SnapshotSummary } from './types'

const AUTOSAVE_INTERVAL_MS = 5 * 60 * 1000

export interface SnapshotServiceDependencies {
  repositories: StorageRepositories
  atomic: AtomicOperationsPort
  sessionSnapshots: SessionSnapshotStore
  now?: () => number
  generateId?: () => string
}

export interface SnapshotService {
  list(workspace: Workspace, documentId: string): Promise<SnapshotSummary[]>
  get(workspace: Workspace, documentId: string, snapshotId: string): Promise<DocumentSnapshot | undefined>
  capture(
    workspace: Workspace,
    document: EditableDocument,
    reason: 'manual' | 'before-format'
  ): Promise<SnapshotCaptureResult>
  captureAutosave(workspace: Workspace, document: EditableDocument): Promise<AutosaveSnapshotResult>
  restore(workspace: Workspace, document: EditableDocument, snapshotId: string): Promise<SnapshotRestoreResult>
}

function defaultGenerateId(): string {
  return `snapshot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function assertSupportedWorkspace(workspace: Workspace): void {
  if (workspace.storageMode === 'file-backed') {
    throw new Error('file-backed snapshot history is not supported in Phase 2C-B1')
  }
}

function assertDocumentWorkspace(workspace: Workspace, document: EditableDocument): void {
  if (document.workspaceId !== workspace.id) {
    throw new Error(`Document ${document.id} does not belong to workspace ${workspace.id}`)
  }
}

function snapshotPreview(content: string): string {
  const normalized = content.replace(/\s+/gu, ' ').trim()
  if (normalized.length === 0) return '(empty)'
  return [...normalized].slice(0, 160).join('')
}

function toSummary(snapshot: DocumentSnapshot): SnapshotSummary {
  return {
    id: snapshot.id,
    documentId: snapshot.documentId,
    revision: snapshot.revision,
    reason: snapshot.reason,
    createdAt: snapshot.createdAt,
    preview: snapshotPreview(snapshot.content)
  }
}

export function createSnapshotService(dependencies: SnapshotServiceDependencies): SnapshotService {
  const { repositories, atomic, sessionSnapshots } = dependencies
  const now = dependencies.now ?? Date.now
  const generateId = dependencies.generateId ?? defaultGenerateId
  const operationTails = new Map<string, Promise<void>>()
  const lastAutosaveAt = new Map<string, number>()

  async function serialize<T>(documentId: string, operation: () => Promise<T>): Promise<T> {
    const previous = operationTails.get(documentId) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.catch(() => undefined).then(() => gate)
    operationTails.set(documentId, tail)

    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
      if (operationTails.get(documentId) === tail) operationTails.delete(documentId)
    }
  }

  async function rawSnapshots(workspace: Workspace, documentId: string): Promise<DocumentSnapshot[]> {
    assertSupportedWorkspace(workspace)
    if (workspace.storageMode === 'private-session') {
      return sessionSnapshots.list(documentId)
    }
    return repositories.snapshots.listByDocument(documentId)
  }

  async function captureRaw(
    workspace: Workspace,
    document: EditableDocument,
    reason: 'autosave' | 'manual' | 'before-format'
  ): Promise<SnapshotCaptureResult> {
    const input = {
      id: generateId(),
      documentId: document.id,
      content: document.content,
      reason,
      createdAt: now(),
      maxSnapshots: workspace.snapshotPolicy.maxSnapshots
    } as const

    if (workspace.storageMode === 'private-session') {
      return sessionSnapshots.capture(input)
    }
    return atomic.captureSnapshot(input)
  }

  async function seededLastAutosaveAt(workspace: Workspace, documentId: string): Promise<number | undefined> {
    if (lastAutosaveAt.has(documentId)) return lastAutosaveAt.get(documentId)
    const existing = await rawSnapshots(workspace, documentId)
    const latest = existing
      .filter((snapshot) => snapshot.reason === 'autosave')
      .reduce<number | undefined>(
        (value, snapshot) => value === undefined ? snapshot.createdAt : Math.max(value, snapshot.createdAt),
        undefined
      )
    if (latest !== undefined) lastAutosaveAt.set(documentId, latest)
    return latest
  }

  return {
    async list(workspace, documentId) {
      return (await rawSnapshots(workspace, documentId))
        .sort((a, b) => b.createdAt - a.createdAt || b.revision - a.revision || a.id.localeCompare(b.id))
        .map(toSummary)
    },

    async get(workspace, documentId, snapshotId) {
      assertSupportedWorkspace(workspace)
      const snapshot = workspace.storageMode === 'private-session'
        ? sessionSnapshots.get(snapshotId)
        : await repositories.snapshots.get(snapshotId)
      if (snapshot === undefined || snapshot.documentId !== documentId) return undefined
      return structuredClone(snapshot)
    },

    capture(workspace, document, reason) {
      assertSupportedWorkspace(workspace)
      assertDocumentWorkspace(workspace, document)
      return serialize(document.id, async () => {
        if (!workspace.snapshotPolicy.enabled) return { skippedDuplicate: true }
        return captureRaw(workspace, document, reason)
      })
    },

    captureAutosave(workspace, document) {
      assertSupportedWorkspace(workspace)
      assertDocumentWorkspace(workspace, document)
      return serialize(document.id, async () => {
        if (!workspace.snapshotPolicy.enabled) return { skippedDuplicate: true }
        const timestamp = now()
        const last = await seededLastAutosaveAt(workspace, document.id)
        if (last !== undefined && timestamp - last < AUTOSAVE_INTERVAL_MS) {
          return { skippedThrottle: true }
        }

        const result = await captureRaw(workspace, document, 'autosave')
        if (result.snapshot !== undefined) lastAutosaveAt.set(document.id, result.snapshot.createdAt)
        return result
      })
    },

    restore(workspace, document, snapshotId) {
      assertSupportedWorkspace(workspace)
      assertDocumentWorkspace(workspace, document)
      return serialize(document.id, async () => {
        const timestamp = now()
        const beforeRestoreSnapshotId = generateId()

        if (workspace.storageMode === 'private-session') {
          const result = sessionSnapshots.restore({
            workspaceId: workspace.id,
            documentId: document.id,
            snapshotId,
            currentContent: document.content,
            restoredUpdatedAt: timestamp,
            beforeRestoreSnapshotId,
            beforeRestoreCreatedAt: timestamp,
            maxSnapshots: workspace.snapshotPolicy.maxSnapshots
          }, document)
          return {
            document: result.document,
            rollbackSnapshot: result.rollbackSnapshot,
            noOp: result.noOp
          }
        }

        const result = await atomic.restoreDocumentFromSnapshot({
          workspaceId: workspace.id,
          documentId: document.id,
          snapshotId,
          currentContent: document.content,
          restoredUpdatedAt: timestamp,
          beforeRestoreSnapshotId,
          beforeRestoreCreatedAt: timestamp,
          maxSnapshots: workspace.snapshotPolicy.maxSnapshots
        })
        return {
          document: {
            ...document,
            content: result.document.content ?? '',
            updatedAt: result.document.updatedAt
          },
          rollbackSnapshot: result.rollbackSnapshot,
          noOp: result.noOp
        }
      })
    }
  }
}
