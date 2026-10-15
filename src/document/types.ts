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
