import type { DocumentType } from '../core/types'

export interface EditableDocument {
  id: string
  workspaceId: string
  name: string
  docType: DocumentType
  content: string
  sourceKind: 'local' | 'file'
  createdAt: number
  updatedAt: number
}

export interface DocumentSummary extends Omit<EditableDocument, 'content'> {
  active: boolean
}

export interface RecoveryDocumentState {
  kind: 'ephemeral-recovery'
  workspaceId: string
  name: 'recovery.md'
  content: ''
  docType: 'markdown'
}

export type DocumentState = EditableDocument | RecoveryDocumentState

export interface DocumentContext {
  document: DocumentState
  summaries: DocumentSummary[]
  warning?: string
}

export interface DocumentDeleteResult extends DocumentContext {
  deletedDocumentId: string
}

/** On-demand body-search hit. Offsets refer to UTF-16 positions in the original document. */
export interface DocumentSearchHit {
  workspaceId: string
  documentId: string
  name: string
  start: number
  end: number
  preview: string
}
