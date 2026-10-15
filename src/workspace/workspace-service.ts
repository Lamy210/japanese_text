import type { AppConfig } from '../core/config/schema'
import { createDefaultWorkspaceState } from '../core/workspace/defaults'
import type { GlobalPreferences, RuleProfile, StorageMode, Workspace } from '../core/workspace/types'
import {
  composeAppConfig,
  splitAppConfigPreservingStorageMode,
  type ProjectedStorageState
} from '../storage/compat/app-config-projection'
import type { AtomicOperationsPort, StorageRepositories } from '../storage/repositories/ports'
import {
  createSessionDocumentStore,
  type SessionDocument,
  type SessionDocumentStore
} from './session-document-store'

export interface WorkspaceContext {
  workspace: Workspace
  profile: RuleProfile
  preferences: GlobalPreferences
  config: AppConfig
}

export interface WorkspaceSummary {
  id: string
  name: string
  storageMode: StorageMode
  active: boolean
  createdAt: number
  updatedAt: number
}

export interface WorkspaceSwitchResult {
  context: WorkspaceContext
  document?: SessionDocument
  warning?: string
}

export interface WorkspaceDeleteResult {
  active: WorkspaceContext
  deletedWorkspaceId: string
}

export interface WorkspaceServiceDependencies {
  repositories: StorageRepositories
  atomic: AtomicOperationsPort
  now?: () => number
  generateId?: (kind: 'workspace' | 'profile') => string
  sessionDocuments?: SessionDocumentStore
  durableBackend?: boolean
}

export interface WorkspaceService {
  getActive(): Promise<WorkspaceContext>
  list(): Promise<WorkspaceSummary[]>
  saveConfig(workspaceId: string, config: AppConfig): Promise<WorkspaceContext>
  create(input: { name: string }): Promise<WorkspaceContext>
  rename(workspaceId: string, name: string): Promise<Workspace>
  switchTo(targetWorkspaceId: string, currentDocument: SessionDocument): Promise<WorkspaceSwitchResult>
  delete(workspaceId: string): Promise<WorkspaceDeleteResult>
  setStorageMode(
    workspaceId: string,
    mode: 'private-session' | 'local-library',
    currentDocument?: SessionDocument
  ): Promise<WorkspaceContext>
}

function compareWorkspaceIdentity(a: Workspace, b: Workspace): number {
  const createdAtDifference = a.createdAt - b.createdAt
  if (createdAtDifference !== 0) return createdAtDifference
  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}

function normalizeWorkspaceName(raw: string): string {
  const name = raw.trim()
  if (name.length === 0) throw new Error('Workspace name must not be empty')
  if ([...name].length > 80) throw new Error('Workspace name must be 80 Unicode code points or fewer')
  if (/[\u0000-\u001f]/u.test(name)) throw new Error('Workspace name must not contain control characters')
  return name
}

function defaultGenerateId(kind: 'workspace' | 'profile'): string {
  const random = Math.random().toString(36).slice(2, 10)
  return `${kind}-${Date.now().toString(36)}-${random}`
}

function newestDocument<T extends { updatedAt: number }>(values: T[]): T | undefined {
  return values.reduce<T | undefined>(
    (current, candidate) => current === undefined || candidate.updatedAt > current.updatedAt ? candidate : current,
    undefined
  )
}

function toSessionDocument(document: {
  name: string
  content?: string
  docType: SessionDocument['docType']
  updatedAt: number
}): SessionDocument | undefined {
  if (typeof document.content !== 'string') return undefined
  return {
    name: document.name,
    content: document.content,
    docType: document.docType,
    updatedAt: document.updatedAt
  }
}

function contextFromProjected(state: ProjectedStorageState): WorkspaceContext {
  return {
    workspace: state.workspace,
    profile: state.profile,
    preferences: state.preferences,
    config: composeAppConfig(state)
  }
}

export function createWorkspaceService(dependencies: WorkspaceServiceDependencies): WorkspaceService {
  const { repositories, atomic } = dependencies
  const now = dependencies.now ?? Date.now
  const generateId = dependencies.generateId ?? defaultGenerateId
  const sessionDocuments = dependencies.sessionDocuments ?? createSessionDocumentStore()
  const durableBackend = dependencies.durableBackend ?? true

  async function loadContext(workspace: Workspace): Promise<WorkspaceContext> {
    const preferences = await repositories.preferences.get()
    if (preferences === undefined) throw new Error('Global preferences are missing')

    const profile = await repositories.profiles.get(workspace.activeRuleProfileId)
    if (profile === undefined) throw new Error(`Active rule profile is missing for workspace ${workspace.id}`)

    return contextFromProjected({ workspace, profile, preferences })
  }

  async function loadContextRecovering(
    workspace: Workspace
  ): Promise<{ context: WorkspaceContext; warning?: string }> {
    const defaults = createDefaultWorkspaceState(now())
    let recovered = false

    let preferences: GlobalPreferences | undefined
    try {
      preferences = await repositories.preferences.get()
    } catch {
      preferences = undefined
    }
    if (preferences === undefined) {
      preferences = defaults.preferences
      await repositories.preferences.save(preferences)
      recovered = true
    }

    let profile: RuleProfile | undefined
    try {
      profile = await repositories.profiles.get(workspace.activeRuleProfileId)
    } catch {
      profile = undefined
    }
    if (profile === undefined) {
      const timestamp = now()
      profile = {
        ...structuredClone(defaults.profile),
        id: workspace.activeRuleProfileId,
        name: 'Recovered General Japanese',
        createdAt: timestamp,
        updatedAt: timestamp
      }
      await repositories.profiles.save(profile)
      recovered = true
    }

    return {
      context: contextFromProjected({ workspace, profile, preferences }),
      ...(recovered ? { warning: 'Workspace context recovered from missing or invalid persisted state.' } : {})
    }
  }

  async function resolveSelectedWorkspace(): Promise<Workspace | undefined> {
    const selectedId = await repositories.selection.getActiveWorkspaceId()
    if (selectedId === undefined) return undefined
    try {
      return await repositories.workspaces.get(selectedId)
    } catch {
      return undefined
    }
  }

  async function getActive(): Promise<WorkspaceContext> {
    const selected = await resolveSelectedWorkspace()
    if (selected !== undefined) return (await loadContextRecovering(selected)).context

    const workspaces = (await repositories.workspaces.list()).sort(compareWorkspaceIdentity)
    const repaired = workspaces[0]
    if (repaired !== undefined) {
      await repositories.selection.setActiveWorkspaceId(repaired.id)
      return (await loadContextRecovering(repaired)).context
    }

    const defaults = createDefaultWorkspaceState(now())
    await atomic.createWorkspaceAndActivate(defaults.workspace, defaults.profile)
    return loadContext(defaults.workspace)
  }

  async function saveLocalDocument(workspace: Workspace, document: SessionDocument): Promise<void> {
    const existing = newestDocument(await repositories.documents.listByWorkspace(workspace.id))
    await repositories.documents.save({
      id: existing?.id ?? `local-recent-document:${workspace.id}`,
      workspaceId: workspace.id,
      name: document.name,
      content: document.content,
      docType: document.docType,
      sourceKind: 'local',
      createdAt: existing?.createdAt ?? document.updatedAt,
      updatedAt: document.updatedAt
    })
  }

  return {
    getActive,

    async list(): Promise<WorkspaceSummary[]> {
      const active = await getActive()
      const workspaces = (await repositories.workspaces.list()).sort(compareWorkspaceIdentity)
      return workspaces.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        storageMode: workspace.storageMode,
        active: workspace.id === active.workspace.id,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt
      }))
    },

    async saveConfig(workspaceId, config): Promise<WorkspaceContext> {
      const workspace = await repositories.workspaces.get(workspaceId)
      if (workspace === undefined) throw new Error(`Workspace not found: ${workspaceId}`)
      const current = await loadContext(workspace)
      const next = splitAppConfigPreservingStorageMode(config, {
        workspace: current.workspace,
        profile: current.profile,
        preferences: current.preferences
      }, now())
      await atomic.saveProjectedState(next)
      return contextFromProjected(next)
    },

    async create(input): Promise<WorkspaceContext> {
      const name = normalizeWorkspaceName(input.name)
      const active = await getActive()
      const timestamp = now()
      const profile = structuredClone(active.profile)
      profile.id = generateId('profile')
      profile.createdAt = timestamp
      profile.updatedAt = timestamp

      const workspace: Workspace = {
        id: generateId('workspace'),
        name,
        activeRuleProfileId: profile.id,
        storageMode: 'private-session',
        snapshotPolicy: { enabled: false, maxSnapshots: 20 },
        createdAt: timestamp,
        updatedAt: timestamp
      }

      await atomic.createWorkspaceAndActivate(workspace, profile)
      return loadContext(workspace)
    },

    async rename(workspaceId, rawName): Promise<Workspace> {
      const name = normalizeWorkspaceName(rawName)
      const workspace = await repositories.workspaces.get(workspaceId)
      if (workspace === undefined) throw new Error(`Workspace not found: ${workspaceId}`)
      const renamed: Workspace = { ...workspace, name, updatedAt: now() }
      await repositories.workspaces.save(renamed)
      return renamed
    },

    async switchTo(targetWorkspaceId, currentDocument): Promise<WorkspaceSwitchResult> {
      const current = await getActive()
      const target = await repositories.workspaces.get(targetWorkspaceId)
      if (target === undefined) throw new Error(`Workspace not found: ${targetWorkspaceId}`)

      if (current.workspace.storageMode === 'local-library') {
        await saveLocalDocument(current.workspace, currentDocument)
      } else if (current.workspace.storageMode === 'private-session') {
        sessionDocuments.set(current.workspace.id, currentDocument)
      }

      const recovered = await loadContextRecovering(target)
      let document: SessionDocument | undefined
      let warning = recovered.warning

      if (target.storageMode === 'local-library') {
        try {
          const stored = newestDocument(await repositories.documents.listByWorkspace(target.id))
          document = stored === undefined ? undefined : toSessionDocument(stored)
        } catch {
          warning = warning === undefined
            ? 'Workspace document recovery skipped invalid persisted body.'
            : `${warning} Workspace document recovery skipped invalid persisted body.`
        }
      } else if (target.storageMode === 'private-session') {
        document = sessionDocuments.get(target.id)
      }

      await repositories.selection.setActiveWorkspaceId(target.id)
      return {
        context: recovered.context,
        ...(document === undefined ? {} : { document }),
        ...(warning === undefined ? {} : { warning })
      }
    },

    async delete(workspaceId): Promise<WorkspaceDeleteResult> {
      const active = await getActive()
      const workspaces = (await repositories.workspaces.list()).sort(compareWorkspaceIdentity)
      if (workspaces.length <= 1) throw new Error('The last workspace cannot be deleted')

      const deleteIndex = workspaces.findIndex((workspace) => workspace.id === workspaceId)
      if (deleteIndex < 0) throw new Error(`Workspace not found: ${workspaceId}`)

      if (active.workspace.id === workspaceId) {
        const successor = workspaces[deleteIndex + 1] ?? workspaces[deleteIndex - 1]
        if (successor === undefined) throw new Error('No successor workspace is available')
        await atomic.deleteWorkspaceAndSelectNext(workspaceId, successor.id)
        sessionDocuments.delete(workspaceId)
        return { active: (await loadContextRecovering(successor)).context, deletedWorkspaceId: workspaceId }
      }

      await atomic.deleteWorkspaceCascade(workspaceId)
      sessionDocuments.delete(workspaceId)
      return { active, deletedWorkspaceId: workspaceId }
    },

    async setStorageMode(workspaceId, mode, currentDocument): Promise<WorkspaceContext> {
      const workspace = await repositories.workspaces.get(workspaceId)
      if (workspace === undefined) throw new Error(`Workspace not found: ${workspaceId}`)
      if (workspace.storageMode === 'file-backed') throw new Error('file-backed storage is not configurable in Phase 2B')
      if (workspace.storageMode === mode) return loadContext(workspace)

      if (mode === 'local-library') {
        if (!durableBackend) throw new Error('Local Library requires durable browser storage')
        if (currentDocument === undefined) throw new Error('Current document is required when enabling Local Library')

        const document = {
          id: `local-recent-document:${workspaceId}`,
          workspaceId,
          name: currentDocument.name,
          content: currentDocument.content,
          docType: currentDocument.docType,
          sourceKind: 'local' as const,
          createdAt: currentDocument.updatedAt,
          updatedAt: currentDocument.updatedAt
        }
        await atomic.enableLocalLibrary(workspaceId, [document], document.id)
        sessionDocuments.delete(workspaceId)
      } else {
        if (currentDocument === undefined) {
          throw new Error('Current document is required when making a Local Library workspace private')
        }
        await atomic.makeWorkspacePrivate(workspaceId)
        sessionDocuments.set(workspaceId, currentDocument)
      }

      const updated = await repositories.workspaces.get(workspaceId)
      if (updated === undefined) throw new Error(`Workspace not found after storage mode transition: ${workspaceId}`)
      return loadContext(updated)
    }
  }
}
