import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultWorkspaceState } from '../../src/core/workspace/defaults'
import { createStorageContext, type StorageContext } from '../../src/storage/bootstrap'

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'indexedDB')
  vi.resetModules()
})

async function loadControllerHarness(context: StorageContext) {
  vi.resetModules()
  const [{ appState }, { createWorkspaceController }] = await Promise.all([
    import('../../src/state/app-state'),
    import('../../src/state/workspace-controller')
  ])
  const relint = vi.fn()
  const toast = vi.fn()
  const controller = createWorkspaceController({
    getContext: async () => context,
    relint,
    toast,
    storageManager: undefined
  })
  return { appState, controller, relint, toast }
}

describe('workspace-aware application bootstrap', () => {
  it('boots the selected workspace/config and marks durable storage from the StorageContext', async () => {
    const context = await createStorageContext({ factory: new IDBFactory(), now: () => 100 })
    const { appState, controller, relint } = await loadControllerHarness(context)

    await controller.bootstrap()

    expect(appState.workspaceReady()).toBe(true)
    expect(appState.storageAvailable()).toBe(true)
    expect(appState.activeWorkspaceId()).toBeDefined()
    expect(appState.workspaceSummaries()).toEqual([
      expect.objectContaining({ id: appState.activeWorkspaceId(), active: true, storageMode: 'private-session' })
    ])
    expect(appState.config.privacy).toEqual({ autoSave: false, privacyMode: true })
    expect(appState.storageCapability()).toMatchObject({ durableBackend: true })
    expect(relint).toHaveBeenCalledTimes(1)
  })

  it('uses context.durable instead of the mere presence of a global IndexedDB object', async () => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: new IDBFactory()
    })
    const context = await createStorageContext({
      factory: { open() { throw new Error('forced fallback') } } as unknown as IDBFactory,
      now: () => 200
    })
    const { appState, controller } = await loadControllerHarness(context)

    await controller.bootstrap()

    expect(context.durable).toBe(false)
    expect(appState.storageAvailable()).toBe(false)
    expect(appState.storageCapability()).toMatchObject({ durableBackend: false })
    expect(appState.activeWorkspaceId()).toBeDefined()
  })

  it('restores a Local Library document on boot', async () => {
    const context = await createStorageContext({ factory: new IDBFactory(), now: () => 300 })
    const { createWorkspaceService } = await import('../../src/workspace/workspace-service')
    const service = createWorkspaceService({
      repositories: context.repositories,
      atomic: context.atomic,
      durableBackend: true
    })
    const active = await service.getActive()
    await service.setStorageMode(active.workspace.id, 'local-library', {
      name: 'saved.md',
      content: '# Restored',
      docType: 'markdown',
      updatedAt: 400
    })
    const { appState, controller } = await loadControllerHarness(context)

    await controller.bootstrap()

    expect(appState.documentName()).toBe('saved.md')
    expect(appState.documentText()).toBe('# Restored')
    expect(appState.config.privacy).toEqual({ autoSave: true, privacyMode: false })
  })

  it('keeps distinct Private Session bodies across A -> B -> A within one controller session', async () => {
    const context = await createStorageContext({
      factory: { open() { throw new Error('memory only') } } as unknown as IDBFactory,
      now: () => 500
    })
    const { appState, controller } = await loadControllerHarness(context)
    await controller.bootstrap()
    const workspaceA = appState.activeWorkspaceId()!

    const stateB = createDefaultWorkspaceState(600)
    stateB.workspace.id = 'workspace-b'
    stateB.workspace.name = 'Workspace B'
    stateB.workspace.activeRuleProfileId = 'profile-b'
    stateB.profile.id = 'profile-b'
    await context.repositories.profiles.save(stateB.profile)
    await context.repositories.workspaces.save(stateB.workspace)
    await controller.refresh()

    appState.setDocument('body A', 'a.md', 'markdown')
    await controller.switchWorkspace('workspace-b')
    expect(appState.documentText()).not.toBe('body A')

    appState.setDocument('body B', 'b.md', 'markdown')
    await controller.switchWorkspace(workspaceA)
    expect(appState.documentText()).toBe('body A')
    expect(appState.documentName()).toBe('a.md')

    await controller.switchWorkspace('workspace-b')
    expect(appState.documentText()).toBe('body B')
    expect(appState.documentName()).toBe('b.md')
    await expect(context.repositories.documents.listByWorkspace(workspaceA)).resolves.toEqual([])
    await expect(context.repositories.documents.listByWorkspace('workspace-b')).resolves.toEqual([])
  })

  it('clears stale diagnostic context before relinting after a workspace switch', async () => {
    const context = await createStorageContext({
      factory: { open() { throw new Error('memory only') } } as unknown as IDBFactory,
      now: () => 700
    })
    const { appState, controller, relint } = await loadControllerHarness(context)
    await controller.bootstrap()

    const stateB = createDefaultWorkspaceState(800)
    stateB.workspace.id = 'workspace-b'
    stateB.workspace.activeRuleProfileId = 'profile-b'
    stateB.profile.id = 'profile-b'
    await context.repositories.profiles.save(stateB.profile)
    await context.repositories.workspaces.save(stateB.workspace)
    await controller.refresh()

    appState.applyWorkerResult('fast', {
      revision: appState.revision(),
      diagnostics: [],
      ruleErrors: [],
      durationMs: 1
    })
    appState.setSelectedDiagnosticId('stale-diagnostic')

    await controller.switchWorkspace('workspace-b')

    expect(appState.selectedDiagnosticId()).toBeNull()
    expect(appState.tierResults.fast).toBeUndefined()
    expect(appState.tierResults.deep).toBeUndefined()
    expect(appState.tierResults.idle).toBeUndefined()
    expect(relint).toHaveBeenCalledTimes(2)
  })
})
