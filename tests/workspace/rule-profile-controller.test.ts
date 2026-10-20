import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, test, vi } from 'vitest'
import { createStorageContext } from '../../src/storage/bootstrap'
import { createApplicationRuntime } from '../../src/state/application-runtime'

describe('WorkspaceController rule profile switching', () => {
  test('flushes current configuration before profile changes and reloads independent profiles', async () => {
    vi.resetModules()
    const [{ appState }, { createWorkspaceController }] = await Promise.all([
      import('../../src/state/app-state'),
      import('../../src/state/workspace-controller')
    ])
    const storage = await createStorageContext({ factory: new IDBFactory(), now: () => 100 })
    const runtime = createApplicationRuntime({ getContext: async () => storage, now: () => 200 })
    const relint = vi.fn()
    const controller = createWorkspaceController({ runtime, relint, now: () => 200 })
    await controller.bootstrap()
    const workspaceId = appState.activeWorkspaceId()!
    const profilesBefore = await controller.listRuleProfiles()
    expect(profilesBefore).toHaveLength(1)

    appState.updateConfig((config) => {
      config.ngWords = [{ id: 'only-old', word: 'old', severity: 'warning' }]
    })
    const revisionBeforeDuplicate = appState.revision()
    const duplicated = await controller.duplicateRuleProfile('Variant')
    expect(appState.revision()).toBeGreaterThan(revisionBeforeDuplicate)
    expect(duplicated.profile.name).toBe('Variant')
    expect(duplicated.profile.id).not.toBe(profilesBefore[0]?.id)
    expect(appState.activeWorkspaceId()).toBe(workspaceId)
    expect(appState.config.ngWords.map(word => word.word)).toEqual(['old'])

    appState.updateConfig((config) => {
      config.ngWords = [{ id: 'only-new', word: 'new', severity: 'error' }]
    })
    const revisionBeforeSwitch = appState.revision()
    await controller.switchRuleProfile(profilesBefore[0]!.id)
    expect(appState.revision()).toBeGreaterThan(revisionBeforeSwitch)
    expect(appState.config.ngWords.map(word => word.word)).toEqual(['old'])
    await controller.switchRuleProfile(duplicated.profile.id)
    expect(appState.config.ngWords.map(word => word.word)).toEqual(['new'])
    expect(relint).toHaveBeenCalled()
  })
})
