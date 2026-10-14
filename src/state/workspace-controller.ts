import type { StorageContext } from '../storage/bootstrap'
import { getStorageContext } from '../storage/runtime'
import {
  createSessionDocumentStore,
  type SessionDocument,
  type SessionDocumentStore
} from '../workspace/session-document-store'
import {
  createStorageCapabilityService,
  type StorageManagerLike
} from '../workspace/storage-capability'
import {
  createWorkspaceService,
  type WorkspaceContext,
  type WorkspaceService
} from '../workspace/workspace-service'
import { appState, type Toast } from './app-state'
import { WELCOME_DOCUMENT } from './welcome-document'

export interface WorkspaceControllerDependencies {
  getContext?: () => Promise<StorageContext>
  relint?: () => void
  toast?: (kind: Toast['kind'], message: string) => void
  storageManager?: StorageManagerLike
  now?: () => number
}

export interface WorkspaceController {
  bootstrap(): Promise<void>
  refresh(): Promise<void>
  switchWorkspace(workspaceId: string): Promise<void>
  getService(): Promise<WorkspaceService>
  getContext(): Promise<StorageContext>
}

function resolveBrowserStorageManager(explicit?: StorageManagerLike): StorageManagerLike | undefined {
  if (explicit !== undefined) return explicit
  try {
    if (typeof navigator === 'undefined' || navigator.storage === undefined) return undefined
    return navigator.storage as StorageManagerLike
  } catch {
    return undefined
  }
}

function newestDocument<T extends { updatedAt: number }>(documents: T[]): T | undefined {
  return documents.reduce<T | undefined>(
    (current, candidate) => current === undefined || candidate.updatedAt > current.updatedAt ? candidate : current,
    undefined
  )
}

function currentEditorDocument(now: () => number): SessionDocument {
  return {
    name: appState.documentName(),
    content: appState.documentText(),
    docType: appState.docType(),
    updatedAt: now()
  }
}

export function createWorkspaceController(
  dependencies: WorkspaceControllerDependencies = {}
): WorkspaceController {
  const getContextDependency = dependencies.getContext ?? getStorageContext
  const relint = dependencies.relint ?? (() => undefined)
  const toast = dependencies.toast ?? appState.pushToast
  const now = dependencies.now ?? Date.now
  const sessionDocuments: SessionDocumentStore = createSessionDocumentStore()

  let contextPromise: Promise<StorageContext> | undefined
  let servicePromise: Promise<WorkspaceService> | undefined

  async function context(): Promise<StorageContext> {
    contextPromise ??= getContextDependency()
    return contextPromise
  }

  async function service(): Promise<WorkspaceService> {
    servicePromise ??= context().then((storageContext) => createWorkspaceService({
      repositories: storageContext.repositories,
      atomic: storageContext.atomic,
      durableBackend: storageContext.durable,
      sessionDocuments,
      now
    }))
    return servicePromise
  }

  function applyContext(active: WorkspaceContext): void {
    const loaded = appState.loadConfigFrom(active.config)
    if (!loaded.ok) throw new Error(loaded.error ?? 'Workspace config could not be loaded')
    appState.setActiveWorkspaceId(active.workspace.id)
  }

  function applyDocument(document: SessionDocument | undefined): void {
    if (document === undefined) {
      appState.setDocument(WELCOME_DOCUMENT, 'welcome.md', 'markdown')
      return
    }
    appState.setDocument(document.content, document.name, document.docType)
  }

  async function loadBootDocument(
    storageContext: StorageContext,
    active: WorkspaceContext
  ): Promise<SessionDocument | undefined> {
    if (storageContext.migration.recoveredDocument !== undefined && active.workspace.storageMode === 'private-session') {
      return structuredClone(storageContext.migration.recoveredDocument)
    }

    if (active.workspace.storageMode === 'private-session') {
      return sessionDocuments.get(active.workspace.id)
    }
    if (active.workspace.storageMode !== 'local-library') return undefined

    const document = newestDocument(
      await storageContext.repositories.documents.listByWorkspace(active.workspace.id)
    )
    if (document === undefined || typeof document.content !== 'string') return undefined
    return {
      name: document.name,
      content: document.content,
      docType: document.docType,
      updatedAt: document.updatedAt
    }
  }

  async function refresh(): Promise<void> {
    const workspaceService = await service()
    const active = await workspaceService.getActive()
    applyContext(active)
    appState.setWorkspaceSummaries(await workspaceService.list())
  }

  return {
    async bootstrap(): Promise<void> {
      appState.setWorkspaceReady(false)
      const storageContext = await context()
      appState.setStorageAvailable(storageContext.durable)

      const capabilityService = createStorageCapabilityService(
        resolveBrowserStorageManager(dependencies.storageManager),
        storageContext.durable
      )
      appState.setStorageCapability(await capabilityService.inspect())

      const workspaceService = await service()
      const active = await workspaceService.getActive()
      applyContext(active)
      appState.setWorkspaceSummaries(await workspaceService.list())
      applyDocument(await loadBootDocument(storageContext, active))
      appState.resetDiagnosticsForDocumentContext()
      appState.setConfigLoaded(true)
      appState.setWorkspaceReady(true)

      if (storageContext.migration.warning !== undefined) {
        toast('warning', storageContext.migration.warning)
      }
      relint()
    },

    refresh,

    async switchWorkspace(workspaceId: string): Promise<void> {
      if (workspaceId === appState.activeWorkspaceId()) return
      appState.setWorkspaceMutationPending(true)
      try {
        const workspaceService = await service()
        const result = await workspaceService.switchTo(workspaceId, currentEditorDocument(now))
        applyContext(result.context)
        applyDocument(result.document)
        appState.setWorkspaceSummaries(await workspaceService.list())
        appState.resetDiagnosticsForDocumentContext()
        if (result.warning !== undefined) toast('warning', result.warning)
        relint()
      } finally {
        appState.setWorkspaceMutationPending(false)
      }
    },

    getService: service,
    getContext: context
  }
}
