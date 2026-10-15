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

describe('Open document action', () => {
  it('imports a supported file as a new active Private document and preserves the previous document', async () => {
    installIndexedDb(new IDBFactory())
    vi.resetModules()
    const [{ appState }, actions, runtimeModule, storage] = await Promise.all([
      import('../../src/state/app-state'),
      import('../../src/state/actions'),
      import('../../src/state/workspace-runtime'),
      import('../../src/storage/storage')
    ])
    await runtimeModule.workspaceController.bootstrap()
    const workspaceId = appState.activeWorkspaceId()!
    const previousId = appState.activeDocumentId()!
    appState.setDocument('edited previous body', 'welcome.md', 'markdown')

    await actions.openDocumentFile(new File(['# Imported\r\nline 2\rline 3'], 'imported.md', { type: 'text/markdown' }))

    const importedId = appState.activeDocumentId()!
    expect(importedId).not.toBe(previousId)
    expect(appState.documentName()).toBe('imported.md')
    expect(appState.documentText()).toBe('# Imported\nline 2\nline 3')
    expect(appState.documentSummaries()).toHaveLength(2)
    expect(appState.documentSummaries()).toContainEqual(expect.objectContaining({ id: previousId, active: false }))
    expect(appState.documentSummaries()).toContainEqual(expect.objectContaining({ id: importedId, active: true }))

    await runtimeModule.documentController.switchDocument(previousId)
    expect(appState.documentText()).toBe('edited previous body')

    const context = await storage.getStorageContext()
    await expect(context.repositories.documents.listByWorkspace(workspaceId)).resolves.toEqual([])
    await expect(context.repositories.documentSelection.getActiveDocumentId(workspaceId)).resolves.toBeUndefined()
  })

  it('imports .txt as text and keeps unsupported files out of the library', async () => {
    installIndexedDb(new IDBFactory())
    vi.resetModules()
    const [{ appState }, actions, runtimeModule] = await Promise.all([
      import('../../src/state/app-state'),
      import('../../src/state/actions'),
      import('../../src/state/workspace-runtime')
    ])
    await runtimeModule.workspaceController.bootstrap()

    const beforeUnsupported = appState.documentSummaries().length
    await actions.openDocumentFile(new File(['binary-ish'], 'archive.zip', { type: 'application/zip' }))
    expect(appState.documentSummaries()).toHaveLength(beforeUnsupported)

    await actions.openDocumentFile(new File(['plain\r\ntext'], 'notes.txt', { type: 'text/plain' }))
    expect(appState.documentName()).toBe('notes.txt')
    expect(appState.docType()).toBe('text')
    expect(appState.documentText()).toBe('plain\ntext')
  })
})
