import { describe, expect, it, vi } from 'vitest'
import { createDefaultWorkspaceState, DEFAULT_PROFILE_ID, DEFAULT_WORKSPACE_ID } from '../../src/core/workspace/defaults'
import type { AppConfig } from '../../src/core/config/schema'
import type { GlobalPreferences, RuleProfile, Workspace } from '../../src/core/workspace/types'
import { createMemoryStorageContext } from '../../src/storage/repositories/memory'
import type { AtomicOperationsPort, StorageRepositories } from '../../src/storage/repositories/ports'

interface WorkspaceContext {
  workspace: Workspace
  profile: RuleProfile
  preferences: GlobalPreferences
  config: AppConfig
}

interface WorkspaceService {
  getActive(): Promise<WorkspaceContext>
}

interface WorkspaceServiceModule {
  createWorkspaceService(deps: {
    repositories: StorageRepositories
    atomic: AtomicOperationsPort
    now?: () => number
  }): WorkspaceService
}

type AtomicWithCreate = AtomicOperationsPort & {
  createWorkspaceAndActivate(workspace: Workspace, profile: RuleProfile): Promise<void>
}

async function loadWorkspaceServiceModule(): Promise<WorkspaceServiceModule | undefined> {
  return vi
    .importActual<WorkspaceServiceModule>('../../src/workspace/workspace-service')
    .catch(() => undefined)
}

function makeState(workspaceId: string, profileId: string, createdAt: number) {
  const state = createDefaultWorkspaceState(createdAt)
  state.workspace.id = workspaceId
  state.workspace.activeRuleProfileId = profileId
  state.workspace.name = workspaceId
  state.profile.id = profileId
  state.profile.name = profileId
  return state
}

async function saveState(
  repositories: StorageRepositories,
  state: ReturnType<typeof createDefaultWorkspaceState>,
  savePreferences = false
): Promise<void> {
  if (savePreferences) await repositories.preferences.save(state.preferences)
  await repositories.profiles.save(state.profile)
  await repositories.workspaces.save(state.workspace)
}

describe('WorkspaceService active selection', () => {
  it('uses the selected workspace even when repository order differs', async () => {
    const module = await loadWorkspaceServiceModule()
    expect(module).toBeDefined()
    if (module === undefined) return

    const memory = createMemoryStorageContext()
    const first = makeState('workspace-first', 'profile-first', 100)
    const selected = makeState('workspace-selected', 'profile-selected', 200)
    await saveState(memory.repositories, first, true)
    await saveState(memory.repositories, selected)
    await memory.repositories.selection.setActiveWorkspaceId(selected.workspace.id)

    const service = module.createWorkspaceService({
      repositories: memory.repositories,
      atomic: memory.atomicOperations,
      now: () => 999
    })

    await expect(service.getActive()).resolves.toMatchObject({
      workspace: { id: 'workspace-selected' },
      profile: { id: 'profile-selected' }
    })
  })

  it('repairs a missing selection to the stable earliest workspace', async () => {
    const module = await loadWorkspaceServiceModule()
    expect(module).toBeDefined()
    if (module === undefined) return

    const memory = createMemoryStorageContext()
    const later = makeState('workspace-later', 'profile-later', 200)
    const earlier = makeState('workspace-earlier', 'profile-earlier', 100)
    await saveState(memory.repositories, later, true)
    await saveState(memory.repositories, earlier)

    const service = module.createWorkspaceService({ repositories: memory.repositories, atomic: memory.atomicOperations })
    const active = await service.getActive()

    expect(active.workspace.id).toBe('workspace-earlier')
    await expect(memory.repositories.selection.getActiveWorkspaceId()).resolves.toBe('workspace-earlier')
  })

  it('repairs a selection that points at a deleted workspace', async () => {
    const module = await loadWorkspaceServiceModule()
    expect(module).toBeDefined()
    if (module === undefined) return

    const memory = createMemoryStorageContext()
    const remaining = makeState('workspace-remaining', 'profile-remaining', 100)
    await saveState(memory.repositories, remaining, true)
    await memory.repositories.selection.setActiveWorkspaceId('workspace-deleted')

    const service = module.createWorkspaceService({ repositories: memory.repositories, atomic: memory.atomicOperations })
    const active = await service.getActive()

    expect(active.workspace.id).toBe('workspace-remaining')
    await expect(memory.repositories.selection.getActiveWorkspaceId()).resolves.toBe('workspace-remaining')
  })

  it('uses workspace id as the tie-breaker for equal creation timestamps', async () => {
    const module = await loadWorkspaceServiceModule()
    expect(module).toBeDefined()
    if (module === undefined) return

    const memory = createMemoryStorageContext()
    const z = makeState('workspace-z', 'profile-z', 100)
    const a = makeState('workspace-a', 'profile-a', 100)
    await saveState(memory.repositories, z, true)
    await saveState(memory.repositories, a)

    const service = module.createWorkspaceService({ repositories: memory.repositories, atomic: memory.atomicOperations })
    await expect(service.getActive()).resolves.toMatchObject({ workspace: { id: 'workspace-a' } })
  })

  it('atomically recreates the default private workspace when no workspace remains', async () => {
    const module = await loadWorkspaceServiceModule()
    expect(module).toBeDefined()
    if (module === undefined) return

    const memory = createMemoryStorageContext()
    const defaults = createDefaultWorkspaceState(100)
    await memory.repositories.preferences.save(defaults.preferences)

    const service = module.createWorkspaceService({
      repositories: memory.repositories,
      atomic: memory.atomicOperations,
      now: () => 500
    })
    const active = await service.getActive()

    expect(active.workspace).toMatchObject({
      id: DEFAULT_WORKSPACE_ID,
      activeRuleProfileId: DEFAULT_PROFILE_ID,
      storageMode: 'private-session',
      createdAt: 500
    })
    expect(active.profile.id).toBe(DEFAULT_PROFILE_ID)
    expect(active.config.privacy).toEqual({ autoSave: false, privacyMode: true })
    await expect(memory.repositories.selection.getActiveWorkspaceId()).resolves.toBe(DEFAULT_WORKSPACE_ID)
  })

  it('does not leave partial recovery records when the atomic create operation fails', async () => {
    const module = await loadWorkspaceServiceModule()
    expect(module).toBeDefined()
    if (module === undefined) return

    const memory = createMemoryStorageContext()
    const defaults = createDefaultWorkspaceState(100)
    await memory.repositories.preferences.save(defaults.preferences)
    const atomic: AtomicWithCreate = {
      ...(memory.atomicOperations as AtomicWithCreate),
      async createWorkspaceAndActivate() {
        throw new Error('forced atomic failure')
      }
    }

    const service = module.createWorkspaceService({
      repositories: memory.repositories,
      atomic,
      now: () => 500
    })

    await expect(service.getActive()).rejects.toThrow('forced atomic failure')
    await expect(memory.repositories.workspaces.list()).resolves.toEqual([])
    await expect(memory.repositories.profiles.get(DEFAULT_PROFILE_ID)).resolves.toBeUndefined()
    await expect(memory.repositories.selection.getActiveWorkspaceId()).resolves.toBeUndefined()
  })
})
