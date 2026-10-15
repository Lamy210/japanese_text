import { describe, expect, it } from 'vitest'
import { createDefaultWorkspaceState } from '../../src/core/workspace/defaults'
import type { StoredWorkspaceDocument } from '../../src/core/workspace/types'
import { createMemoryStorageContext } from '../../src/storage/repositories/memory'
import { createWorkspaceService } from '../../src/workspace/workspace-service'

async function seedTwoWorkspaces() {
  const memory = createMemoryStorageContext(() => 9000)
  const preferences = createDefaultWorkspaceState(1).preferences
  await memory.repositories.preferences.save(preferences)

  const a = createDefaultWorkspaceState(100)
  a.workspace.id = 'workspace-a'
  a.workspace.name = 'A'
  a.workspace.activeRuleProfileId = 'profile-a'
  a.profile.id = 'profile-a'

  const b = createDefaultWorkspaceState(200)
  b.workspace.id = 'workspace-b'
  b.workspace.name = 'B'
  b.workspace.activeRuleProfileId = 'profile-b'
  b.profile.id = 'profile-b'

  await memory.repositories.profiles.save(a.profile)
  await memory.repositories.profiles.save(b.profile)
  await memory.repositories.workspaces.save(a.workspace)
  await memory.repositories.workspaces.save(b.workspace)
  await memory.repositories.selection.setActiveWorkspaceId(a.workspace.id)
  return { memory, a, b }
}

function document(workspaceId: string): StoredWorkspaceDocument {
  return {
    id: 'doc-a',
    workspaceId,
    name: 'a.md',
    content: 'body',
    docType: 'markdown',
    sourceKind: 'local',
    createdAt: 1,
    updatedAt: 1
  }
}

describe('Phase 2C WorkspaceService responsibilities', () => {
  it('switchTo changes workspace selection/context without reading or writing document repositories', async () => {
    const { memory, b } = await seedTwoWorkspaces()
    const repositories = {
      ...memory.repositories,
      documents: {
        async listByWorkspace(): Promise<never> {
          throw new Error('WorkspaceService must not list documents')
        },
        async get(): Promise<never> {
          throw new Error('WorkspaceService must not get documents')
        },
        async save(): Promise<never> {
          throw new Error('WorkspaceService must not save documents')
        },
        async delete(): Promise<never> {
          throw new Error('WorkspaceService must not delete documents directly')
        }
      }
    }
    const service = createWorkspaceService({ repositories, atomic: memory.atomicOperations })

    const context = await service.switchTo(b.workspace.id)

    expect(context.workspace.id).toBe('workspace-b')
    await expect(memory.repositories.selection.getActiveWorkspaceId()).resolves.toBe('workspace-b')
  })

  it('enableLocalLibrary rejects non-durable storage before calling atomic persistence', async () => {
    const { memory, a } = await seedTwoWorkspaces()
    let atomicCalls = 0
    const atomic = {
      ...memory.atomicOperations,
      async enableLocalLibrary(...args: Parameters<typeof memory.atomicOperations.enableLocalLibrary>) {
        atomicCalls += 1
        return memory.atomicOperations.enableLocalLibrary(...args)
      }
    }
    const service = createWorkspaceService({
      repositories: memory.repositories,
      atomic,
      durableBackend: false
    })
    const doc = document(a.workspace.id)

    await expect(service.enableLocalLibrary(a.workspace.id, [doc], doc.id)).rejects.toThrow(
      'Local Library requires durable browser storage'
    )
    expect(atomicCalls).toBe(0)
  })

  it('enableLocalLibrary delegates the whole library snapshot and returns the updated context', async () => {
    const { memory, a } = await seedTwoWorkspaces()
    const service = createWorkspaceService({
      repositories: memory.repositories,
      atomic: memory.atomicOperations,
      durableBackend: true
    })
    const first = document(a.workspace.id)
    const second = { ...document(a.workspace.id), id: 'doc-b', name: 'b.md' }

    const context = await service.enableLocalLibrary(a.workspace.id, [first, second], second.id)

    expect(context.workspace.storageMode).toBe('local-library')
    expect((await memory.repositories.documents.listByWorkspace(a.workspace.id)).map((value) => value.id).sort()).toEqual([
      'doc-a',
      'doc-b'
    ])
    await expect(memory.repositories.documentSelection.getActiveDocumentId(a.workspace.id)).resolves.toBe('doc-b')
  })

  it('makePrivate delegates the atomic privacy scrub and returns the updated context', async () => {
    const { memory, a } = await seedTwoWorkspaces()
    const first = document(a.workspace.id)
    await memory.atomicOperations.enableLocalLibrary(a.workspace.id, [first], first.id)
    const service = createWorkspaceService({
      repositories: memory.repositories,
      atomic: memory.atomicOperations,
      durableBackend: true
    })

    const context = await service.makePrivate(a.workspace.id)

    expect(context.workspace.storageMode).toBe('private-session')
    await expect(memory.repositories.documents.listByWorkspace(a.workspace.id)).resolves.toEqual([])
    await expect(memory.repositories.documentSelection.getActiveDocumentId(a.workspace.id)).resolves.toBeUndefined()
  })
})
