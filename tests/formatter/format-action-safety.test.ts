import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createDefaultConfig } from '../../src/core/config/validate'
import type { Diagnostic, RuleTier } from '../../src/core/types'
import type { LintTierResult } from '../../src/worker/protocol'

vi.mock('../../src/state/lint-controller', () => ({
  lintController: {
    relintAll: vi.fn(),
    lintAllNow: vi.fn(),
    lintShadowText: vi.fn()
  }
}))
vi.mock('../../src/editor/editor-adapter', () => ({
  applyFixesTransaction: vi.fn(),
  applyReplacement: vi.fn(),
  jumpToPosition: vi.fn()
}))
vi.mock('../../src/storage/storage', () => ({
  isStorageAvailable: () => false,
  saveConfig: vi.fn(),
  getStorageContext: vi.fn(),
  saveWorkspaceDocument: vi.fn()
}))

import { appState } from '../../src/state/app-state'
import { lintController } from '../../src/state/lint-controller'
import { applyFixesTransaction } from '../../src/editor/editor-adapter'
import { formatDocumentAction } from '../../src/state/actions'

const source = '手順を行なう。'
const fix: Diagnostic = {
  id: 'wording/redundancy@3-6', ruleId: 'wording/redundancy',
  source: 'core', severity: 'info', message: '表記',
  start: source.indexOf('行なう'), end: source.indexOf('行なう') + 3,
  line: 1, column: source.indexOf('行なう') + 1,
  fixKind: 'safe', replacement: '行う'
}
const allTiers = ['fast', 'deep', 'idle'] as const
const result = (tier: RuleTier, revision: number, diagnostics: Diagnostic[] = [], failure = false): LintTierResult => ({
  type: 'result', tier, revision, diagnostics, durationMs: 1,
  ruleErrors: failure ? [{ ruleId: 'textlint', message: 'unavailable' }] : []
})
const baseline = (revision: number) => new Map<RuleTier, LintTierResult>(allTiers.map((t): [RuleTier, LintTierResult] =>
  [t, result(t, revision, t === 'fast' ? [fix] : [])]
))
const shadow = () => new Map<RuleTier, LintTierResult>(allTiers.map((t): [RuleTier, LintTierResult] =>
  [t, result(t, -42)]
))
const configure = (b: Map<RuleTier, LintTierResult>, s: Map<RuleTier, LintTierResult>) => {
  vi.mocked(lintController.lintAllNow).mockResolvedValue(b)
  vi.mocked(lintController.lintShadowText).mockResolvedValue(s)
}

beforeEach(() => {
  vi.clearAllMocks()
  expect(appState.loadConfigFrom(createDefaultConfig()).ok).toBe(true)
  appState.setDocument(source)
  appState.applyWorkerResult('fast', {
    revision: appState.revision(), diagnostics: [fix], durationMs: 1, ruleErrors: []
  })
})

describe('format document action fails closed on incomplete safety checks', () => {
  test('aborts when the initial analysis is missing a tier', async () => {
    const b = baseline(appState.revision())
    b.delete('idle')
    configure(b, shadow())
    await formatDocumentAction()
    expect(lintController.lintShadowText).not.toHaveBeenCalled()
    expect(applyFixesTransaction).not.toHaveBeenCalled()
  })

  test('aborts if an initial tier reported a rule execution failure', async () => {
    const b = baseline(appState.revision())
    b.set('deep', result('deep', appState.revision(), [], true))
    configure(b, shadow())
    await formatDocumentAction()
    expect(lintController.lintShadowText).not.toHaveBeenCalled()
    expect(applyFixesTransaction).not.toHaveBeenCalled()
  })

  test('aborts when the shadow run is partial or timed out', async () => {
    const s = shadow()
    s.delete('deep')
    configure(baseline(appState.revision()), s)
    await formatDocumentAction()
    expect(applyFixesTransaction).not.toHaveBeenCalled()
  })

  test('aborts on a rejected shadow lint Promise', async () => {
    configure(baseline(appState.revision()), shadow())
    vi.mocked(lintController.lintShadowText).mockRejectedValue(new Error('Worker offline'))
    await formatDocumentAction()
    expect(applyFixesTransaction).not.toHaveBeenCalled()
  })

  test('aborts if the shadow analysis reports new errors', async () => {
    const error = { ...fix, id: 'new-error', severity: 'error' as const, fixKind: 'none' as const }
    const s = shadow()
    s.set('deep', result('deep', -42, [error]))
    configure(baseline(appState.revision()), s)
    await formatDocumentAction()
    expect(applyFixesTransaction).not.toHaveBeenCalled()
  })

  test('allows safe fix only after complete current and shadow lint validation', async () => {
    configure(baseline(appState.revision()), shadow())
    await formatDocumentAction()
    expect(applyFixesTransaction).toHaveBeenCalledTimes(1)
    expect(applyFixesTransaction).toHaveBeenCalledWith([
      { start: fix.start, end: fix.end, replacement: '行う' }
    ], 'input.format')
  })
})
