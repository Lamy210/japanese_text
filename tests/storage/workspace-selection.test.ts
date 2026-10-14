import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../../src/storage/db/open-database'
import { createIndexedDbRepositories } from '../../src/storage/repositories/indexeddb'
import { createMemoryStorageContext } from '../../src/storage/repositories/memory'

type SelectionRepository = {
  getActiveWorkspaceId(): Promise<string | undefined>
  setActiveWorkspaceId(workspaceId: string): Promise<void>
}

type StorageRuntimeExport = {
  getStorageContext(): Promise<{
    repositories: {
      workspaces: { list(): Promise<Array<{ id: string; activeRuleProfileId: string }>> }
      profiles: {
        get(id: string): Promise<
          | {
              id: string
              name: string
              rules: Record<string, unknown>
              ngWords: Array<{ id: string; word: string; severity: 'error' | 'warning' | 'info' }>
              terminology: unknown[]
              citation: unknown
              formatter: unknown
              customRules: unknown[]
              createdAt: number
              updatedAt: number
            }
          | undefined
        >
        save(value: unknown): Promise<void>
      }
    }
  }>
}

function selectionFrom(repositories: unknown): SelectionRepository | undefined {
  if (typeof repositories !== 'object' || repositories === null) return undefined
  return (repositories as { selection?: SelectionRepository }).selection
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'indexedDB')
  vi.resetModules()
})

describe('workspace selection repository', () => {
  it('stores the active workspace id in the memory adapter', async () => {
    const context = createMemoryStorageContext()
    const selection = selectionFrom(context.repositories)

    expect(selection).toBeDefined()
    if (selection === undefined) return

    await expect(selection.getActiveWorkspaceId()).resolves.toBeUndefined()
    await selection.setActiveWorkspaceId('workspace-a')
    await expect(selection.getActiveWorkspaceId()).resolves.toBe('workspace-a')
  })

  it('stores the active workspace id in the IndexedDB meta store', async () => {
    const db = await openDatabase(new IDBFactory())
    try {
      const repositories = createIndexedDbRepositories(db)
      const selection = selectionFrom(repositories)

      expect(selection).toBeDefined()
      if (selection === undefined) return

      await expect(selection.getActiveWorkspaceId()).resolves.toBeUndefined()
      await selection.setActiveWorkspaceId('workspace-b')
      await expect(selection.getActiveWorkspaceId()).resolves.toBe('workspace-b')
    } finally {
      db.close()
    }
  })

  it('shares one memory fallback context between the facade and runtime consumers', async () => {
    Reflect.deleteProperty(globalThis, 'indexedDB')
    vi.resetModules()

    const storage = await import('../../src/storage/storage')
    expect('getStorageContext' in storage).toBe(true)
    if (!('getStorageContext' in storage)) return

    const runtime = storage as typeof storage & StorageRuntimeExport
    const context = await runtime.getStorageContext()
    const [workspace] = await context.repositories.workspaces.list()
    expect(workspace).toBeDefined()
    if (workspace === undefined) return

    const profile = await context.repositories.profiles.get(workspace.activeRuleProfileId)
    expect(profile).toBeDefined()
    if (profile === undefined) return

    profile.ngWords = [{ id: 'shared-runtime', word: '共有状態', severity: 'warning' }]
    await context.repositories.profiles.save(profile)

    await expect(storage.loadConfig()).resolves.toMatchObject({
      ngWords: [{ id: 'shared-runtime', word: '共有状態', severity: 'warning' }]
    })
  })
})
