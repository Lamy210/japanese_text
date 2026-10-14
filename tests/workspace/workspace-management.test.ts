import { describe, expect, it, vi } from 'vitest'
import { createDefaultWorkspaceState } from '../../src/core/workspace/defaults'
import type { AppConfig } from '../../src/core/config/schema'
import type { GlobalPreferences, RuleProfile, StorageMode, Workspace } from '../../src/core/workspace/types'
import { createMemoryStorageContext } from '../../src/storage/repositories/memory'
import type { AtomicOperationsPort, StorageRepositories } from '../../src/storage/repositories/ports'

interface WorkspaceContext {
  workspace: Workspace
  profile: RuleProfile
  preferences: GlobalPreferences
  config: AppConfig
}

interface WorkspaceSummary {
  id: string
  name: string
  storageMode: StorageMode
  active: boolean
}

interface WorkspaceService {
  list(): Promise<WorkspaceSummary[]>
  create(input: { name: string }): Promise<WorkspaceContext>
  rename(workspaceId: string, name: string): Promise<Workspace>
}

interface WorkspaceServiceModule {
  createWorkspaceService(deps: {
    repositories: StorageRepositories
    atomic: AtomicOperationsPort
    now?: () => number
    generateId?: (kind: 'workspace' | 'profile') => string
  }): WorkspaceService
}

async function loadModule(): Promise<WorkspaceServiceModule | undefined> {
  return vi
    .importActual<WorkspaceServiceModule>('../../src/workspace/workspace-service')
    .catch(() => undefined)
}

async function seedActiveWorkspace() {
  const memory = createMemoryStorageContext()
  const state = createDefaultWorkspaceState(100)
  state.profile.ngWords = [{ id: 'ng-source', word: 'source', severity: 'warning' }]
  await memory.repositories.preferences.save(state.preferences)
  await memory.repositories.profiles.save(state.profile)
  await memory.repositories.workspaces.save(state.workspace)
  await memory.repositories.selection.setActiveWorkspaceId(state.workspace.id)
  return { memory, state }
}

describe('WorkspaceService management', () => {
  it('creates a private workspace with a cloned active profile and activates it', async () => {
    const module = await loadModule()
    expect(module).toBeDefined()
    if (module === undefined) return

    const { memory, state } = await seedActiveWorkspace()
    const ids = { workspace: 'workspace-new', profile: 'profile-new' }
    const service = module.createWorkspaceService({
      repositories: memory.repositories,
      atomic: memory.atomicOperations,
      now: () => 500,
      generateId: (kind) => ids[kind]
    })

    const created = await service.create({ name: '  Support Reply  ' })

    expect(created.workspace).toMatchObject({
      id: 'workspace-new',
      name: 'Support Reply',
      activeRuleProfileId: 'profile-new',
      storageMode: 'private-session',
      snapshotPolicy: { enabled: false, maxSnapshots: 20 },
      createdAt: 500,
      updatedAt: 500
    })
    expect(created.profile).toMatchObject({
      id: 'profile-new',
      sourcePresetId: state.profile.sourcePresetId,
      ngWords: state.profile.ngWords,
      createdAt: 500,
      updatedAt: 500
    })
    await expect(memory.repositories.selection.getActiveWorkspaceId()).resolves.toBe('workspace-new')

    created.profile.ngWords[0]!.word = 'mutated clone'
    await expect(memory.repositories.profiles.get(state.profile.id)).resolves.toMatchObject({
      ngWords: [{ word: 'source' }]
    })
  })

  it('lists workspaces in stable creation order and marks the active one', async () => {
    const module = await loadModule()
    expect(module).toBeDefined()
    if (module === undefined) return

    const { memory, state } = await seedActiveWorkspace()
    const other = createDefaultWorkspaceState(200)
    other.workspace.id = 'workspace-z'
    other.workspace.name = 'Z'
    other.workspace.activeRuleProfileId = 'profile-z'
    other.profile.id = 'profile-z'
    await memory.repositories.profiles.save(other.profile)
    await memory.repositories.workspaces.save(other.workspace)

    const service = module.createWorkspaceService({ repositories: memory.repositories, atomic: memory.atomicOperations })
    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({ id: state.workspace.id, active: true }),
      expect.objectContaining({ id: 'workspace-z', active: false })
    ])
  })

  it('renames a workspace after trimming while preserving identity and policy', async () => {
    const module = await loadModule()
    expect(module).toBeDefined()
    if (module === undefined) return

    const { memory, state } = await seedActiveWorkspace()
    const service = module.createWorkspaceService({
      repositories: memory.repositories,
      atomic: memory.atomicOperations,
      now: () => 800
    })

    const renamed = await service.rename(state.workspace.id, '  Renamed Workspace  ')
    expect(renamed).toMatchObject({
      id: state.workspace.id,
      name: 'Renamed Workspace',
      activeRuleProfileId: state.workspace.activeRuleProfileId,
      storageMode: state.workspace.storageMode,
      createdAt: state.workspace.createdAt,
      updatedAt: 800
    })
  })

  it('rejects invalid workspace names using Unicode code points and control-character checks', async () => {
    const module = await loadModule()
    expect(module).toBeDefined()
    if (module === undefined) return

    const { memory, state } = await seedActiveWorkspace()
    const service = module.createWorkspaceService({ repositories: memory.repositories, atomic: memory.atomicOperations })

    await expect(service.rename(state.workspace.id, '   ')).rejects.toThrow()
    await expect(service.rename(state.workspace.id, '😀'.repeat(81))).rejects.toThrow()
    await expect(service.rename(state.workspace.id, 'bad\nname')).rejects.toThrow()
    await expect(service.create({ name: '\u0000invalid' })).rejects.toThrow()
  })

  it('allows duplicate display names because workspace id is the identity', async () => {
    const module = await loadModule()
    expect(module).toBeDefined()
    if (module === undefined) return

    const { memory, state } = await seedActiveWorkspace()
    const other = createDefaultWorkspaceState(200)
    other.workspace.id = 'workspace-other'
    other.workspace.name = 'Duplicate'
    other.workspace.activeRuleProfileId = 'profile-other'
    other.profile.id = 'profile-other'
    await memory.repositories.profiles.save(other.profile)
    await memory.repositories.workspaces.save(other.workspace)

    const service = module.createWorkspaceService({ repositories: memory.repositories, atomic: memory.atomicOperations })
    await expect(service.rename(state.workspace.id, 'Duplicate')).resolves.toMatchObject({ name: 'Duplicate' })
  })
})
