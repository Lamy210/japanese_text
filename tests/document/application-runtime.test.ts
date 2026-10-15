import { describe, expect, it } from 'vitest'
import { createApplicationRuntime } from '../../src/state/application-runtime'
import type { StorageContext } from '../../src/storage/bootstrap'
import { createMemoryStorageContext } from '../../src/storage/repositories/memory'

function memoryStorageContext(): StorageContext {
  const memory = createMemoryStorageContext()
  return {
    durable: false,
    repositories: memory.repositories,
    atomic: memory.atomicOperations,
    migration: { state: 'not-needed' }
  }
}

describe('ApplicationRuntime', () => {
  it('shares one storage context promise, session library, and service instances', async () => {
    const context = memoryStorageContext()
    let contextLoads = 0
    const runtime = createApplicationRuntime({
      getContext: () => {
        contextLoads += 1
        return Promise.resolve(context)
      },
      now: () => 5000
    })

    const firstContextPromise = runtime.getStorageContext()
    const secondContextPromise = runtime.getStorageContext()
    expect(firstContextPromise).toBe(secondContextPromise)
    expect(await firstContextPromise).toBe(context)
    expect(contextLoads).toBe(1)

    expect(runtime.getSessionDocumentLibrary()).toBe(runtime.getSessionDocumentLibrary())

    const firstWorkspaceService = await runtime.getWorkspaceService()
    const secondWorkspaceService = await runtime.getWorkspaceService()
    expect(firstWorkspaceService).toBe(secondWorkspaceService)

    const firstDocumentService = await runtime.getDocumentService()
    const secondDocumentService = await runtime.getDocumentService()
    expect(firstDocumentService).toBe(secondDocumentService)
  })

  it('shares the same session library with DocumentService in memory fallback', async () => {
    const context = memoryStorageContext()
    const runtime = createApplicationRuntime({ getContext: () => Promise.resolve(context) })
    const workspace = {
      id: 'workspace-private',
      name: 'Private',
      activeRuleProfileId: 'profile',
      storageMode: 'private-session' as const,
      snapshotPolicy: { enabled: false, maxSnapshots: 20 },
      createdAt: 1,
      updatedAt: 1
    }

    const documentService = await runtime.getDocumentService()
    const created = await documentService.create(workspace, { name: 'shared.md', content: 'shared body' })
    const id = 'id' in created.document ? created.document.id : ''

    expect(runtime.getSessionDocumentLibrary().get(workspace.id, id)?.content).toBe('shared body')
  })
})
