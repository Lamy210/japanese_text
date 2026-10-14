import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/storage/db/open-database'
import { createIndexedDbRepositories } from '../../src/storage/repositories/indexeddb'
import { createMemoryStorageContext } from '../../src/storage/repositories/memory'

type SelectionRepository = {
  getActiveWorkspaceId(): Promise<string | undefined>
  setActiveWorkspaceId(workspaceId: string): Promise<void>
}

function selectionFrom(repositories: unknown): SelectionRepository | undefined {
  if (typeof repositories !== 'object' || repositories === null) return undefined
  return (repositories as { selection?: SelectionRepository }).selection
}

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
})
