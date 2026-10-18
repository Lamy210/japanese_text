import type { DocumentType } from '../core/types'
import type { StoredWorkspaceDocument, Workspace } from '../core/workspace/types'
import type { AtomicOperationsPort, StorageRepositories } from '../storage/repositories/ports'
import { WELCOME_DOCUMENT } from '../state/welcome-document'
import type {
  SessionDocumentLibrarySnapshot,
  SessionDocumentLibraryStore
} from './session-document-library'
import type { SessionSnapshotStore } from './session-snapshot-store'
import type {
  DocumentContext,
  DocumentDeleteResult,
  DocumentSummary,
  EditableDocument,
  RecoveryDocumentState
} from './types'

export interface DocumentServiceDependencies {
  repositories: StorageRepositories
  atomic: AtomicOperationsPort
  sessionLibrary: SessionDocumentLibraryStore
  sessionSnapshots?: SessionSnapshotStore
  now?: () => number
  generateId?: () => string
}

export interface DocumentService {
  list(workspace: Workspace): Promise<DocumentSummary[]>
  resolveActive(workspace: Workspace): Promise<DocumentContext>
  create(
    workspace: Workspace,
    input?: Partial<Pick<EditableDocument, 'name' | 'docType' | 'content'>>
  ): Promise<DocumentContext>
  importDocument(
    workspace: Workspace,
    input: { name: string; docType: DocumentType; content: string }
  ): Promise<DocumentContext>
  rename(workspace: Workspace, documentId: string, name: string): Promise<DocumentContext>
  switchTo(
    workspace: Workspace,
    targetDocumentId: string,
    currentDocument: EditableDocument
  ): Promise<DocumentContext>
  save(workspace: Workspace, document: EditableDocument): Promise<void>
  delete(workspace: Workspace, documentId: string): Promise<DocumentDeleteResult>
  snapshotWorkspace(workspace: Workspace): Promise<SessionDocumentLibrarySnapshot>
}

function defaultGenerateId(): string {
  return `document-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizeDocumentName(raw: string): string {
  const name = raw.trim()
  if (name.length === 0) throw new Error('Document name must not be empty')
  if ([...name].length > 120) throw new Error('Document name must be 120 Unicode code points or fewer')
  if (/[\u0000-\u001f\u007f]/u.test(name)) throw new Error('Document name must not contain control characters')
  if (/[\\/]/u.test(name)) throw new Error('Document name must not contain path separators')
  return name
}

function stableDocumentOrder<T extends { createdAt: number; id: string }>(a: T, b: T): number {
  const byCreatedAt = a.createdAt - b.createdAt
  if (byCreatedAt !== 0) return byCreatedAt
  return a.id.localeCompare(b.id)
}

function legacyRepairOrder<T extends { updatedAt: number; id: string }>(a: T, b: T): number {
  const byUpdatedAt = b.updatedAt - a.updatedAt
  if (byUpdatedAt !== 0) return byUpdatedAt
  return a.id.localeCompare(b.id)
}

function toEditable(document: StoredWorkspaceDocument): { document: EditableDocument; warning?: string } {
  const missingContent = typeof document.content !== 'string'
  return {
    document: {
      id: document.id,
      workspaceId: document.workspaceId,
      name: document.name,
      docType: document.docType,
      content: missingContent ? '' : document.content!,
      sourceKind: document.sourceKind,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt
    },
    ...(missingContent ? { warning: `Document content was missing for ${document.id}; opened as empty text.` } : {})
  }
}

function toStored(document: EditableDocument): StoredWorkspaceDocument {
  return {
    id: document.id,
    workspaceId: document.workspaceId,
    name: document.name,
    docType: document.docType,
    content: document.content,
    sourceKind: document.sourceKind,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt
  }
}

function summariesOf(documents: EditableDocument[], activeDocumentId: string): DocumentSummary[] {
  return [...documents]
    .sort(stableDocumentOrder)
    .map(({ content: _content, ...document }) => ({
      ...document,
      active: document.id === activeDocumentId
    }))
}

function mergeWarnings(...warnings: Array<string | undefined>): string | undefined {
  const values = warnings.filter((value): value is string => value !== undefined && value.length > 0)
  return values.length === 0 ? undefined : values.join(' ')
}

function recoveryContext(workspaceId: string, warning: string): DocumentContext {
  const document: RecoveryDocumentState = {
    kind: 'ephemeral-recovery',
    workspaceId,
    name: 'recovery.md',
    content: '',
    docType: 'markdown'
  }
  return { document, summaries: [], warning }
}

function assertSupportedWorkspace(workspace: Workspace): void {
  if (workspace.storageMode === 'file-backed') {
    throw new Error('file-backed storage is not supported in Phase 2C-A')
  }
}

function assertDocumentWorkspace(workspace: Workspace, document: EditableDocument): void {
  if (document.workspaceId !== workspace.id) {
    throw new Error(`Document ${document.id} does not belong to workspace ${workspace.id}`)
  }
}

export function createDocumentService(dependencies: DocumentServiceDependencies): DocumentService {
  const { repositories, atomic, sessionLibrary, sessionSnapshots } = dependencies
  const now = dependencies.now ?? Date.now
  const generateId = dependencies.generateId ?? defaultGenerateId
  const transientLocalSelections = new Map<string, string>()

  function newDocument(
    workspace: Workspace,
    input: Partial<Pick<EditableDocument, 'name' | 'docType' | 'content'>>,
    sourceKind: EditableDocument['sourceKind']
  ): EditableDocument {
    const timestamp = now()
    return {
      id: generateId(),
      workspaceId: workspace.id,
      name: normalizeDocumentName(input.name ?? 'untitled.md'),
      docType: input.docType ?? 'markdown',
      content: input.content ?? '',
      sourceKind,
      createdAt: timestamp,
      updatedAt: timestamp
    }
  }

  function privateContext(workspace: Workspace, active: EditableDocument, warning?: string): DocumentContext {
    const documents = sessionLibrary.list(workspace.id).sort(stableDocumentOrder)
    return {
      document: structuredClone(active),
      summaries: summariesOf(documents, active.id),
      ...(warning === undefined ? {} : { warning })
    }
  }

  async function localDocuments(workspaceId: string): Promise<StoredWorkspaceDocument[]> {
    return (await repositories.documents.listByWorkspace(workspaceId)).sort(stableDocumentOrder)
  }

  async function localContextForId(
    workspace: Workspace,
    documentId: string,
    warning?: string
  ): Promise<DocumentContext> {
    const documents = await localDocuments(workspace.id)
    const stored = documents.find((document) => document.id === documentId)
    if (stored === undefined) throw new Error(`Document not found in workspace ${workspace.id}: ${documentId}`)
    const converted = toEditable(stored)
    const editableDocuments = documents.map((document) => toEditable(document).document)
    const mergedWarning = mergeWarnings(warning, converted.warning)
    return {
      document: converted.document,
      summaries: summariesOf(editableDocuments, documentId),
      ...(mergedWarning === undefined ? {} : { warning: mergedWarning })
    }
  }

  async function resolveLocal(workspace: Workspace): Promise<DocumentContext> {
    let documents: StoredWorkspaceDocument[]
    try {
      documents = await localDocuments(workspace.id)
    } catch (error) {
      return recoveryContext(
        workspace.id,
        `Document library could not be loaded: ${error instanceof Error ? error.message : String(error)}`
      )
    }

    if (documents.length === 0) {
      const welcome = newDocument(
        workspace,
        { name: 'welcome.md', docType: 'markdown', content: WELCOME_DOCUMENT },
        'local'
      )
      await atomic.createDocumentAndActivate(toStored(welcome))
      transientLocalSelections.delete(workspace.id)
      return {
        document: welcome,
        summaries: summariesOf([welcome], welcome.id)
      }
    }

    let durableSelection: string | undefined
    try {
      durableSelection = await repositories.documentSelection.getActiveDocumentId(workspace.id)
    } catch {
      durableSelection = undefined
    }

    const durable = durableSelection === undefined
      ? undefined
      : documents.find((document) => document.id === durableSelection)
    if (durable !== undefined) {
      transientLocalSelections.delete(workspace.id)
      return localContextForId(workspace, durable.id)
    }

    const transientSelection = transientLocalSelections.get(workspace.id)
    const transient = transientSelection === undefined
      ? undefined
      : documents.find((document) => document.id === transientSelection)
    if (transient !== undefined) return localContextForId(workspace, transient.id)

    const candidate = [...documents].sort(legacyRepairOrder)[0]!
    try {
      await repositories.documentSelection.setActiveDocumentId(workspace.id, candidate.id)
      transientLocalSelections.delete(workspace.id)
      return localContextForId(workspace, candidate.id)
    } catch (error) {
      transientLocalSelections.set(workspace.id, candidate.id)
      return localContextForId(
        workspace,
        candidate.id,
        `Active document selection could not be persisted; using a session-only selection: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  function resolvePrivate(workspace: Workspace): DocumentContext {
    let documents = sessionLibrary.list(workspace.id).sort(stableDocumentOrder)
    if (documents.length === 0) {
      const welcome = newDocument(
        workspace,
        { name: 'welcome.md', docType: 'markdown', content: WELCOME_DOCUMENT },
        'local'
      )
      sessionLibrary.save(welcome)
      sessionLibrary.setActiveDocumentId(workspace.id, welcome.id)
      documents = [welcome]
      return privateContext(workspace, welcome)
    }

    const selectedId = sessionLibrary.getActiveDocumentId(workspace.id)
    const selected = selectedId === undefined
      ? undefined
      : documents.find((document) => document.id === selectedId)
    const active = selected ?? documents[0]!
    if (selected === undefined) sessionLibrary.setActiveDocumentId(workspace.id, active.id)
    return privateContext(workspace, active)
  }

  async function getDocument(workspace: Workspace, documentId: string): Promise<EditableDocument | undefined> {
    if (workspace.storageMode === 'private-session') {
      return sessionLibrary.get(workspace.id, documentId)
    }
    const stored = await repositories.documents.get(documentId)
    if (stored === undefined || stored.workspaceId !== workspace.id) return undefined
    return toEditable(stored).document
  }

  async function createWithSource(
    workspace: Workspace,
    input: Partial<Pick<EditableDocument, 'name' | 'docType' | 'content'>>,
    sourceKind: EditableDocument['sourceKind']
  ): Promise<DocumentContext> {
    assertSupportedWorkspace(workspace)
    const document = newDocument(workspace, input, sourceKind)
    if (workspace.storageMode === 'private-session') {
      sessionLibrary.save(document)
      sessionLibrary.setActiveDocumentId(workspace.id, document.id)
      return privateContext(workspace, document)
    }

    await atomic.createDocumentAndActivate(toStored(document))
    transientLocalSelections.delete(workspace.id)
    return localContextForId(workspace, document.id)
  }

  const service: DocumentService = {
    async list(workspace) {
      return (await service.resolveActive(workspace)).summaries
    },

    async resolveActive(workspace) {
      assertSupportedWorkspace(workspace)
      return workspace.storageMode === 'private-session'
        ? resolvePrivate(workspace)
        : resolveLocal(workspace)
    },

    async create(workspace, input = {}) {
      return createWithSource(workspace, input, 'local')
    },

    async importDocument(workspace, input) {
      return createWithSource(
        workspace,
        {
          name: input.name,
          docType: input.docType,
          content: input.content
        },
        'file'
      )
    },

    async rename(workspace, documentId, rawName) {
      assertSupportedWorkspace(workspace)
      const document = await getDocument(workspace, documentId)
      if (document === undefined) throw new Error(`Document not found in workspace ${workspace.id}: ${documentId}`)
      const renamed: EditableDocument = {
        ...document,
        name: normalizeDocumentName(rawName),
        updatedAt: now()
      }
      await service.save(workspace, renamed)
      return service.resolveActive(workspace)
    },

    async switchTo(workspace, targetDocumentId, currentDocument) {
      assertSupportedWorkspace(workspace)
      assertDocumentWorkspace(workspace, currentDocument)
      const target = await getDocument(workspace, targetDocumentId)
      if (target === undefined) {
        throw new Error(`Document not found in workspace ${workspace.id}: ${targetDocumentId}`)
      }
      if (target.id === currentDocument.id) return service.resolveActive(workspace)

      await service.save(workspace, currentDocument)

      if (workspace.storageMode === 'private-session') {
        sessionLibrary.setActiveDocumentId(workspace.id, target.id)
        return privateContext(workspace, target)
      }

      await repositories.documentSelection.setActiveDocumentId(workspace.id, target.id)
      transientLocalSelections.delete(workspace.id)
      return localContextForId(workspace, target.id)
    },

    async save(workspace, document) {
      assertSupportedWorkspace(workspace)
      assertDocumentWorkspace(workspace, document)
      if (workspace.storageMode === 'private-session') {
        sessionLibrary.save(document)
        return
      }
      await atomic.saveLocalDocumentIfActive(toStored(document))
    },

    async delete(workspace, documentId) {
      assertSupportedWorkspace(workspace)
      const resolved = await service.resolveActive(workspace)
      if (!('id' in resolved.document)) {
        throw new Error('Cannot delete a document while the Local Library is in recovery state')
      }
      const activeDocumentId = resolved.document.id
      const ordered = [...resolved.summaries].sort(stableDocumentOrder)
      const index = ordered.findIndex((document) => document.id === documentId)
      if (index < 0) throw new Error(`Document not found in workspace ${workspace.id}: ${documentId}`)

      if (ordered.length === 1) {
        const replacement = newDocument(
          workspace,
          { name: 'untitled.md', docType: 'markdown', content: '' },
          'local'
        )
        if (workspace.storageMode === 'private-session') {
          sessionLibrary.replaceWorkspace(workspace.id, {
            documents: [replacement],
            activeDocumentId: replacement.id
          })
          sessionSnapshots?.deleteDocument(documentId)
          return {
            ...privateContext(workspace, replacement),
            deletedDocumentId: documentId
          }
        }

        await atomic.replaceLastDocument(workspace.id, documentId, toStored(replacement))
        transientLocalSelections.delete(workspace.id)
        return {
          ...(await localContextForId(workspace, replacement.id)),
          deletedDocumentId: documentId
        }
      }

      const deletingActive = documentId === activeDocumentId
      const nextSelection = deletingActive
        ? (ordered[index + 1] ?? ordered[index - 1])!.id
        : activeDocumentId

      if (workspace.storageMode === 'private-session') {
        sessionLibrary.delete(workspace.id, documentId)
        if (deletingActive) sessionLibrary.setActiveDocumentId(workspace.id, nextSelection)
        const next = sessionLibrary.get(workspace.id, nextSelection)
        if (next === undefined) throw new Error(`Successor document disappeared: ${nextSelection}`)
        sessionSnapshots?.deleteDocument(documentId)
        return {
          ...privateContext(workspace, next),
          deletedDocumentId: documentId
        }
      }

      await atomic.deleteDocumentAndSelectNext(workspace.id, documentId, nextSelection)
      transientLocalSelections.delete(workspace.id)
      return {
        ...(await localContextForId(workspace, nextSelection)),
        deletedDocumentId: documentId
      }
    },

    async snapshotWorkspace(workspace) {
      assertSupportedWorkspace(workspace)
      const resolved = await service.resolveActive(workspace)
      if (!('id' in resolved.document)) {
        throw new Error('Cannot snapshot an ephemeral recovery document')
      }

      if (workspace.storageMode === 'private-session') {
        return {
          documents: sessionLibrary.list(workspace.id).sort(stableDocumentOrder),
          activeDocumentId: resolved.document.id
        }
      }

      const documents = (await localDocuments(workspace.id)).map((document) => toEditable(document).document)
      return {
        documents,
        activeDocumentId: resolved.document.id
      }
    }
  }

  return service
}
