import { describe, expect, it } from 'vitest'
import { createDefaultWorkspaceState } from '../../src/core/workspace/defaults'
import { createMemoryStorageContext } from '../../src/storage/repositories/memory'
import { defineRepositoryContract } from './repository-contract'

defineRepositoryContract('memory', () => createMemoryStorageContext().repositories)

describe('memory storage atomic operations', () => {
  it('reports migration as not needed', async () => {
    const context = createMemoryStorageContext()
    await expect(context.atomicOperations.migrateV1ToV2()).resolves.toEqual({ state: 'not-needed' })
  })

  it('deletes a workspace cascade without deleting its profile', async () => {
    const context = createMemoryStorageContext()
    const state = createDefaultWorkspaceState(1000)

    await context.repositories.workspaces.save(state.workspace)
    await context.repositories.profiles.save(state.profile)
    await context.repositories.documents.save({
      id: 'doc-1',
      workspaceId: state.workspace.id,
      name: 'draft.md',
      docType: 'markdown',
      content: 'draft',
      sourceKind: 'local',
      createdAt: 1000,
      updatedAt: 1000
    })

    await context.atomicOperations.deleteWorkspaceCascade(state.workspace.id)

    expect(await context.repositories.workspaces.get(state.workspace.id)).toBeUndefined()
    expect(await context.repositories.documents.listByWorkspace(state.workspace.id)).toEqual([])
    expect(await context.repositories.profiles.get(state.profile.id)).toEqual(state.profile)
  })

  it('validates records before writing', async () => {
    const context = createMemoryStorageContext()

    await expect(
      context.repositories.workspaces.save({
        ...createDefaultWorkspaceState(1000).workspace,
        storageMode: 'invalid' as never
      })
    ).rejects.toThrow()
  })
})
