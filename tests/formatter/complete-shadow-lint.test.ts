import { describe, expect, test } from 'vitest'
import { checkCompleteFormatterLint } from '../../src/core/formatter/lint-safety'
import type { LintTierResult } from '../../src/worker/protocol'
import type { Diagnostic, RuleTier } from '../../src/core/types'

const make = (
  tier: RuleTier, revision: number, errors = 0, ruleErrors = 0
): LintTierResult => ({
  type: 'result', tier, revision, durationMs: 1,
  diagnostics: Array.from({ length: errors }, (_, i): Diagnostic => ({
    id: `error-${tier}-${i}`, ruleId: 'demo/issue', severity: 'error',
    message: 'issue', start: i, end: i + 1, line: 1, column: i + 1,
    fixKind: 'none', source: 'core'
  })),
  ruleErrors: Array.from({ length: ruleErrors }, () => ({
    ruleId: 'demo/failed', message: 'failed to analyze'
  }))
})
const full = (revision: number) => new Map<RuleTier, LintTierResult>([
  ['fast', make('fast', revision, 1)],
  ['deep', make('deep', revision, 2)],
  ['idle', make('idle', revision)]
])

describe('Formatter requires complete independent lint validation', () => {
  test('accepts all three successful matching baseline/shadow tiers and counts raw errors', () => {
    expect(checkCompleteFormatterLint(full(12), 12)).toEqual({ ok: true, errorCount: 3 })
    expect(checkCompleteFormatterLint(full(-8), 'shadow')).toEqual({ ok: true, errorCount: 3 })
  })

  test('rejects each skipped, failed or timed-out tier (missing result)', () => {
    for (const tier of ['fast', 'deep', 'idle'] as const) {
      const baseline = full(12)
      baseline.delete(tier)
      expect(checkCompleteFormatterLint(baseline, 12)).toEqual({
        ok: false, reason: 'missing-tier'
      })
      const shadow = full(-9)
      shadow.delete(tier)
      expect(checkCompleteFormatterLint(shadow, 'shadow').ok).toBe(false)
    }
  })

  test('rejects stale revision results, mismatched tier and mixed shadow executions', () => {
    const baseline = full(12)
    baseline.set('deep', make('deep', 11))
    expect(checkCompleteFormatterLint(baseline, 12)).toEqual({
      ok: false, reason: 'wrong-revision'
    })
    const wrongTier = full(12)
    wrongTier.set('deep', make('idle', 12))
    expect(checkCompleteFormatterLint(wrongTier, 12).ok).toBe(false)
    const mixed = full(-9)
    mixed.set('idle', make('idle', -10))
    expect(checkCompleteFormatterLint(mixed, 'shadow').ok).toBe(false)
    expect(checkCompleteFormatterLint(full(13), 'shadow').ok).toBe(false)
  })

  test('does not treat rules that threw an error as successful safety validation', () => {
    const baseline = full(7)
    baseline.set('fast', make('fast', 7, 0, 1))
    expect(checkCompleteFormatterLint(baseline, 7)).toEqual({
      ok: false, reason: 'rule-error'
    })
    const shadow = full(-14)
    shadow.set('deep', make('deep', -14, 0, 1))
    expect(checkCompleteFormatterLint(shadow, 'shadow').ok).toBe(false)
  })
})
