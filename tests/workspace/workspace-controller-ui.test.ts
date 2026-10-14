import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStorageContext, type StorageContext } from '../../src/storage/bootstrap'
import type { StorageCapability } from '../../src/workspace/storage-capability'

interface UiWorkspaceController {
  bootstrap(): Promise<void>
  refresh(): Promise<void>
  switchWorkspace(workspaceId: string): Promise<void>
  createWorkspace(name: string): Promise<void>
  renameWorkspace(workspaceId: string, name: string): Promise<void>
  deleteWorkspace(workspaceId: string): Promise<void>
  setStorageMode(mode: 'private-session' | 'local-library'): Promise<void>
  requestPersistence(): Promise<StorageCapability>
}

async function harness(
  context: StorageContext,
  storageManager?: {
    estimate?: () => Promise<{ usage?: number; quota?: number }>
    persisted?: () => Promise<boolean>
    persist?: () => Promise<boolean>
  }
) {
  vi.resetModules()
  const [{ appState }, module] = await Promise.all([
    import('../../src/state/app-state'),
    import('../../src/state/workspace-controller')
  ])
  const relint = vi.fn()
  const cancelPendingDocumentPersistence = vi.fn()
  const controller = module.createWorkspaceController({
    getContext: async () => context,
    relint,
    toast: vi.fn(),
    storageManager,
    cancelPendingDocumentPersistence
  } as never) as unknown as UiWorkspaceController
  return { appState, controller, relint, cancelPendingDocumentPersistence }
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'indexedDB')
  vi.resetModules()
})

describe('workspace UI controller operations', () => {
  it('treats selecting the current workspace as a no-op', async () => {
    const context = await createStorageContext({ factory: new IDBFactory(), now: () => 100 })
    const { appState, controller, relint } = await harness(context)
    await controller.bootstrap()
    const active = appState.activeWorkspaceId()!

    await controller.switchWorkspace(active)

    expect(appState.activeWorkspaceId()).toBe(active)
    expect(relint).toHaveBeenCalledTimes(1)
  })

  it('creates and activates a new private workspace while preserving the previous private body', async () => {
    const context = await createStorageContext({
      factory: { open() { throw new Error('memory') } } as unknown as IDBFactory,
      now: () => 200
    })
    const { appState, controller } = await harness(context)
    await controller.bootstrap()
    const original = appState.activeWorkspaceId()!
    appState.setDocument('original private body', 'original.md', 'markdown')

    await controller.createWorkspace('Second')

    const created = appState.activeWorkspaceId()!
    expect(created).not.toBe(original)
    expect(appState.workspaceSummaries()).toContainEqual(expect.objectContaining({
      id: created,
      name: 'Second',
      storageMode: 'private-session',
      active: true
    }))

    await controller.switchWorkspace(original)
    expect(appState.documentText()).toBe('original private body')
    expect(appState.documentName()).toBe('original.md')
  })

  it('cancels queued persistence before switching away from a Local Library workspace', async () => {
    const context = await createStorageContext({ factory: new IDBFactory(), now: () => 250 })
    const { appState, controller, cancelPendingDocumentPersistence } = await harness(context)
    await controller.bootstrap()
    const localWorkspaceId = appState.activeWorkspaceId()!
    appState.setDocument('local body', 'local.md', 'markdown')
    await controller.setStorageMode('local-library')
    await controller.createWorkspace('Second')
    const secondWorkspaceId = appState.activeWorkspaceId()!
    await controller.switchWorkspace(localWorkspaceId)

    cancelPendingDocumentPersistence.mockClear()
    appState.setDocument('fresh local body', 'local.md', 'markdown')
    await controller.switchWorkspace(secondWorkspaceId)

    expect(cancelPendingDocumentPersistence).toHaveBeenCalledTimes(1)
  })

  it('does not optimistically mutate state when rename validation fails', async () => {
    const context = await createStorageContext({ factory: new IDBFactory(), now: () => 300 })
    const { appState, controller } = await harness(context)
    await controller.bootstrap()
    const active = appState.activeWorkspaceId()!
    const before = structuredClone(appState.workspaceSummaries())

    await expect(controller.renameWorkspace(active, '   ')).rejects.toThrow()

    expect(appState.workspaceSummaries()).toEqual(before)
  })

  it('rejects deleting the last workspace without changing application state', async () => {
    const context = await createStorageContext({ factory: new IDBFactory(), now: () => 400 })
    const { appState, controller } = await harness(context)
    await controller.bootstrap()
    const active = appState.activeWorkspaceId()!

    await expect(controller.deleteWorkspace(active)).rejects.toThrow('last workspace')

    expect(appState.activeWorkspaceId()).toBe(active)
    expect(appState.workspaceSummaries()).toHaveLength(1)
  })

  it('rejects Local Library in memory fallback through the controller', async () => {
    const context = await createStorageContext({
      factory: { open() { throw new Error('memory') } } as unknown as IDBFactory,
      now: () => 500
    })
    const { appState, controller } = await harness(context)
    await controller.bootstrap()
    appState.setDocument('private body', 'draft.md', 'markdown')

    await expect(controller.setStorageMode('local-library')).rejects.toThrow('durable')

    expect(appState.config.privacy).toEqual({ autoSave: false, privacyMode: true })
  })

  it('cancels queued persistence and keeps the editor body when moving Local Library to Private Session', async () => {
    const context = await createStorageContext({ factory: new IDBFactory(), now: () => 600 })
    const { appState, controller, cancelPendingDocumentPersistence } = await harness(context)
    await controller.bootstrap()
    appState.setDocument('keep me', 'keep.md', 'markdown')
    await controller.setStorageMode('local-library')

    appState.setDocument('newest editor body', 'keep.md', 'markdown')
    await controller.setStorageMode('private-session')

    expect(cancelPendingDocumentPersistence).toHaveBeenCalled()
    expect(appState.documentText()).toBe('newest editor body')
    expect(appState.config.privacy).toEqual({ autoSave: false, privacyMode: true })
    await expect(context.repositories.documents.listByWorkspace(appState.activeWorkspaceId()!)).resolves.toEqual([])
  })

  it('keeps persistence denial non-fatal and updates capability state', async () => {
    const context = await createStorageContext({ factory: new IDBFactory(), now: () => 700 })
    const { appState, controller } = await harness(context, {
      persisted: async () => false,
      persist: async () => false
    })
    await controller.bootstrap()

    await expect(controller.requestPersistence()).resolves.toMatchObject({ persisted: false })
    expect(appState.storageCapability()).toMatchObject({ persisted: false })
  })
})