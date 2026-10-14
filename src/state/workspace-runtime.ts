import { cancelPendingDocumentPersistence } from './actions'
import { appState } from './app-state'
import { lintController } from './lint-controller'
import { createWorkspaceController } from './workspace-controller'

/**
 * Application-wide Workspace controller.
 * A single instance is required so Private Session document memory is shared by
 * bootstrap, header switching, settings, and management actions.
 */
export const workspaceController = createWorkspaceController({
  relint: () => lintController.relintAll(),
  toast: (kind, message) => appState.pushToast(kind, message),
  cancelPendingDocumentPersistence
})
