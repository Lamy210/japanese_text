import type { AppConfig } from '../core/config/schema'
import type { SnapshotPolicy } from '../core/workspace/types'
import type { StorageContext } from '../storage/bootstrap'
import { getStorageContext } from '../storage/runtime'
import { readDocumentIgnores } from '../storage/document-ignore-store'
import {
  createStorageCapabilityService,
  type StorageCapability,
  type StorageCapabilityService,
  type StorageManagerLike
} from '../workspace/storage-capability'
import {
  type RuleProfileSummary,
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
  setSnapshotPolicy(policy: SnapshotPolicy): Promise<void>
  listRuleProfiles(): Promise<RuleProfileSummary[]>
  duplicateRuleProfile(name: string): Promise<WorkspaceContext>
  switchRuleProfile(profileId: string): Promise<WorkspaceContext>
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
      now,
      loadDurableIgnored: async (workspaceId, documentId) => {
        const storage = await runtime.getStorageContext()
        if (!storage.durable || !storage.db) return []
        return readDocumentIgnores(storage.db, workspaceId, documentId)
      }
    })
    return documentController
  }

  function applyContext(active: WorkspaceContext): void {
    const loaded = appState.loadConfigFrom(active.config)
    if (!loaded.ok) throw new Error(loaded.error ?? 'Workspace config could not be loaded')
    appState.setActiveWorkspaceId(active.workspace.id)
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

  async function runMutation<T>(operation: () => Promise<T>): Promise<T> {
    if (appState.historyMutationPending()) throw new Error('History mutation is pending')
    appState.setWorkspaceMutationPending(true)
    try {
      return await operation()
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
        applyContext(target.context)
        await documents().bootstrapForWorkspace(target.context.workspace)
        appState.setWorkspaceSummaries(await workspaceService.list())
        if (target.warning !== undefined) toast('warning', target.warning)
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
        const sessionDocumentIds = runtime.getSessionDocumentLibrary()
          .list(workspaceId)
          .map((document) => document.id)
        cancelPendingDocumentPersistence()
        await documents().flushActiveDocument()
        await persistCurrentWorkspaceConfig()

        const workspaceService = await service()
        const result = await workspaceService.delete(workspaceId)

        runtime.getSessionSnapshotStore().deleteDocuments(sessionDocumentIds)
        runtime.getSessionDocumentLibrary().deleteWorkspace(workspaceId)
        appState.clearIgnoredWorkspace(workspaceId)
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

        cancelPendingDocumentPersistence()
        await documents().flushActiveDocument()
        await persistCurrentWorkspaceConfig()

        const workspaceService = await service()
        const active = await workspaceService.getActive()
        if (active.workspace.id !== workspaceId) {
          throw new Error(`Active workspace changed during storage transition: ${workspaceId}`)
        }
        if (active.workspace.storageMode === mode) return

        const documentService = await runtime.getDocumentService()
        const snapshot = await documentService.snapshotWorkspace(active.workspace)
        const documentIds = snapshot.documents.map((document) => document.id)
        let updated: WorkspaceContext

        if (mode === 'local-library') {
          updated = await workspaceService.enableLocalLibrary(
            workspaceId,
            snapshot.documents,
            snapshot.activeDocumentId
          )
          runtime.getSessionSnapshotStore().deleteDocuments(documentIds)
          runtime.getSessionDocumentLibrary().deleteWorkspace(workspaceId)
        } else {
          updated = await workspaceService.makePrivate(workspaceId)
          runtime.getSessionSnapshotStore().deleteDocuments(documentIds)
          runtime.getSessionDocumentLibrary().replaceWorkspace(workspaceId, snapshot)
        }

        applyContext(updated)
        if (mode === 'private-session') appState.clearIgnoredWorkspace(workspaceId)
        await documents().bootstrapForWorkspace(updated.workspace)
        appState.setWorkspaceSummaries(await workspaceService.list())
      })
    },

    async setSnapshotPolicy(policy: SnapshotPolicy): Promise<void> {
      await runMutation(async () => {
        const workspaceId = appState.activeWorkspaceId()
        if (workspaceId === undefined) throw new Error('Active workspace is missing')
        const workspaceService = await service()
        await workspaceService.updateSnapshotPolicy(workspaceId, policy)
        appState.setWorkspaceSummaries(await workspaceService.list())
      })
    },

    async listRuleProfiles(): Promise<RuleProfileSummary[]> {
      const workspaceId = appState.activeWorkspaceId()
      if (workspaceId === undefined) throw new Error('Active workspace is missing')
      return (await service()).listRuleProfiles(workspaceId)
    },

    async duplicateRuleProfile(name): Promise<WorkspaceContext> {
      return runMutation(async () => {
        const workspaceId = appState.activeWorkspaceId()
        if (workspaceId === undefined) throw new Error('Active workspace is missing')
        cancelPendingDocumentPersistence()
        await documents().flushActiveDocument()
        await persistCurrentWorkspaceConfig()
        if (workspaceId !== appState.activeWorkspaceId()) throw new Error('Workspace changed during profile duplication')
        const changed = await (await service()).duplicateRuleProfile(workspaceId, name)
        applyContext(changed)
        appState.invalidateAnalysisForConfigChange()
        relint()
        return changed
      })
    },

    async switchRuleProfile(profileId): Promise<WorkspaceContext> {
      return runMutation(async () => {
        const workspaceId = appState.activeWorkspaceId()
        if (workspaceId === undefined) throw new Error('Active workspace is missing')
        cancelPendingDocumentPersistence()
        await documents().flushActiveDocument()
        await persistCurrentWorkspaceConfig()
        if (workspaceId !== appState.activeWorkspaceId()) throw new Error('Workspace changed during profile switch')
        const changed = await (await service()).switchRuleProfile(workspaceId, profileId)
        applyContext(changed)
        appState.invalidateAnalysisForConfigChange()
        relint()
        return changed
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
