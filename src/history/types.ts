import type { DocumentSnapshot, SnapshotReason } from '../core/workspace/types'
import type { EditableDocument } from '../document/types'
import type { SnapshotCaptureResult } from '../storage/repositories/ports'

export interface SnapshotSummary {
  id: string
  documentId: string
  revision: number
  reason: SnapshotReason
  createdAt: number
  preview: string
}

export type AutosaveSnapshotResult = SnapshotCaptureResult | { skippedThrottle: true }

export interface SnapshotRestoreResult {
  document: EditableDocument
  rollbackSnapshot?: DocumentSnapshot
  noOp: boolean
}
