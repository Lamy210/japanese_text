import type { EditableDocument } from '../document/types'
import type { SnapshotService } from '../history/snapshot-service'
import type { WorkspaceService } from '../workspace/workspace-service'
import { appState, type Toast } from './app-state'

export interface HistoryControllerDependencies {
  getSnapshotService: () => Promise<SnapshotService>
  getWorkspaceService: () => Promise<WorkspaceService>
  getCurrentDocument: () => EditableDocument
  relint?: () => void
  toast?: (kind: Toast['kind'], message: string) => void
  cancelPendingDocumentPersistence?: () => void
}

export interface HistoryController {
  open(): Promise<void>
  closeHistory(): void
  refresh(): Promise<void>
  saveManualSnapshot(): Promise<void>
  previewSnapshot(snapshotId: string): Promise<void>
  restoreSnapshot(snapshotId: string): Promise<void>
}

interface BoundContext {
  workspaceId: string
  documentId: string
  workspace: Awaited<ReturnType<WorkspaceService['getActive']>>['workspace']
  document: EditableDocument
}

export function createHistoryController(dependencies: HistoryControllerDependencies): HistoryController {
  const relint = dependencies.relint ?? (() => undefined)
  const toast = dependencies.toast ?? appState.pushToast
  const cancelPendingDocumentPersistence = dependencies.cancelPendingDocumentPersistence ?? (() => undefined)

  function identityMatches(workspaceId: string, documentId: string): boolean {
    return appState.activeWorkspaceId() === workspaceId && appState.activeDocumentId() === documentId
  }

  async function boundContext(): Promise<BoundContext> {
    const workspaceId = appState.activeWorkspaceId()
    const documentId = appState.activeDocumentId()
    if (workspaceId === undefined || documentId === undefined) {
      throw new Error('No active document is available for history')
    }
    const document = dependencies.getCurrentDocument()
    if (document.id !== documentId || document.workspaceId !== workspaceId) {
      throw new Error('History request is stale before it starts')
    }
    const context = await (await dependencies.getWorkspaceService()).getActive()
    if (context.workspace.id !== workspaceId || !identityMatches(workspaceId, documentId)) {
      throw new Error('History request became stale while resolving the active workspace')
    }
    return { workspaceId, documentId, workspace: context.workspace, document }
  }

  const controller: HistoryController = {
    async open(): Promise<void> {
      appState.setHistoryOpen(true)
      appState.resetHistoryForDocumentContext()
      try {
        await controller.refresh()
      } catch (error) {
        appState.setHistoryOpen(false)
        throw error
      }
    },

    closeHistory(): void {
      appState.setHistoryOpen(false)
      appState.resetHistoryForDocumentContext()
    },

    async refresh(): Promise<void> {
      const binding = await boundContext()
      appState.setHistoryLoading(true)
      try {
        const entries = await (await dependencies.getSnapshotService()).list(binding.workspace, binding.documentId)
        if (!identityMatches(binding.workspaceId, binding.documentId)) return
        appState.setHistoryEntries(entries)
        const selected = appState.selectedHistorySnapshot()
        if (selected !== undefined && !entries.some((entry) => entry.id === selected.id)) {
          appState.setSelectedHistorySnapshot(undefined)
        }
      } finally {
        appState.setHistoryLoading(false)
      }
    },

    async saveManualSnapshot(): Promise<void> {
      if (appState.historyMutationPending()) throw new Error('A history mutation is already pending')
      const binding = await boundContext()
      appState.setHistoryMutationPending(true)
      try {
        await (await dependencies.getSnapshotService()).capture(binding.workspace, binding.document, 'manual')
        if (!identityMatches(binding.workspaceId, binding.documentId)) {
          throw new Error('History request became stale after snapshot capture')
        }
        await controller.refresh()
      } finally {
        appState.setHistoryMutationPending(false)
      }
    },

    async previewSnapshot(snapshotId: string): Promise<void> {
      const binding = await boundContext()
      const snapshot = await (await dependencies.getSnapshotService()).get(
        binding.workspace,
        binding.documentId,
        snapshotId
      )
      if (!identityMatches(binding.workspaceId, binding.documentId)) return
      if (snapshot === undefined) throw new Error(`Snapshot not found: ${snapshotId}`)
      appState.setSelectedHistorySnapshot(snapshot)
    },

    async restoreSnapshot(snapshotId: string): Promise<void> {
      if (appState.historyMutationPending()) throw new Error('A history mutation is already pending')
      const binding = await boundContext()
      appState.setHistoryMutationPending(true)
      cancelPendingDocumentPersistence()
      try {
        const result = await (await dependencies.getSnapshotService()).restore(
          binding.workspace,
          binding.document,
          snapshotId
        )
        if (!identityMatches(binding.workspaceId, binding.documentId)) {
          throw new Error('History restore result is stale and was not applied to the active editor')
        }
        if (result.noOp) {
          toast('info', '現在の本文は選択した履歴と同じです。')
          return
        }

        appState.setDocument(
          result.document.content,
          result.document.name,
          result.document.docType
        )
        appState.setDocumentSummaries(
          appState.documentSummaries().map((summary) => summary.id === result.document.id
            ? {
                ...summary,
                name: result.document.name,
                docType: result.document.docType,
                sourceKind: result.document.sourceKind,
                createdAt: result.document.createdAt,
                updatedAt: result.document.updatedAt
              }
            : summary)
        )
        appState.resetDiagnosticsForDocumentContext()
        relint()
        await controller.refresh()
      } finally {
        appState.setHistoryMutationPending(false)
      }
    }
  }

  return controller
}
