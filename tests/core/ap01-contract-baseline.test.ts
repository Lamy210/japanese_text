import { describe, expect, test } from 'vitest'
import { runSingleRule, testConfig } from '../helpers'
import { createDefaultWorkspaceState } from '../../src/core/workspace/defaults'
import {
  composeAppConfig,
  splitAppConfigForMigration,
  splitAppConfigPreservingStorageMode
} from '../../src/storage/compat/app-config-projection'

describe('AP-01: representative diagnostic contract', () => {
  test('curated typo remains an opt-in suggestion with an exact UTF-16 span', () => {
    const text = '🎯本文でコミニュケーションを確認します。'
    const diagnostics = runSingleRule('wording/common-typo', text, testConfig())
    const start = text.indexOf('コミニュケーション')
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({
      id: 'wording/common-typo@' + start + '-' + (start + 'コミニュケーション'.length),
      ruleId: 'wording/common-typo',
      source: 'core',
      start,
      end: start + 'コミニュケーション'.length,
      fixKind: 'suggestion',
      replacement: 'コミュニケーション'
    })
    expect(diagnostics[0]!.start).toBeGreaterThan(2) // supplementary-plane emoji is 2 UTF-16 units
  })

  test('meeting minutes follow-up remains informational; no replacement is offered', () => {
    const text = '# 議事録\n参加者：A\n決定事項：承認\n未決事項：方針検討'
    const diagnostics = runSingleRule('style/meeting-minutes-sections', text, testConfig())
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({
      id: 'style/meeting-minutes-sections@2-5',
      ruleId: 'style/meeting-minutes-sections',
      source: 'core',
      start: 2,
      end: 5,
      fixKind: 'none'
    })
    expect(diagnostics[0]!.replacement).toBeUndefined()
    expect(diagnostics[0]!.message).toContain('フォローアップ')
  })
})

describe('AP-01: privacy mode projection contract', () => {
  test('normal config changes cannot silently persist a private workspace', () => {
    const state = createDefaultWorkspaceState(100)
    const config = composeAppConfig(state)
    expect(config.privacy).toEqual({ autoSave: false, privacyMode: true })
    config.privacy = { autoSave: true, privacyMode: false }
    const next = splitAppConfigPreservingStorageMode(config, state, 200)
    expect(next.workspace.storageMode).toBe('private-session')
    expect(composeAppConfig(next).privacy).toEqual({ autoSave: false, privacyMode: true })
  })

  test('normal config changes cannot silently turn off an explicit local-library mode', () => {
    const state = createDefaultWorkspaceState(100)
    state.workspace.storageMode = 'local-library'
    const config = composeAppConfig(state)
    config.privacy = { autoSave: false, privacyMode: true }
    const next = splitAppConfigPreservingStorageMode(config, state, 200)
    expect(next.workspace.storageMode).toBe('local-library')
    expect(composeAppConfig(next).privacy).toEqual({ autoSave: true, privacyMode: false })
  })

  test('only the legacy migration projection interprets old privacy flags as storage intent', () => {
    const state = createDefaultWorkspaceState(100)
    const config = composeAppConfig(state)
    config.privacy = { autoSave: true, privacyMode: false }
    const migrated = splitAppConfigForMigration(config, state, 200)
    expect(migrated.workspace.storageMode).toBe('local-library')
    expect(migrated.preferences.defaultStorageMode).toBe('local-library')
  })
})
