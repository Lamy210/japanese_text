import type { AppConfig } from '../core/config/schema'
import { createDefaultWorkspaceState } from '../core/workspace/defaults'
import type { GlobalPreferences, RuleProfile, Workspace } from '../core/workspace/types'
import { composeAppConfig } from '../storage/compat/app-config-projection'
import type { AtomicOperationsPort, StorageRepositories } from '../storage/repositories/ports'

export interface WorkspaceContext {
  workspace: Workspace
  profile: RuleProfile
  preferences: GlobalPreferences
  config: AppConfig
}

export interface WorkspaceServiceDependencies {
  repositories: StorageRepositories
  atomic: AtomicOperationsPort
  now?: () => number
}

export interface WorkspaceService {
  getActive(): Promise<WorkspaceContext>
}

function compareWorkspaceIdentity(a: Workspace, b: Workspace): number {
  const createdAtDifference = a.createdAt - b.createdAt
  if (createdAtDifference !== 0) return createdAtDifference
  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}

export function createWorkspaceService(dependencies: WorkspaceServiceDependencies): WorkspaceService {
  const { repositories, atomic } = dependencies
  const now = dependencies.now ?? Date.now

  async function loadContext(workspace: Workspace): Promise<WorkspaceContext> {
    const preferences = await repositories.preferences.get()
    if (preferences === undefined) throw new Error('Global preferences are missing')

    const profile = await repositories.profiles.get(workspace.activeRuleProfileId)
    if (profile === undefined) {
      throw new Error(`Active rule profile is missing for workspace ${workspace.id}`)
    }

    return {
      workspace,
      profile,
      preferences,
      config: composeAppConfig({ workspace, profile, preferences })
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

  return {
    async getActive(): Promise<WorkspaceContext> {
      const selected = await resolveSelectedWorkspace()
      if (selected !== undefined) return loadContext(selected)

      const workspaces = (await repositories.workspaces.list()).sort(compareWorkspaceIdentity)
      const repaired = workspaces[0]
      if (repaired !== undefined) {
        await repositories.selection.setActiveWorkspaceId(repaired.id)
        return loadContext(repaired)
      }

      const defaults = createDefaultWorkspaceState(now())
      await atomic.createWorkspaceAndActivate(defaults.workspace, defaults.profile)
      return loadContext(defaults.workspace)
    }
  }
}
