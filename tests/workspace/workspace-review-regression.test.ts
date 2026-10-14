import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultWorkspaceState } from '../../src/core/workspace/defaults'
import { createStorageContext, type StorageContext } from '../../src/storage/bootstrap'
import { createMemoryStorageContext } from '../../src/storage/repositories/memory'
import type { StorageRepositories } from '../../src/storage/repositories/ports'
import { createWorkspaceService } from '../../src/workspace/workspace-service'

async function controllerHarness(context: StorageContext) {
  vi.resetModules()
  const [{ appState }, { createWorkspaceController }] = await Promise.all([
    import('../../src/state/app-state'),
    import('../../src/state/workspace-controller')
  ])
  const cancelPendingDocumentPersistence = vi.fn()
  const controller = createWorkspaceController({
    getContext: async () => context,
    relint: vi.fn(),
    toast: vi.fn(),
    cancelPendingDocumentPersistence,
    now: () => 1000
  })
  return { appState, controller, cancelPendingDocumentPersistence }
}

async function addWorkspaceB(context: StorageContext): Promise<void> {
  const state = createDefaultWorkspaceState(200)
  state.workspace.id = 'workspace-b'
  state.workspace.name = 'Workspace B'
  state.workspace.activeRuleProfileId = 'profile-b'
  state.profile.id = 'profile-b'
  await context.repositories.profiles.save(state.profile)
  await context.repositories.workspaces.save(state.workspace)
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'indexedDB')
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('Phase 2B final review regressions', () => {
  it('persists the current workspace profile before switching away', async () => {
    const context = await createStorageContext({
      factory: { open() { throw new Error('memory only') } } as unknown as IDBFactory,
      now: () => 100
    })
    await addWorkspaceB(context)
    const { appState, controller } = await controllerHarness(context)
    await controller.bootstrap()
    const workspaceA = appState.activeWorkspaceId()!
    const profileAId = (await context.repositories.workspaces.get(workspaceA))!.activeRuleProfileId

    appState.updateConfig((draft) => {
      draft.ngWords.push({ id: 'review-ng', word: '未保存設定', severity: 'warning' })
    })
    await controller.switchWorkspace('workspace-b')

    await expect(context.repositories.profiles.get(profileAId)).resolves.toMatchObject({
      ngWords: [expect.objectContaining({ id: 'review-ng', word: '未保存設定' })]
    })
  })

  it('clones the latest in-memory profile settings when creating a workspace', async () => {
    const context = await createStorageContext({
      factory: { open() { throw new Error('memory only') } } as unknown as IDBFactory,
      now: () => 100
    })
    const { appState, controller } = await controllerHarness(context)
    await controller.bootstrap()

    appState.updateConfig((draft) => {
      draft.ngWords.push({ id: 'clone-ng', word: '作成前設定', severity: 'error' })
    })
    await controller.createWorkspace('Cloned')

    expect(appState.config.ngWords).toContainEqual(expect.objectContaining({
      id: 'clone-ng',
      word: '作成前設定'
    }))
  })

  it('cancels queued document persistence before enabling Local Library', async () => {
    const context = await createStorageContext({ factory: new IDBFactory(), now: () => 100 })
    const { appState, controller, cancelPendingDocumentPersistence } = await controllerHarness(context)
    await controller.bootstrap()
    appState.setDocument('current body', 'current.md', 'markdown')

    await controller.setStorageMode('local-library')

    expect(cancelPendingDocumentPersistence).toHaveBeenCalledTimes(1)
  })

  it('repairs a missing target profile instead of leaving selection and UI context split', async () => {
    const memory = createMemoryStorageContext(() => 1000)
    const a = createDefaultWorkspaceState(100)
    await memory.repositories.preferences.save(a.preferences)
    await memory.atomicOperations.createWorkspaceAndActivate(a.workspace, a.profile)

    const brokenTarget = createDefaultWorkspaceState(200).workspace
    brokenTarget.id = 'workspace-broken'
    brokenTarget.name = 'Broken Target'
    brokenTarget.activeRuleProfileId = 'missing-profile'
    await memory.repositories.workspaces.save(brokenTarget)

    const repositories: StorageRepositories = memory.repositories
    const service = createWorkspaceService({
      repositories,
      atomic: memory.atomicOperations,
      sessionDocuments: undefined,
      durableBackend: false,
      now: () => 1000
    })

    const result = await service.switchTo('workspace-broken', {
      name: 'a.md',
      content: 'source body',
      docType: 'markdown',
      updatedAt: 900
    })

    expect(result.context.workspace.id).toBe('workspace-broken')
    expect(result.context.profile.id).toBe('missing-profile')
    expect(result.warning).toContain('recovered')
    await expect(repositories.selection.getActiveWorkspaceId()).resolves.toBe('workspace-broken')
    await expect(repositories.profiles.get('missing-profile')).resolves.toBeDefined()
  })
})
