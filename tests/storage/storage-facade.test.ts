import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { DEFAULT_WORKSPACE_ID } from '../../src/core/workspace/defaults'
import { createStorageContext } from '../../src/storage/bootstrap'

describe('storage bootstrap', () => {
  it('uses IndexedDB durably when a factory can be opened and migrated', async () => {
    const context = await createStorageContext({ factory: new IDBFactory(), now: () => 1000 })

    expect(context.durable).toBe(true)
    expect(context.migration).toEqual({ state: 'migrated' })
    expect(await context.repositories.workspaces.get(DEFAULT_WORKSPACE_ID)).toMatchObject({
      id: DEFAULT_WORKSPACE_ID,
      storageMode: 'private-session'
    })
    expect((await context.repositories.preferences.get())?.defaultStorageMode).toBe('private-session')
  })

  it('falls back to seeded memory storage when IndexedDB is unavailable', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
    try {
      Reflect.deleteProperty(globalThis, 'indexedDB')
      const context = await createStorageContext({ now: () => 2000 })

      expect(context.durable).toBe(false)
      expect(context.migration.state).toBe('failed')
      expect(context.migration.warning).toContain('IndexedDB')
      expect(await context.repositories.workspaces.get(DEFAULT_WORKSPACE_ID)).toMatchObject({
        storageMode: 'private-session',
        createdAt: 2000
      })
    } finally {
      if (original !== undefined) Object.defineProperty(globalThis, 'indexedDB', original)
    }
  })

  it('falls back to memory when opening IndexedDB fails', async () => {
    const failingFactory = {
      open() {
        throw new Error('forced open failure')
      }
    } as unknown as IDBFactory

    const context = await createStorageContext({ factory: failingFactory, now: () => 3000 })

    expect(context.durable).toBe(false)
    expect(context.migration).toMatchObject({ state: 'failed' })
    expect(context.migration.warning).toContain('forced open failure')
    expect(await context.repositories.workspaces.get(DEFAULT_WORKSPACE_ID)).toMatchObject({
      storageMode: 'private-session'
    })
  })

  it('keeps current-session memory reads and writes usable after fallback', async () => {
    const failingFactory = {
      open() {
        throw new Error('offline')
      }
    } as unknown as IDBFactory
    const context = await createStorageContext({ factory: failingFactory, now: () => 4000 })
    const workspace = await context.repositories.workspaces.get(DEFAULT_WORKSPACE_ID)
    expect(workspace).toBeDefined()

    await context.repositories.workspaces.save({ ...workspace!, name: 'Session Workspace', updatedAt: 5000 })

    expect((await context.repositories.workspaces.get(DEFAULT_WORKSPACE_ID))?.name).toBe('Session Workspace')
  })
})
