import { createDocumentService, type DocumentService } from '../document/document-service'
import {
  createSessionDocumentLibraryStore,
  type SessionDocumentLibraryStore
} from '../document/session-document-library'
import type { StorageContext } from '../storage/bootstrap'
import { getStorageContext } from '../storage/runtime'
import { createWorkspaceService, type WorkspaceService } from '../workspace/workspace-service'

export interface ApplicationRuntime {
  getStorageContext(): Promise<StorageContext>
  getSessionDocumentLibrary(): SessionDocumentLibraryStore
  getWorkspaceService(): Promise<WorkspaceService>
  getDocumentService(): Promise<DocumentService>
}

export interface ApplicationRuntimeDependencies {
  getContext?: () => Promise<StorageContext>
  now?: () => number
}

export function createApplicationRuntime(
  dependencies: ApplicationRuntimeDependencies = {}
): ApplicationRuntime {
  const getContext = dependencies.getContext ?? getStorageContext
  const now = dependencies.now ?? Date.now
  const sessionLibrary = createSessionDocumentLibraryStore()
  let contextPromise: Promise<StorageContext> | undefined
  let workspaceServicePromise: Promise<WorkspaceService> | undefined
  let documentServicePromise: Promise<DocumentService> | undefined

  function sharedContext(): Promise<StorageContext> {
    contextPromise ??= getContext()
    return contextPromise
  }

  return {
    getStorageContext: sharedContext,

    getSessionDocumentLibrary() {
      return sessionLibrary
    },

    getWorkspaceService() {
      workspaceServicePromise ??= sharedContext().then((context) =>
        createWorkspaceService({
          repositories: context.repositories,
          atomic: context.atomic,
          durableBackend: context.durable,
          now
        })
      )
      return workspaceServicePromise
    },

    getDocumentService() {
      documentServicePromise ??= sharedContext().then((context) =>
        createDocumentService({
          repositories: context.repositories,
          atomic: context.atomic,
          sessionLibrary,
          now
        })
      )
      return documentServicePromise
    }
  }
}

export const applicationRuntime = createApplicationRuntime()
