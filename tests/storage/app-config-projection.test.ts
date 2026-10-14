import { describe, expect, it } from 'vitest'
import { createDefaultConfig } from '../../src/core/config/validate'
import { createDefaultWorkspaceState } from '../../src/core/workspace/defaults'
import {
  composeAppConfig,
  splitAppConfig,
  type ProjectedStorageState
} from '../../src/storage/compat/app-config-projection'

describe('AppConfig compatibility projection', () => {
  it('composes private-session state into the existing privacy flags', () => {
    const state = createDefaultWorkspaceState(1000)
    const config = composeAppConfig(state)

    expect(config.privacy).toEqual({ autoSave: false, privacyMode: true })
    expect(config.preset).toBe('general')
    expect(config.theme).toBe(state.preferences.theme)
  })

  it('composes local-library state into autosave-enabled compatibility flags', () => {
    const state: ProjectedStorageState = createDefaultWorkspaceState(1000)
    state.workspace.storageMode = 'local-library'
    state.preferences.defaultStorageMode = 'local-library'

    expect(composeAppConfig(state).privacy).toEqual({ autoSave: true, privacyMode: false })
  })

  it('treats reserved file-backed mode as non-persistent in the legacy facade', () => {
    const state: ProjectedStorageState = createDefaultWorkspaceState(1000)
    state.workspace.storageMode = 'file-backed'

    expect(composeAppConfig(state).privacy).toEqual({ autoSave: false, privacyMode: true })
  })

  it('splits AppConfig while preserving stable IDs and createdAt', () => {
    const current = createDefaultWorkspaceState(1000)
    const config = createDefaultConfig()
    config.preset = 'technical'
    config.theme = 'dark'
    config.editor.fontSize = 18
    config.privacy = { autoSave: true, privacyMode: false }
    config.ngWords = [{ id: 'ng-1', word: '禁止', severity: 'error' }]

    const next = splitAppConfig(config, current, 2000)

    expect(next.workspace.id).toBe(current.workspace.id)
    expect(next.workspace.createdAt).toBe(1000)
    expect(next.workspace.updatedAt).toBe(2000)
    expect(next.workspace.storageMode).toBe('local-library')
    expect(next.profile.id).toBe(current.profile.id)
    expect(next.profile.createdAt).toBe(1000)
    expect(next.profile.updatedAt).toBe(2000)
    expect(next.profile.sourcePresetId).toBe('technical')
    expect(next.profile.ngWords).toEqual(config.ngWords)
    expect(next.preferences.theme).toBe('dark')
    expect(next.preferences.editor.fontSize).toBe(18)
  })

  it('round-trips all compatibility config fields without sharing references', () => {
    const current = createDefaultWorkspaceState(1000)
    const config = createDefaultConfig()
    config.preset = 'custom'
    config.rules['style/sentence-length'] = { enabled: true, severity: 'error', options: { max: 72 } }
    config.ngWords = [{ id: 'ng-1', word: 'foo', severity: 'warning', replacement: 'bar' }]
    config.terminology = [{ id: 'term-1', preferred: 'GitHub', rejected: ['Github'], caseSensitive: true }]
    config.citation.detectComparison = false
    config.formatter.enabled = false
    config.editor.showLineNumbers = false
    config.theme = 'light'
    config.privacy = { autoSave: false, privacyMode: true }

    const split = splitAppConfig(config, current, 3000)
    const composed = composeAppConfig(split)

    expect(composed).toEqual(config)
    split.profile.ngWords[0]!.word = 'mutated'
    expect(config.ngWords[0]!.word).toBe('foo')
  })
})
