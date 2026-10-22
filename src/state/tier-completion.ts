import type { RuleTier } from '../core/types'
import type { LintTierResult, LintTierSkipped, LintErrorMessage } from '../worker/protocol'

export type TierCompletionMessage = LintTierResult | LintTierSkipped | LintErrorMessage

/**
 * Every requested tier needs exactly one terminal event, not necessarily a
 * diagnostics result. Skips and per-tier errors also complete a pending wait.
 */
export class TierCompletionTracker {
  private readonly remaining: Set<RuleTier>
  readonly results = new Map<RuleTier, LintTierResult>()

  constructor(tiers: readonly RuleTier[]) {
    this.remaining = new Set(tiers)
  }

  record(message: TierCompletionMessage): boolean {
    if (!this.remaining.delete(message.tier)) return this.complete
    if (message.type === 'result') this.results.set(message.tier, message)
    return this.complete
  }

  get complete(): boolean {
    return this.remaining.size === 0
  }
}
