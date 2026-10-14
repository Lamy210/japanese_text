import type { DocumentType } from '../core/types'

export interface SessionDocument {
  name: string
  content: string
  docType: DocumentType
  updatedAt: number
}

export interface SessionDocumentStore {
  get(workspaceId: string): SessionDocument | undefined
  set(workspaceId: string, document: SessionDocument): void
  delete(workspaceId: string): void
  clear(): void
}

function cloneDocument(document: SessionDocument): SessionDocument {
  return structuredClone(document)
}

/**
 * Per-tab transient document storage for private-session workspaces.
 * Nothing in this abstraction touches IndexedDB, localStorage, or sessionStorage.
 */
export function createSessionDocumentStore(): SessionDocumentStore {
  const documents = new Map<string, SessionDocument>()

  return {
    get(workspaceId) {
      const document = documents.get(workspaceId)
      return document === undefined ? undefined : cloneDocument(document)
    },
    set(workspaceId, document) {
      documents.set(workspaceId, cloneDocument(document))
    },
    delete(workspaceId) {
      documents.delete(workspaceId)
    },
    clear() {
      documents.clear()
    }
  }
}
