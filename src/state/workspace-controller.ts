import type { AppConfig } from '../core/config/schema'
import type { StorageContext } from '../storage/bootstrap'
import { getStorageContext } from '../storage/runtime'
import {
  createSessionDocumentStore,
  type SessionDocument,
  type SessionDocumentStore
} from '../workspace/session-document-store'
import {
  createStorageCapabilityService,
  type StorageCapability,
  type StorageCapabilityService,
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
  cancelPendingDocumentPersistence?: () => void
  now?: () => number
}

export interface WorkspaceController {
  bootstrap(): Promise<void>
  refresh(): Promise<void>
  switchWorkspace(workspaceId: string): Promise<void>
  createWorkspace(name: string): Promise<void>
  renameWorkspace(workspaceId: string, name: string): Promise<void>
  deleteWorkspace(workspaceId: string): Promise<void>
  setStorageMode(mode: 'private-session' | 'local-library'): Promise<void>
  requestPersistence(): Promise<StorageCapability>
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

function currentConfig(): AppConfig {
  return JSON.parse(JSON.stringify(appState.config)) as AppConfig
}

export function createWorkspaceController(
  dependencies: WorkspaceControllerDependencies = {}
): WorkspaceController {
  const getContextDependency = dependencies.getContext ?? getStorageContext
  const relint = dependencies.relint ?? (() => undefined)
  const toast = dependencies.toast ?? appState.pushToast
  const cancelPendingDocumentPersistence = dependencies.cancelPendingDocumentPersistence ?? (() => undefined)
  const now = dependencies.now ?? Date.now
  const sessionDocuments: SessionDocumentStore = createSessionDocumentStore()

  let contextPromise: Promise<StorageContext> | undefined
  let servicePromise: Promise<WorkspaceService> | undefined
  let capabilityService: StorageCapabilityService | undefined

  async function context(): Promise<StorageContext> {
    contextPromise ??= getContextDependency()
    return contextPromise
  }

  async function service(): Promise<WorkspaceService> {
    servicePromise ??= context().then((storageContext) => createWorkspaceService({
      repositories: storageContext.repositories,
      atomic: storageContext.atomic,
      durableBackend: storageContext.durable,
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

  async function loadDocument(
    storageContext: StorageContext,
    active: WorkspaceContext
  ): Promise<SessionDocument | undefined> {
    if (active.workspace.storageMode === 'private-session') return sessionDocuments.get(active.workspace.id)
    if (active.workspace.storageMode !== 'local-library') return undefined

    const document = newestDocument(await storageContext.repositories.documents.listByWorkspace(active.workspace.id))
    if (document === undefined || typeof document.content !== 'string') return undefined
    return {
      name: document.name,
      content: document.content,
      docType: document.docType,
      updatedAt: document.updatedAt
    }
  }

  async function loadBootDocument(
    storageContext: StorageContext,
    active: WorkspaceContext
  ): Promise<SessionDocument | undefined> {
    if (storageContext.migration.recoveredDocument !== undefined && active.workspace.storageMode === 'private-session') {
      return structuredClone(storageContext.migration.recoveredDocument)
    }
    return loadDocument(storageContext, active)
  }

  async function saveLocalDocument(
    storageContext: StorageContext,
    workspaceId: string,
    document: SessionDocument
  ): Promise<void> {
    const existing = newestDocument(await storageContext.repositories.documents.listByWorkspace(workspaceId))
    await storageContext.repositories.documents.save({
      id: existing?.id ?? `local-recent-document:${workspaceId}`,
      workspaceId,
      name: document.name,
      content: document.content,
      docType: document.docType,
      sourceKind: 'local',
      createdAt: existing?.createdAt ?? document.updatedAt,
      updatedAt: document.updatedAt
    })
  }

  async function persistCurrentWorkspaceConfig(): Promise<void> {
    const workspaceId = appState.activeWorkspaceId()
    if (workspaceId === undefined) return
    await (await service()).saveConfig(workspaceId, currentConfig())
  }

  async function routeCurrentDocument(): Promise<void> {
    const workspaceService = await service()
    const active = await workspaceService.getActive()
    const document = currentEditorDocument(now)
    if (active.workspace.storageMode === 'private-session') {
      sessionDocuments.set(active.workspace.id, document)
      return
    }
    if (active.workspace.storageMode === 'local-library') {
      await saveLocalDocument(await context(), active.workspace.id, document)
    }
  }

  async function refresh(): Promise<void> {
    const workspaceService = await service()
    const active = await workspaceService.getActive()
    applyContext(active)
    appState.setWorkspaceSummaries(await workspaceService.list())
  }

  async function runMutation(operation: () => Promise<void>): Promise<void> {
    appState.setWorkspaceMutationPending(true)
    try {
      await operation()
    } finally {
      appState.setWorkspaceMutationPending(false)
    }
  }

  return {
    async bootstrap(): Promise<void> {
      appState.setWorkspaceReady(false)
      const storageContext = await context()
      appState.setStorageAvailable(storageContext.durable)

      capabilityService = createStorageCapabilityService(
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

      if (storageContext.migration.warning !== undefined) toast('warning', storageContext.migration.warning)
      relint()
    },

    refresh,

    async switchWorkspace(workspaceId: string): Promise<void> {
      if (workspaceId === appState.activeWorkspaceId()) return
      await runMutation(async () => {
        cancelPendingDocumentPersistence()
        await persistCurrentWorkspaceConfig()
        await routeCurrentDocument()
        const workspaceService = await service()
        const target = await workspaceService.switchTo(workspaceId)
        applyContext(target)
        applyDocument(await loadDocument(await context(), target))
        appState.setWorkspaceSummaries(await workspaceService.list())
        appState.resetDiagnosticsForDocumentContext()
        relint()
      })
    },

    async createWorkspace(name: string): Promise<void> {
      await runMutation(async () => {
        cancelPendingDocumentPersistence()
        await persistCurrentWorkspaceConfig()
        await routeCurrentDocument()
        const workspaceService = await service()
        const created = await workspaceService.create({ name })
        applyContext(created)
        applyDocument(undefined)
        appState.setWorkspaceSummaries(await workspaceService.list())
        appState.resetDiagnosticsForDocumentContext()
        relint()
      })
    },

    async renameWorkspace(workspaceId: string, name: string): Promise<void> {
      await runMutation(async () => {
        const workspaceService = await service()
        await workspaceService.rename(workspaceId, name)
        appState.setWorkspaceSummaries(await workspaceService.list())
      })
    },

    async deleteWorkspace(workspaceId: string): Promise<void> {
      await runMutation(async () => {
        const previousActiveId = appState.activeWorkspaceId()
        const workspaceService = await service()
        const result = await workspaceService.delete(workspaceId)
        sessionDocuments.delete(workspaceId)
        applyContext(result.active)
        appState.setWorkspaceSummaries(await workspaceService.list())

        if (previousActiveId === workspaceId) {
          applyDocument(await loadDocument(await context(), result.active))
          appState.resetDiagnosticsForDocumentContext()
          relint()
        }
      })
    },

    async setStorageMode(mode: 'private-session' | 'local-library'): Promise<void> {
      await runMutation(async () => {
        const workspaceId = appState.activeWorkspaceId()
        if (workspaceId === undefined) throw new Error('Active workspace is missing')
        const current = currentEditorDocument(now)
        cancelPendingDocumentPersistence()
        await persistCurrentWorkspaceConfig()

        const workspaceService = await service()
        const active = await workspaceService.getActive()
        let updated: WorkspaceContext
        if (mode === 'local-library') {
          if (active.workspace.storageMode === 'local-library') return
          const document = {
            id: `local-recent-document:${workspaceId}`,
            workspaceId,
            name: current.name,
            content: current.content,
            docType: current.docType,
            sourceKind: 'local' as const,
            createdAt: current.updatedAt,
            updatedAt: current.updatedAt
          }
          updated = await workspaceService.enableLocalLibrary(workspaceId, [document], document.id)
          sessionDocuments.delete(workspaceId)
        } else {
          if (active.workspace.storageMode === 'private-session') return
          await saveLocalDocument(await context(), workspaceId, current)
          updated = await workspaceService.makePrivate(workspaceId)
          sessionDocuments.set(workspaceId, current)
        }

        applyContext(updated)
        appState.setWorkspaceSummaries(await workspaceService.list())
        relint()
      })
    },

    async requestPersistence(): Promise<StorageCapability> {
      if (capabilityService === undefined) {
        const storageContext = await context()
        capabilityService = createStorageCapabilityService(
          resolveBrowserStorageManager(dependencies.storageManager),
          storageContext.durable
        )
      }
      const capability = await capabilityService.requestPersistence()
      appState.setStorageCapability(capability)
      return capability
    },

    getService: service,
    getContext: context
  }
}
