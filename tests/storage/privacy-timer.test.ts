import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.resetModules()
})

describe('legacy privacy settings compatibility', () => {
  it('redirects direct privacy changes to Workspace Manage without mutating the canonical privacy view', async () => {
    vi.resetModules()
    const { appState } = await import('../../src/state/app-state')
    const actions = await import('../../src/state/actions')

    expect(appState.workspaceManagerOpen()).toBe(false)
    const before = structuredClone(appState.config.privacy)

    appState.updateConfig((draft) => {
      draft.privacy = { autoSave: true, privacyMode: false }
    })
    actions.onPrivacyModeChanged(false)

    expect(appState.config.privacy).toEqual(before)
    expect(appState.workspaceManagerOpen()).toBe(true)
  })
})
