import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createDefaultConfig } from '../../src/core/config/validate'
import { runSingleRule, testConfig } from '../helpers'

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
import { allowDiagnosticSpelling } from '../../src/state/actions'
import { lintController } from '../../src/state/lint-controller'

const phrase = 'デバックを実行します。'
const getDiagnostic = (text: string) =>
  runSingleRule('wording/common-typo', text, testConfig()).find(d => text.slice(d.start, d.end) === 'デバック')!

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  expect(appState.loadConfigFrom(createDefaultConfig()).ok).toBe(true)
  appState.setDocument(phrase)
})

describe('diagnostics panel action: allow intentional spelling', () => {
  test('does not modify the document and relints using schema v1 terminology', () => {
    const oldRevision = appState.revision()
    const diagnostic = getDiagnostic(phrase)
    expect(allowDiagnosticSpelling(diagnostic)).toBe(true)
    expect(appState.documentText()).toBe(phrase)
    expect(appState.revision()).toBeGreaterThan(oldRevision)
    expect(appState.config.terminology).toContainEqual(expect.objectContaining({
      preferred: 'デバック', rejected: []
    }))
    expect(lintController.relintAll).toHaveBeenCalledTimes(1)
    expect(runSingleRule('wording/common-typo', phrase, appState.config)).toEqual([])
  })

  test('does not mutate config or relint if the diagnostic is stale', () => {
    const old = getDiagnostic(phrase)
    appState.setDocument('デバッグを実行します。')
    const before = JSON.stringify(appState.config)
    expect(allowDiagnosticSpelling(old)).toBe(false)
    expect(JSON.stringify(appState.config)).toBe(before)
    expect(lintController.relintAll).not.toHaveBeenCalled()
  })

  test('prevents an unrelated rule from registering arbitrary user text', () => {
    const old = getDiagnostic(phrase)
    const before = JSON.stringify(appState.config)
    expect(allowDiagnosticSpelling({ ...old, ruleId: 'wording/redundancy' })).toBe(false)
    expect(JSON.stringify(appState.config)).toBe(before)
  })

  test('does not duplicate previously approved user terminology', () => {
    const diag = getDiagnostic(phrase)
    expect(allowDiagnosticSpelling(diag)).toBe(true)
    const count = appState.config.terminology.length
    expect(allowDiagnosticSpelling(diag)).toBe(false)
    expect(appState.config.terminology).toHaveLength(count)
    expect(lintController.relintAll).toHaveBeenCalledTimes(1)
  })
})
