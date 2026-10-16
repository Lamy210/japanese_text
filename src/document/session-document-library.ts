import type { EditableDocument } from './types'

export interface SessionDocumentLibrarySnapshot {
  documents: EditableDocument[]
  activeDocumentId: string
}

export interface SessionDocumentLibraryStore {
  list(workspaceId: string): EditableDocument[]
  get(workspaceId: string, documentId: string): EditableDocument | undefined
  getActiveDocumentId(workspaceId: string): string | undefined
  save(document: EditableDocument): void
  setActiveDocumentId(workspaceId: string, documentId: string): void
  delete(workspaceId: string, documentId: string): void
  replaceWorkspace(workspaceId: string, snapshot: SessionDocumentLibrarySnapshot): void
  deleteWorkspace(workspaceId: string): void
  clear(): void
}

interface WorkspaceDocuments {
  documents: Map<string, EditableDocument>
  activeDocumentId?: string
}

function cloneDocument(document: EditableDocument): EditableDocument {
  return structuredClone(document)
}

function cloneWorkspace(value: WorkspaceDocuments | undefined): WorkspaceDocuments {
  if (value === undefined) return { documents: new Map() }
  return {
    documents: new Map(
      [...value.documents.entries()].map(([id, document]) => [id, cloneDocument(document)])
    ),
    ...(value.activeDocumentId === undefined ? {} : { activeDocumentId: value.activeDocumentId })
  }
}

function assertId(label: string, value: string): void {
  if (value.length === 0) throw new Error(`${label} must not be empty`)
}

export function createSessionDocumentLibraryStore(): SessionDocumentLibraryStore {
  const workspaces = new Map<string, WorkspaceDocuments>()

  return {
    list(workspaceId) {
      assertId('workspaceId', workspaceId)
      return [...(workspaces.get(workspaceId)?.documents.values() ?? [])].map(cloneDocument)
    },

    get(workspaceId, documentId) {
      assertId('workspaceId', workspaceId)
      assertId('documentId', documentId)
      const document = workspaces.get(workspaceId)?.documents.get(documentId)
      return document === undefined ? undefined : cloneDocument(document)
    },

    getActiveDocumentId(workspaceId) {
      assertId('workspaceId', workspaceId)
      return workspaces.get(workspaceId)?.activeDocumentId
    },

    save(document) {
      assertId('workspaceId', document.workspaceId)
      assertId('documentId', document.id)
      const next = cloneWorkspace(workspaces.get(document.workspaceId))
      next.documents.set(document.id, cloneDocument(document))
      workspaces.set(document.workspaceId, next)
    },

    setActiveDocumentId(workspaceId, documentId) {
      assertId('workspaceId', workspaceId)
      assertId('documentId', documentId)
      const current = workspaces.get(workspaceId)
      if (current?.documents.has(documentId) !== true) {
        throw new Error(`Document not found in workspace ${workspaceId}: ${documentId}`)
      }
      const next = cloneWorkspace(current)
      next.activeDocumentId = documentId
      workspaces.set(workspaceId, next)
    },

    delete(workspaceId, documentId) {
      assertId('workspaceId', workspaceId)
      assertId('documentId', documentId)
      const current = workspaces.get(workspaceId)
      if (current === undefined) return
      const next = cloneWorkspace(current)
      next.documents.delete(documentId)
      if (next.activeDocumentId === documentId) delete next.activeDocumentId
      if (next.documents.size === 0 && next.activeDocumentId === undefined) {
        workspaces.delete(workspaceId)
      } else {
        workspaces.set(workspaceId, next)
      }
    },

    replaceWorkspace(workspaceId, snapshot) {
      assertId('workspaceId', workspaceId)
      assertId('activeDocumentId', snapshot.activeDocumentId)

      const nextDocuments = new Map<string, EditableDocument>()
      for (const document of snapshot.documents) {
        if (document.workspaceId !== workspaceId) {
          throw new Error('snapshot document workspaceId must match target workspace')
        }
        assertId('documentId', document.id)
        if (nextDocuments.has(document.id)) {
          throw new Error(`Duplicate document ID in snapshot: ${document.id}`)
        }
        nextDocuments.set(document.id, cloneDocument(document))
      }

      if (!nextDocuments.has(snapshot.activeDocumentId)) {
        throw new Error('activeDocumentId must reference a document in the snapshot')
      }

      workspaces.set(workspaceId, {
        documents: nextDocuments,
        activeDocumentId: snapshot.activeDocumentId
      })
    },

    deleteWorkspace(workspaceId) {
      assertId('workspaceId', workspaceId)
      workspaces.delete(workspaceId)
    },

    clear() {
      workspaces.clear()
    }
  }
}
