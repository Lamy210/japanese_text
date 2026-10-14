import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultConfig } from '../../src/core/config/validate'
import { DEFAULT_WORKSPACE_ID } from '../../src/core/workspace/defaults'
import { createStorageContext } from '../../src/storage/bootstrap'
import { createWorkspaceService } from '../../src/workspace/workspace-service'

const DB_NAME = 'japanese-writing-toolkit'

function installIndexedDb(factory: IDBFactory): void {
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    writable: true,
    value: factory
  })
}

async function loadFacade(factory: IDBFactory) {
  installIndexedDb(factory)
  vi.resetModules()
  return import('../../src/storage/storage')
}

async function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'))
  })
}

async function createLegacyDatabase(
  factory: IDBFactory,
  config: unknown,
  document?: { name: string; content: string; docType: 'markdown' | 'text'; updatedAt: number }
): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('settings')
      request.result.createObjectStore('documents')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('legacy open failed'))
  })
  const tx = db.transaction(['settings', 'documents'], 'readwrite')
  const done = transactionDone(tx)
  tx.objectStore('settings').put(config, 'app-config')
  if (document !== undefined) tx.objectStore('documents').put(document, 'recent')
  await done
  db.close()
}

async function readRaw(factory: IDBFactory, storeName: string, key: IDBValidKey): Promise<unknown> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DB_NAME, 2)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('open failed'))
  })
  try {
    const tx = db.transaction(storeName, 'readonly')
    const done = transactionDone(tx)
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = tx.objectStore(storeName).get(key)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('get failed'))
    })
    await done
    return value
  } finally {
    db.close()
  }
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'indexedDB')
  vi.resetModules()
})

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

describe('legacy-compatible storage facade', () => {
  it('returns a canonical private config for a fresh database', async () => {
    const facade = await loadFacade(new IDBFactory())

    await expect(facade.loadConfig()).resolves.toMatchObject({
      privacy: { autoSave: false, privacyMode: true },
      preset: 'general'
    })
  })

  it('persists config/profile changes while preserving the canonical workspace privacy mode', async () => {
    const facade = await loadFacade(new IDBFactory())
    const config = createDefaultConfig()
    config.theme = 'dark'
    config.editor.fontSize = 19
    config.privacy = { autoSave: true, privacyMode: false }
    config.ngWords = [{ id: 'ng-1', word: '禁止', severity: 'error' }]

    await facade.saveConfig(config)

    await expect(facade.loadConfig()).resolves.toMatchObject({
      theme: 'dark',
      editor: { fontSize: 19 },
      ngWords: [{ id: 'ng-1', word: '禁止', severity: 'error' }],
      privacy: { autoSave: false, privacyMode: true }
    })
  })

  it('persists and restores a recent document only after explicit Local Library opt-in', async () => {
    const facade = await loadFacade(new IDBFactory())
    const context = await facade.getStorageContext()
    const service = createWorkspaceService({
      repositories: context.repositories,
      atomic: context.atomic,
      durableBackend: context.durable
    })
    const active = await service.getActive()
    const document = { name: 'draft.md', content: '# Draft', docType: 'markdown' as const, updatedAt: 5000 }

    await service.setStorageMode(active.workspace.id, 'local-library', document)
    await facade.saveRecentDocument(document)

    await expect(facade.loadRecentDocument()).resolves.toEqual(document)
  })

  it('does not persist a recent document in private-session mode', async () => {
    const factory = new IDBFactory()
    const facade = await loadFacade(factory)

    await facade.saveRecentDocument({ name: 'secret.md', content: 'secret', docType: 'markdown', updatedAt: 5000 })

    await expect(facade.loadRecentDocument()).resolves.toBeUndefined()
    await expect(readRaw(factory, 'workspaceDocuments', 'local-recent-document')).resolves.toBeUndefined()
  })

  it('restores a migrated local-library recent document', async () => {
    const factory = new IDBFactory()
    const config = createDefaultConfig()
    config.privacy = { autoSave: true, privacyMode: false }
    const document = { name: 'legacy.md', content: 'legacy body', docType: 'markdown' as const, updatedAt: 123 }
    await createLegacyDatabase(factory, config, document)
    const facade = await loadFacade(factory)

    await expect(facade.loadRecentDocument()).resolves.toEqual(document)
  })

  it('does not restore a stale legacy body for a migrated private user', async () => {
    const factory = new IDBFactory()
    const config = createDefaultConfig()
    config.privacy = { autoSave: false, privacyMode: true }
    await createLegacyDatabase(factory, config, {
      name: 'secret.md', content: 'stale secret', docType: 'markdown', updatedAt: 123
    })
    const facade = await loadFacade(factory)

    await expect(facade.loadRecentDocument()).resolves.toBeUndefined()
  })

  it('explicit deletion removes v2 body and legacy recent body without dropping the legacy store', async () => {
    const factory = new IDBFactory()
    const config = createDefaultConfig()
    config.privacy = { autoSave: true, privacyMode: false }
    const document = { name: 'legacy.md', content: 'legacy body', docType: 'markdown' as const, updatedAt: 123 }
    await createLegacyDatabase(factory, config, document)
    const facade = await loadFacade(factory)

    expect(await facade.loadRecentDocument()).toEqual(document)
    await facade.deleteRecentDocument()

    await expect(facade.loadRecentDocument()).resolves.toBeUndefined()
    await expect(readRaw(factory, 'documents', 'recent')).resolves.toBeUndefined()
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(DB_NAME, 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('open failed'))
    })
    expect([...db.objectStoreNames]).toContain('documents')
    db.close()
  })

  it('does not return corrupt v2 records as trusted config', async () => {
    const factory = new IDBFactory()
    const facade = await loadFacade(factory)
    expect(await facade.loadConfig()).toBeDefined()

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(DB_NAME, 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('open failed'))
    })
    const tx = db.transaction('workspaces', 'readwrite')
    const done = transactionDone(tx)
    tx.objectStore('workspaces').put({ id: DEFAULT_WORKSPACE_ID, storageMode: 'local-library' })
    await done
    db.close()

    await expect(facade.loadConfig()).resolves.toBeUndefined()
  })

  it('does not leak IndexedDB initialization failure from loadConfig', async () => {
    const failingFactory = {
      open() {
        throw new Error('forced open failure')
      }
    } as unknown as IDBFactory
    const facade = await loadFacade(failingFactory)

    await expect(facade.loadConfig()).resolves.toMatchObject({
      privacy: { autoSave: false, privacyMode: true }
    })
  })
})
