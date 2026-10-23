import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createDefaultConfig } from '../../src/core/config/validate'
import { runOwnRules } from '../../src/core/engine/engine'
import { isLegacyDictionaryOwnedRule } from '../../src/core/analysis/packs'
import { createDefaultWorkspaceState } from '../../src/core/workspace/defaults'
import { createMemoryStorageContext } from '../../src/storage/repositories/memory'
import { createWorkspaceService } from '../../src/workspace/workspace-service'

vi.mock('../../src/state/lint-controller', () => ({
  lintController: { relintAll: vi.fn() }
}))
vi.mock('../../src/storage/storage', () => ({
  isStorageAvailable: () => false,
  saveConfig: vi.fn(),
  getStorageContext: vi.fn(),
  saveWorkspaceDocument: vi.fn()
}))

import { appState } from '../../src/state/app-state'
import { setDictionaryPackEnabled } from '../../src/state/actions'
import { lintController } from '../../src/state/lint-controller'

const source = 'シュミレーション 記載禁止 Githubを確認。'
const dictionaryRuleIds = ['wording/common-typo', 'wording/terminology', 'wording/ng-word']

function currentConfig() {
  return JSON.parse(JSON.stringify(appState.config)) as ReturnType<typeof createDefaultConfig>
}
function findings() {
  return runOwnRules(source, currentConfig(), 'fast', 'markdown').diagnostics
}

beforeEach(() => {
  vi.clearAllMocks()
  const config = createDefaultConfig()
  config.ngWords = [{ id: 'ng-1', word: '記載禁止', severity: 'error' }]
  config.rules['wording/ng-word'] = { enabled: true, severity: 'error' }
  expect(appState.loadConfigFrom(config).ok).toBe(true)
  appState.setDocument(source)
  appState.resetDiagnosticsForDocumentContext()
})

describe('AP-03c settings: Dictionary Pack control', () => {
  test('the UI ownership map covers exactly the runtime-gated rules', () => {
    const catalog = ['wording/common-typo', 'wording/terminology', 'wording/ng-word',
      'typography/punctuation', 'wording/redundancy', 'style/meeting-minutes-sections']
    expect(catalog.filter(isLegacyDictionaryOwnedRule)).toEqual(dictionaryRuleIds)
  })

  test('turning OFF suppresses three rules, invalidates old diagnostics and preserves Rule state', () => {
    const before = findings()
    const ruleIds = before.map(d => d.ruleId)
    for (const ruleId of dictionaryRuleIds) expect(ruleIds).toContain(ruleId)
    appState.applyWorkerResult('fast', {
      revision: appState.revision(), diagnostics: before, ruleErrors: [], durationMs: 1
    })
    const revision = appState.revision()
    const originalRuleSettings = structuredClone(currentConfig().rules)
    const originalTerms = structuredClone(currentConfig().terminology)

    setDictionaryPackEnabled(false)

    expect(appState.revision()).toBeGreaterThan(revision)
    expect(appState.tierResults.fast).toBeUndefined()
    expect(appState.config.analysis.packs.dictionary).toBe(false)
    expect(currentConfig().rules).toEqual(originalRuleSettings)
    expect(currentConfig().terminology).toEqual(originalTerms)
    expect(findings().filter(d => dictionaryRuleIds.includes(d.ruleId))).toEqual([])
    expect(findings().filter(d => !dictionaryRuleIds.includes(d.ruleId)))
      .toEqual(before.filter(d => !dictionaryRuleIds.includes(d.ruleId)))
    expect(lintController.relintAll).toHaveBeenCalledTimes(1)
  })

  test('restoring ON resumes the original individual Rule selections', () => {
    appState.updateConfig(draft => {
      draft.rules['wording/common-typo'] = { enabled: false, severity: 'info' }
    })
    setDictionaryPackEnabled(false)
    const revision = appState.revision()
    setDictionaryPackEnabled(true)

    expect(appState.revision()).toBeGreaterThan(revision)
    expect(appState.config.analysis.packs.dictionary).toBe(true)
    expect(appState.config.rules['wording/common-typo']).toMatchObject({ enabled: false })
    expect(findings().map(d => d.ruleId)).not.toContain('wording/common-typo')
    expect(findings().map(d => d.ruleId)).toContain('wording/ng-word')
    expect(findings().map(d => d.ruleId)).toContain('wording/terminology')
    expect(lintController.relintAll).toHaveBeenCalledTimes(2)
  })

  test('setting the current value is a no-op and does not invalidate an in-flight revision', () => {
    const before = appState.revision()
    const config = currentConfig()
    setDictionaryPackEnabled(true)
    expect(appState.revision()).toBe(before)
    expect(currentConfig()).toEqual(config)
    expect(lintController.relintAll).not.toHaveBeenCalled()
  })

  test('saving an explicit OFF selection stays scoped to its RuleProfile', async () => {
    const memory = createMemoryStorageContext()
    const defaults = createDefaultWorkspaceState(100)
    await memory.repositories.preferences.save(defaults.preferences)
    await memory.atomicOperations.createWorkspaceAndActivate(defaults.workspace, defaults.profile)
    const service = createWorkspaceService({
      repositories: memory.repositories, atomic: memory.atomicOperations,
      now: () => 200, generateId: () => 'other-profile'
    })
    const initial = await service.getActive()

    setDictionaryPackEnabled(false)
    await service.saveConfig(defaults.workspace.id, currentConfig())
    const saved = await service.getActive()
    expect(saved.config.analysis.packs.dictionary).toBe(false)
    const duplicated = await service.duplicateRuleProfile(defaults.workspace.id, 'Independent')
    const second = { ...duplicated.config, analysis: {
      ...duplicated.config.analysis,
      packs: { ...duplicated.config.analysis.packs, dictionary: true }
    } }
    await service.saveConfig(defaults.workspace.id, second)
    expect((await service.switchRuleProfile(defaults.workspace.id, initial.profile.id))
      .config.analysis.packs.dictionary).toBe(false)
    expect((await service.switchRuleProfile(defaults.workspace.id, duplicated.profile.id))
      .config.analysis.packs.dictionary).toBe(true)
    expect((await memory.repositories.documents.listByWorkspace(defaults.workspace.id))).toEqual([])
  })
})
