import type { DocumentType } from '../core/types'
import type { Workspace } from '../core/workspace/types'
import type { DocumentService } from '../document/document-service'
import type { DocumentContext, EditableDocument } from '../document/types'
import type { WorkspaceService } from '../workspace/workspace-service'
import { appState, type Toast } from './app-state'

const TEXT_EXTENSIONS = ['.txt', '.md', '.markdown', '.mdown', '.mkd']

export interface DocumentControllerDependencies {
  getDocumentService: () => Promise<DocumentService>
  getWorkspaceService: () => Promise<WorkspaceService>
  relint?: () => void
  toast?: (kind: Toast['kind'], message: string) => void
  cancelPendingDocumentPersistence?: () => void
  now?: () => number
}

export interface DocumentController {
  bootstrapForWorkspace(workspace: Workspace): Promise<void>
  refresh(): Promise<void>
  createDocument(): Promise<void>
  renameActiveDocument(name: string): Promise<void>
  switchDocument(documentId: string): Promise<void>
  deleteActiveDocument(): Promise<void>
  importFile(file: File): Promise<void>
  flushActiveDocument(): Promise<void>
  currentEditableDocument(): EditableDocument
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

function documentTypeForFile(name: string): DocumentType {
  return name.toLowerCase().endsWith('.txt') ? 'text' : 'markdown'
}

function isSupportedTextFile(file: File): boolean {
  const lower = file.name.toLowerCase()
  return file.type.startsWith('text/') || TEXT_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

export function createDocumentController(
  dependencies: DocumentControllerDependencies
): DocumentController {
  const relint = dependencies.relint ?? (() => undefined)
  const toast = dependencies.toast ?? appState.pushToast
  const cancelPendingDocumentPersistence = dependencies.cancelPendingDocumentPersistence ?? (() => undefined)
  const now = dependencies.now ?? Date.now

  async function activeWorkspace(): Promise<Workspace> {
    return (await dependencies.getWorkspaceService()).getActive().then((context) => context.workspace)
  }

  function applyContext(context: DocumentContext): void {
    const previousDocumentId = appState.activeDocumentId()
    const nextDocumentId = 'id' in context.document ? context.document.id : undefined
    if (previousDocumentId !== nextDocumentId) {
      appState.setHistoryOpen(false)
      appState.resetHistoryForDocumentContext()
    }

    appState.setDocumentSummaries(context.summaries)
    appState.setActiveDocumentId(nextDocumentId)
    appState.setDocument(context.document.content, context.document.name, context.document.docType)
    appState.resetDiagnosticsForDocumentContext()
    if (context.warning !== undefined) toast('warning', context.warning)
    relint()
  }

  async function runMutation(operation: () => Promise<void>): Promise<void> {
    if (appState.historyMutationPending()) throw new Error('History mutation is pending')
    appState.setDocumentMutationPending(true)
    try {
      await operation()
    } finally {
      appState.setDocumentMutationPending(false)
    }
  }

  const controller: DocumentController = {
    async bootstrapForWorkspace(workspace): Promise<void> {
      appState.setDocumentLibraryReady(false)
      try {
        const context = await (await dependencies.getDocumentService()).resolveActive(workspace)
        applyContext(context)
      } finally {
        appState.setDocumentLibraryReady(true)
      }
    },

    async refresh(): Promise<void> {
      await controller.bootstrapForWorkspace(await activeWorkspace())
    },

    async createDocument(): Promise<void> {
      await runMutation(async () => {
        cancelPendingDocumentPersistence()
        await controller.flushActiveDocument()
        const workspace = await activeWorkspace()
        const context = await (await dependencies.getDocumentService()).create(workspace)
        applyContext(context)
      })
    },

    async renameActiveDocument(name): Promise<void> {
      await runMutation(async () => {
        const documentId = appState.activeDocumentId()
        if (documentId === undefined) throw new Error('No active document is available to rename')
        cancelPendingDocumentPersistence()
        await controller.flushActiveDocument()
        const workspace = await activeWorkspace()
        const context = await (await dependencies.getDocumentService()).rename(workspace, documentId, name)
        applyContext(context)
      })
    },

    async switchDocument(documentId): Promise<void> {
      if (documentId === appState.activeDocumentId()) return
      await runMutation(async () => {
        cancelPendingDocumentPersistence()
        const current = controller.currentEditableDocument()
        const workspace = await activeWorkspace()
        const context = await (await dependencies.getDocumentService()).switchTo(workspace, documentId, current)
        applyContext(context)
      })
    },

    async deleteActiveDocument(): Promise<void> {
      await runMutation(async () => {
        const documentId = appState.activeDocumentId()
        if (documentId === undefined) throw new Error('No active document is available to delete')
        cancelPendingDocumentPersistence()
        const workspace = await activeWorkspace()
        const context = await (await dependencies.getDocumentService()).delete(workspace, documentId)
        applyContext(context)
      })
    },

    async importFile(file): Promise<void> {
      if (!isSupportedTextFile(file)) {
        toast('error', `対応していないファイル形式です: ${file.name} (.txt / .md / .markdown を指定してください)`)
        return
      }

      await runMutation(async () => {
        cancelPendingDocumentPersistence()
        await controller.flushActiveDocument()
        const raw = await file.text()
        const workspace = await activeWorkspace()
        const context = await (await dependencies.getDocumentService()).importDocument(workspace, {
          name: file.name,
          docType: documentTypeForFile(file.name),
          content: normalizeLineEndings(raw)
        })
        applyContext(context)
        toast('success', `${file.name} をドキュメントライブラリへ追加しました。`)
      })
    },

    async flushActiveDocument(): Promise<void> {
      if (appState.activeDocumentId() === undefined) return
      const workspace = await activeWorkspace()
      await (await dependencies.getDocumentService()).save(workspace, controller.currentEditableDocument())
    },

    currentEditableDocument(): EditableDocument {
      const documentId = appState.activeDocumentId()
      if (documentId === undefined) throw new Error('No active document is available')
      const summary = appState.documentSummaries().find((value) => value.id === documentId)
      if (summary === undefined) throw new Error(`Active document summary is missing: ${documentId}`)
      return {
        id: summary.id,
        workspaceId: summary.workspaceId,
        name: appState.documentName(),
        docType: appState.docType(),
        content: appState.documentText(),
        sourceKind: summary.sourceKind,
        createdAt: summary.createdAt,
        updatedAt: now()
      }
    }
  }

  return controller
}
