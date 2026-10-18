import { describe, expect, test } from 'vitest'
import { createDefaultWorkspaceState } from '../../src/core/workspace/defaults'
import { createMemoryStorageContext } from '../../src/storage/repositories/memory'
import { createWorkspaceService } from '../../src/workspace/workspace-service'

describe('Workspace snapshot policy', () => {
  test('persists enabled and maxSnapshots without changing storage mode', async () => {
    const memory = createMemoryStorageContext(() => 500)
    const state = createDefaultWorkspaceState(100)
    state.workspace.id = 'w1'
    state.workspace.activeRuleProfileId = 'p1'
    state.workspace.storageMode = 'local-library'
    state.profile.id = 'p1'
    await memory.repositories.preferences.save(state.preferences)
    await memory.atomicOperations.createWorkspaceAndActivate(state.workspace, state.profile)
    const service = createWorkspaceService({
      repositories: memory.repositories,
      atomic: memory.atomicOperations,
      now: () => 500,
      durableBackend: true
    })

    const updated = await service.updateSnapshotPolicy('w1', { enabled: true, maxSnapshots: 42 })

    expect(updated.snapshotPolicy).toEqual({ enabled: true, maxSnapshots: 42 })
    expect(updated.storageMode).toBe('local-library')
    expect(updated.updatedAt).toBe(500)
    expect((await memory.repositories.workspaces.get('w1'))?.snapshotPolicy).toEqual({ enabled: true, maxSnapshots: 42 })
  })

  test('rejects maxSnapshots outside 1..1000 without persisting partial changes', async () => {
    const memory = createMemoryStorageContext(() => 500)
    const state = createDefaultWorkspaceState(100)
    state.workspace.id = 'w1'
    state.workspace.activeRuleProfileId = 'p1'
    state.profile.id = 'p1'
    await memory.repositories.preferences.save(state.preferences)
    await memory.atomicOperations.createWorkspaceAndActivate(state.workspace, state.profile)
    const service = createWorkspaceService({
      repositories: memory.repositories,
      atomic: memory.atomicOperations,
      now: () => 500
    })

    await expect(service.updateSnapshotPolicy('w1', { enabled: true, maxSnapshots: 0 })).rejects.toThrow()
    await expect(service.updateSnapshotPolicy('w1', { enabled: true, maxSnapshots: 1001 })).rejects.toThrow()
    expect((await memory.repositories.workspaces.get('w1'))?.snapshotPolicy).toEqual({ enabled: false, maxSnapshots: 20 })
  })
})
