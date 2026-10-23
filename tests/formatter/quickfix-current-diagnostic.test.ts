import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createDefaultConfig } from '../../src/core/config/validate'
import type { Diagnostic } from '../../src/core/types'

vi.mock('../../src/state/lint-controller', () => ({
  lintController: { relintAll: vi.fn(), lintAllNow: vi.fn(), lintShadowText: vi.fn() }
}))
vi.mock('../../src/editor/editor-adapter', () => ({
  applyReplacement: vi.fn(), applyFixesTransaction: vi.fn(), jumpToPosition: vi.fn()
}))
vi.mock('../../src/storage/storage', () => ({
  isStorageAvailable: () => false,
  saveConfig: vi.fn(), getStorageContext: vi.fn(), saveWorkspaceDocument: vi.fn()
}))

import { appState } from '../../src/state/app-state'
import { quickFix } from '../../src/state/actions'
import { applyReplacement } from '../../src/editor/editor-adapter'

const text = 'デバックを確認します。'
const offset = text.indexOf('デバック')
const diagnostic: Diagnostic = {
  id: `wording/common-typo@${offset}-${offset + 4}`,
  ruleId: 'wording/common-typo',
  source: 'core',
  severity: 'warning',
  message: '表記の修正候補',
  start: offset,
  end: offset + 4,
  line: 1,
  column: offset + 1,
  fixKind: 'suggestion',
  replacement: 'デバッグ'
}

beforeEach(() => {
  vi.clearAllMocks()
  expect(appState.loadConfigFrom(createDefaultConfig()).ok).toBe(true)
  appState.setDocument(text)
  appState.applyWorkerResult('fast', {
    revision: appState.revision(),
    diagnostics: [diagnostic],
    ruleErrors: [],
    durationMs: 1
  })
})

describe('Quick Fix only applies current, verified diagnostic replacements', () => {
  test('preserves the original one-transaction Quick Fix for current suggestions', () => {
    quickFix(diagnostic)
    expect(applyReplacement).toHaveBeenCalledTimes(1)
    expect(applyReplacement).toHaveBeenCalledWith(
      offset, offset + 4, 'デバッグ', 'input.quickfix'
    )
  })

  test('rejects previous Pack/Profile results after generation invalidation with unchanged text', () => {
    appState.invalidateAnalysisForConfigChange()
    expect(appState.documentText()).toBe(text)
    quickFix(diagnostic)
    expect(applyReplacement).not.toHaveBeenCalled()
  })

  test('rejects diagnostic from an earlier edit despite a still-valid old offset', () => {
    appState.onDocumentEdited('デバッグを確認します。')
    quickFix(diagnostic)
    expect(applyReplacement).not.toHaveBeenCalled()
  })

  test('does not trust an altered replacement when the ID and offsets match', () => {
    quickFix({ ...diagnostic, replacement: '任意の書き換え' })
    quickFix({ ...diagnostic, fixKind: 'none' })
    expect(applyReplacement).not.toHaveBeenCalled()
  })

  test('rejects an obsolete diagnostic whose rule or offsets no longer match', () => {
    quickFix({ ...diagnostic, ruleId: 'wording/terminology' })
    quickFix({ ...diagnostic, start: 1 })
    expect(applyReplacement).not.toHaveBeenCalled()
  })
})
