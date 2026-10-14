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
  vi.useRealTimers()
  Reflect.deleteProperty(globalThis, 'indexedDB')
  vi.resetModules()
})

describe('privacy autosave cancellation', () => {
  it('cancels a queued document autosave before deleting persisted body', async () => {
    installIndexedDb(new IDBFactory())
    vi.resetModules()

    const storage = await import('../../src/storage/storage')
    const { appState } = await import('../../src/state/app-state')
    const actions = await import('../../src/state/actions')

    const config = (await storage.loadConfig())!
    config.privacy = { autoSave: true, privacyMode: false }
    await storage.saveConfig(config)
    expect(appState.loadConfigFrom(config).ok).toBe(true)
    appState.setDocument('secret body', 'secret.md', 'markdown')

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    actions.persistDocumentDebounced()

    appState.updateConfig((draft) => {
      draft.privacy = { autoSave: false, privacyMode: true }
    })
    actions.onPrivacyModeChanged(true)

    // Ensure the privacy deletion has completed before the queued autosave is allowed to run.
    await storage.deleteRecentDocument()
    await vi.advanceTimersByTimeAsync(1000)

    await expect(storage.loadRecentDocument()).resolves.toBeUndefined()
  })
})
