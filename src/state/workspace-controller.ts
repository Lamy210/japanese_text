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
  type WorkspaceContext,
  type WorkspaceService
} from '../workspace/workspace-service'
import { appState, type Toast } from './app-state'
import {
  createApplicationRuntime,
  type ApplicationRuntime
} from './application-runtime'
import { createDocumentController, type DocumentController } from './document-controller'

export interface WorkspaceControllerDependencies {
  getContext?: () => Promise<StorageContext>
  runtime?: ApplicationRuntime
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
  const runtime = dependencies.runtime ?? createApplicationRuntime({ getContext: getContextDependency, now })

  let capabilityService: StorageCapabilityService | undefined
  let documentController: DocumentController | undefined

  function context(): Promise<StorageContext> {
    return runtime.getStorageContext()
  }

  function service(): Promise<WorkspaceService> {
    return runtime.getWorkspaceService()
  }

  function documents(): DocumentController {
    documentController ??= createDocumentController({
      getDocumentService: runtime.getDocumentService,
      getWorkspaceService: runtime.getWorkspaceService,
      relint,
      toast,
      cancelPendingDocumentPersistence,
      now
    })
    return documentController
  }

  function applyContext(active: WorkspaceContext): void {
    const loaded = appState.loadConfigFrom(active.config)
    if (!loaded.ok) throw new Error(loaded.error ?? 'Workspace config could not be loaded')
    appState.setActiveWorkspaceId(active.workspace.id)
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

      const recoveredDocument = storageContext.migration.recoveredDocument
      if (
        recoveredDocument !== undefined &&
        active.workspace.storageMode === 'private-session' &&
        runtime.getSessionDocumentLibrary().list(active.workspace.id).length === 0
      ) {
        await (await runtime.getDocumentService()).create(active.workspace, {
          name: recoveredDocument.name,
          content: recoveredDocument.content,
          docType: recoveredDocument.docType
        })
      }

      await documents().bootstrapForWorkspace(active.workspace)
      appState.setConfigLoaded(true)
      appState.setWorkspaceReady(true)

      if (storageContext.migration.warning !== undefined) toast('warning', storageContext.migration.warning)
    },

    refresh,

    async switchWorkspace(workspaceId: string): Promise<void> {
      if (workspaceId === appState.activeWorkspaceId()) return
      await runMutation(async () => {
        cancelPendingDocumentPersistence()
        await documents().flushActiveDocument()
        await persistCurrentWorkspaceConfig()

        const workspaceService = await service()
        const target = await workspaceService.switchTo(workspaceId)
        applyContext(target)
        await documents().bootstrapForWorkspace(target.workspace)
        appState.setWorkspaceSummaries(await workspaceService.list())
      })
    },

    async createWorkspace(name: string): Promise<void> {
      await runMutation(async () => {
        cancelPendingDocumentPersistence()
        await documents().flushActiveDocument()
        await persistCurrentWorkspaceConfig()

        const workspaceService = await service()
        const created = await workspaceService.create({ name })
        applyContext(created)
        await documents().bootstrapForWorkspace(created.workspace)
        appState.setWorkspaceSummaries(await workspaceService.list())
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
        cancelPendingDocumentPersistence()
        await documents().flushActiveDocument()
        await persistCurrentWorkspaceConfig()

        const workspaceService = await service()
        const result = await workspaceService.delete(workspaceId)

        // Private Session state is application memory and must be cleared only after
        // the durable/atomic Workspace delete succeeds.
        runtime.getSessionDocumentLibrary().deleteWorkspace(workspaceId)
        applyContext(result.active)
        appState.setWorkspaceSummaries(await workspaceService.list())

        if (previousActiveId === workspaceId) {
          await documents().bootstrapForWorkspace(result.active.workspace)
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
