import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'

function installIndexedDb(factory: IDBFactory): void {
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    writable: true,
    value: factory
  })
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'indexedDB')
  vi.resetModules()
})

describe('Private Session durable-storage isolation', () => {
  it('keeps bootstrap, Open, config import, and legacy recent-save bodies out of durable document storage', async () => {
    installIndexedDb(new IDBFactory())
    vi.resetModules()
    const storage = await import('../../src/storage/storage')
    const { appState } = await import('../../src/state/app-state')
    const actions = await import('../../src/state/actions')
    const { workspaceController } = await import('../../src/state/workspace-runtime')
    const context = await storage.getStorageContext()

    await workspaceController.bootstrap()
    const workspaceId = appState.activeWorkspaceId()!
    expect((await context.repositories.workspaces.get(workspaceId))?.storageMode).toBe('private-session')
    await expect(context.repositories.documents.listByWorkspace(workspaceId)).resolves.toEqual([])
    await expect(context.repositories.documentSelection.getActiveDocumentId(workspaceId)).resolves.toBeUndefined()

    await actions.openDocumentFile(new File(['private open body'], 'private-open.md', { type: 'text/markdown' }))
    expect(appState.documentText()).toBe('private open body')
    await expect(context.repositories.documents.listByWorkspace(workspaceId)).resolves.toEqual([])
    await expect(context.repositories.documentSelection.getActiveDocumentId(workspaceId)).resolves.toBeUndefined()

    const importedConfig = structuredClone(appState.config)
    importedConfig.privacy = { autoSave: true, privacyMode: false }
    await actions.importConfigFile(new File([JSON.stringify(importedConfig)], 'config.json', { type: 'application/json' }))
    expect((await context.repositories.workspaces.get(workspaceId))?.storageMode).toBe('private-session')
    expect(appState.config.privacy).toEqual({ autoSave: false, privacyMode: true })

    await storage.saveRecentDocument({
      name: 'legacy-private.md',
      content: 'legacy private body',
      docType: 'markdown',
      updatedAt: 9999
    })

    await expect(context.repositories.documents.listByWorkspace(workspaceId)).resolves.toEqual([])
    await expect(context.repositories.documentSelection.getActiveDocumentId(workspaceId)).resolves.toBeUndefined()
  })
})