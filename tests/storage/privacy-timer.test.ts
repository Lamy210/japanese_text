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
  it('clears the queued document autosave before privacy deletion starts', async () => {
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
    expect(vi.getTimerCount()).toBe(1)

    appState.updateConfig((draft) => {
      draft.privacy = { autoSave: false, privacyMode: true }
    })
    actions.onPrivacyModeChanged(true)

    expect(vi.getTimerCount()).toBe(0)
  })
})
