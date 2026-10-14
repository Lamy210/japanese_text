import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultWorkspaceState } from '../../src/core/workspace/defaults'
import { createIndexedDbAtomicOperations } from '../../src/storage/db/indexeddb-atomic-operations'
import { openDatabase } from '../../src/storage/db/open-database'
import { createIndexedDbRepositories } from '../../src/storage/repositories/indexeddb'
import { createMemoryStorageContext } from '../../src/storage/repositories/memory'

type SelectionRepository = {
  getActiveWorkspaceId(): Promise<string | undefined>
  setActiveWorkspaceId(workspaceId: string): Promise<void>
}

type CreateAndActivate = (
  workspace: ReturnType<typeof createDefaultWorkspaceState>['workspace'],
  profile: ReturnType<typeof createDefaultWorkspaceState>['profile']
) => Promise<void>

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

function createAndActivateFrom(atomic: unknown): CreateAndActivate | undefined {
  if (typeof atomic !== 'object' || atomic === null) return undefined
  const operation = (atomic as { createWorkspaceAndActivate?: CreateAndActivate }).createWorkspaceAndActivate
  return operation?.bind(atomic)
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

  it('creates an IndexedDB workspace, profile, and active selection atomically', async () => {
    const db = await openDatabase(new IDBFactory())
    try {
      const repositories = createIndexedDbRepositories(db)
      const atomic = createIndexedDbAtomicOperations(db, () => 1000)
      const createAndActivate = createAndActivateFrom(atomic)
      expect(createAndActivate).toBeDefined()
      if (createAndActivate === undefined) return

      const state = createDefaultWorkspaceState(1000)
      state.workspace.id = 'workspace-created'
      state.workspace.activeRuleProfileId = 'profile-created'
      state.profile.id = 'profile-created'

      await createAndActivate(state.workspace, state.profile)

      await expect(repositories.workspaces.get(state.workspace.id)).resolves.toEqual(state.workspace)
      await expect(repositories.profiles.get(state.profile.id)).resolves.toEqual(state.profile)
      await expect(repositories.selection.getActiveWorkspaceId()).resolves.toBe(state.workspace.id)
    } finally {
      db.close()
    }
  })

  it('does not partially create IndexedDB state when create-and-activate validation fails', async () => {
    const db = await openDatabase(new IDBFactory())
    try {
      const repositories = createIndexedDbRepositories(db)
      const atomic = createIndexedDbAtomicOperations(db)
      const createAndActivate = createAndActivateFrom(atomic)
      expect(createAndActivate).toBeDefined()
      if (createAndActivate === undefined) return

      const state = createDefaultWorkspaceState(1000)
      state.workspace.id = 'workspace-invalid'
      state.workspace.activeRuleProfileId = 'profile-invalid'
      state.profile.id = ''

      await expect(createAndActivate(state.workspace, state.profile)).rejects.toThrow()
      await expect(repositories.workspaces.get('workspace-invalid')).resolves.toBeUndefined()
      await expect(repositories.selection.getActiveWorkspaceId()).resolves.toBeUndefined()
    } finally {
      db.close()
    }
  })
})
