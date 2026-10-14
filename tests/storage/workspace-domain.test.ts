import { describe, expect, it } from 'vitest'
import { createDefaultConfig } from '../../src/core/config/validate'
import { createDefaultWorkspaceState } from '../../src/core/workspace/defaults'
import {
  validateDocumentRecord,
  validatePreferencesRecord,
  validateRuleProfileRecord,
  validateWorkspaceRecord
} from '../../src/core/workspace/validate'

describe('workspace storage domain', () => {
  it('defaults new users to a private session', () => {
    const state = createDefaultWorkspaceState(1000)

    expect(state.workspace.storageMode).toBe('private-session')
    expect(state.preferences.defaultStorageMode).toBe('private-session')
    expect(state.profile.sourcePresetId).toBe('general')
    expect(state.profile.customRules).toEqual([])
    expect(state.workspace.snapshotPolicy).toEqual({ enabled: false, maxSnapshots: 20 })
  })

  it('keeps the compatibility AppConfig private by default for fresh users', () => {
    const config = createDefaultConfig()

    expect(config.privacy).toEqual({ autoSave: false, privacyMode: true })
  })

  it('accepts valid default records without mutating them', () => {
    const state = createDefaultWorkspaceState(1000)
    const document = {
      id: 'doc-1',
      workspaceId: state.workspace.id,
      name: 'README.md',
      docType: 'markdown' as const,
      content: '# Hello',
      sourceKind: 'local' as const,
      createdAt: 1000,
      updatedAt: 1000
    }

    expect(validateWorkspaceRecord(state.workspace)).toEqual(state.workspace)
    expect(validatePreferencesRecord(state.preferences)).toEqual(state.preferences)
    expect(validateRuleProfileRecord(state.profile)).toEqual(state.profile)
    expect(validateDocumentRecord(document)).toEqual(document)
  })

  it('rejects malformed persisted workspace records', () => {
    expect(() => validateWorkspaceRecord([])).toThrow()
    expect(() => validateWorkspaceRecord({ id: '', name: 'x' })).toThrow()
    expect(() =>
      validateWorkspaceRecord({
        id: 'w',
        name: 'Workspace',
        activeRuleProfileId: 'p',
        storageMode: 'cloud',
        snapshotPolicy: { enabled: false, maxSnapshots: 20 },
        createdAt: 1,
        updatedAt: 1
      })
    ).toThrow()
  })

  it('rejects malformed preferences, profiles, and documents', () => {
    expect(() => validatePreferencesRecord([])).toThrow()
    expect(() => validateRuleProfileRecord({ id: 'p', customRules: [{ type: 'literal' }] })).toThrow()
    expect(() => validateDocumentRecord({ id: '', workspaceId: 'w' })).toThrow()
  })
})
