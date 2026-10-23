import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Diagnostic } from '../../src/core/types'
import { createDefaultConfig } from '../../src/core/config/validate'

vi.mock('../../src/editor/editor-adapter', () => ({
  applyReplacement: vi.fn(),
  applyFixesTransaction: vi.fn(),
  jumpToPosition: vi.fn()
}))
vi.mock('../../src/storage/storage', () => ({
  isStorageAvailable: () => false,
  saveConfig: vi.fn(),
  getStorageContext: vi.fn(),
  saveWorkspaceDocument: vi.fn()
}))

import { applyReplacement } from '../../src/editor/editor-adapter'
import { appState } from '../../src/state/app-state'
import { quickFix } from '../../src/state/actions'

const source = 'コミニュケーションを確認します。'
const typo = 'コミニュケーション'
const original: Diagnostic = {
  id: 'wording/common-typo@0-' + typo.length,
  ruleId: 'wording/common-typo',
  source: 'core', severity: 'warning',
  message: '誤字の修正候補',
  start: 0, end: typo.length,
  line: 1, column: 1,
  fixKind: 'suggestion',
  replacement: 'コミュニケーション'
}

function showDiagnostic(diagnostic: Diagnostic = original): void {
  appState.applyWorkerResult('fast', {
    revision: appState.revision(),
    diagnostics: [diagnostic],
    ruleErrors: [],
    durationMs: 1
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  expect(appState.loadConfigFrom(createDefaultConfig()).ok).toBe(true)
  appState.setDocument(source)
  appState.resetDiagnosticsForDocumentContext()
})

describe('Quick Fix rejects stale diagnostic locations', () => {
  test('applies a current, valid suggestion exactly once', () => {
    showDiagnostic()
    quickFix(original)
    expect(applyReplacement).toHaveBeenCalledExactlyOnceWith(
      original.start, original.end, original.replacement, 'input.quickfix'
    )
  })

  test('does not replace text at stale UTF-16 offsets after a document edit', () => {
    showDiagnostic()
    expect(appState.diagnostics()).toHaveLength(1)
    appState.onDocumentEdited('🎯変更：' + source)
    expect(appState.diagnostics()).toEqual([])
    quickFix(original)
    expect(applyReplacement).not.toHaveBeenCalled()
  })

  test('does not apply a stale suggestion after Pack/Profile settings invalidate analysis', () => {
    showDiagnostic()
    appState.invalidateAnalysisForConfigChange()
    quickFix(original)
    expect(appState.diagnostics()).toEqual([])
    expect(applyReplacement).not.toHaveBeenCalled()
  })

  test('a forged replacement or different rule ID cannot bypass the current result', () => {
    showDiagnostic()
    quickFix({ ...original, replacement: '別の修正' })
    quickFix({ ...original, ruleId: 'wording/terminology' })
    expect(applyReplacement).not.toHaveBeenCalled()
  })

  test('diagnostics with fixKind none cannot cause a replacement', () => {
    const nonFix = { ...original, fixKind: 'none' as const }
    showDiagnostic(nonFix)
    quickFix(nonFix)
    expect(applyReplacement).not.toHaveBeenCalled()
  })
})
