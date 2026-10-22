import type { RuleTier } from '../types'
import type { LintTierResult } from '../../worker/protocol'

const TIERS: readonly RuleTier[] = ['fast', 'deep', 'idle']

export type FormatLintCheck =
  | { ok: true; errorCount: number }
  | { ok: false; reason: 'missing-tier' | 'wrong-revision' | 'rule-error' }

/**
 * The formatter must not infer "no new errors" from an incomplete lint run.
 * Skipped, failed or timed-out tiers are intentionally absent from the
 * result map; a complete baseline and shadow run are both mandatory.
 */
export function checkCompleteFormatterLint(
  results: ReadonlyMap<RuleTier, LintTierResult>,
  expectedRevision: number | 'shadow'
): FormatLintCheck {
  let errorCount = 0
  let shadowRevision: number | null = null
  for (const tier of TIERS) {
    const result = results.get(tier)
    if (result === undefined) return { ok: false, reason: 'missing-tier' }
    if (result.type !== 'result' || result.tier !== tier) return { ok: false, reason: 'wrong-revision' }
    if (expectedRevision === 'shadow') {
      if (result.revision >= 0 || (shadowRevision !== null && shadowRevision !== result.revision)) {
        return { ok: false, reason: 'wrong-revision' }
      }
      shadowRevision = result.revision
    } else if (result.revision !== expectedRevision) {
      return { ok: false, reason: 'wrong-revision' }
    }
    if (result.ruleErrors.length > 0) return { ok: false, reason: 'rule-error' }
    errorCount += result.diagnostics.filter(d => d.severity === 'error').length
  }
  return { ok: true, errorCount }
}
