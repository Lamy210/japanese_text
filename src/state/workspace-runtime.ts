import { cancelPendingDocumentPersistence } from './actions'
import { appState } from './app-state'
import { applicationRuntime } from './application-runtime'
import { createDocumentController } from './document-controller'
import { createHistoryController } from './history-controller'
import { lintController } from './lint-controller'
import { createWorkspaceController } from './workspace-controller'

const relint = (): void => lintController.relintAll()
const toast = (kind: Parameters<typeof appState.pushToast>[0], message: string): void => {
  appState.pushToast(kind, message)
}

/**
 * Application-wide Document controller backed by the same ApplicationRuntime as
 * Workspace orchestration. This keeps Private Session documents and active IDs shared
 * across bootstrap, Header Open, Sidebar actions, and Workspace navigation.
 */
export const documentController = createDocumentController({
  getDocumentService: applicationRuntime.getDocumentService,
  getWorkspaceService: applicationRuntime.getWorkspaceService,
  relint,
  toast,
  cancelPendingDocumentPersistence
})

/** Application-wide History controller sharing the same snapshot/session runtime. */
export const historyController = createHistoryController({
  getSnapshotService: applicationRuntime.getSnapshotService,
  getWorkspaceService: applicationRuntime.getWorkspaceService,
  getCurrentDocument: documentController.currentEditableDocument,
  relint,
  toast,
  cancelPendingDocumentPersistence
})

/** Application-wide Workspace controller sharing the same document runtime. */
export const workspaceController = createWorkspaceController({
  runtime: applicationRuntime,
  relint,
  toast,
  cancelPendingDocumentPersistence
})
