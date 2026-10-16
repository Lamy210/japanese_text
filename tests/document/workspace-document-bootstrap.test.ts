import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStorageContext } from '../../src/storage/bootstrap'

async function harness() {
  vi.resetModules()
  const [{ appState }, { createWorkspaceController }] = await Promise.all([
    import('../../src/state/app-state'),
    import('../../src/state/workspace-controller')
  ])
  const context = await createStorageContext({ factory: new IDBFactory(), now: () => 1000 })
  const controller = createWorkspaceController({
    getContext: async () => context,
    relint: vi.fn(),
    toast: vi.fn(),
    cancelPendingDocumentPersistence: vi.fn(),
    now: () => 1000
  })
  return { appState, context, controller }
}

afterEach(() => {
  vi.resetModules()
  Reflect.deleteProperty(globalThis, 'indexedDB')
})

describe('workspace/document bootstrap integration', () => {
  it('boots the active workspace through DocumentController and exposes explicit active document state', async () => {
    const { appState, context, controller } = await harness()

    await controller.bootstrap()

    expect(appState.workspaceReady()).toBe(true)
    expect(appState.documentLibraryReady()).toBe(true)
    expect(appState.activeDocumentId()).toBeDefined()
    expect(appState.documentSummaries()).toHaveLength(1)
    expect(appState.documentSummaries()[0]).toMatchObject({
      id: appState.activeDocumentId(),
      workspaceId: appState.activeWorkspaceId(),
      active: true,
      name: 'welcome.md'
    })
    expect(appState.documentText()).toContain('Japanese Writing Toolkit')
    await expect(context.repositories.documents.listByWorkspace(appState.activeWorkspaceId()!)).resolves.toEqual([])
  })
})
