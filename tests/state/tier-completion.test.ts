import { describe, expect, test } from 'vitest'
import { TierCompletionTracker } from '../../src/state/tier-completion'
import type { LintTierResult } from '../../src/worker/protocol'

const result = (tier: 'fast' | 'deep' | 'idle', revision = 1): LintTierResult => ({
  type: 'result', revision, tier, diagnostics: [], ruleErrors: [], durationMs: 1
})

describe('all-tier completion tracking', () => {
  test('resolves immediately when a superseded manual lint has all tiers skipped', () => {
    const tracker = new TierCompletionTracker(['fast', 'deep', 'idle'])
    expect(tracker.record({ type: 'skipped', revision: 1, tier: 'fast', reason: 'superseded' })).toBe(false)
    expect(tracker.record({ type: 'skipped', revision: 1, tier: 'deep', reason: 'superseded' })).toBe(false)
    expect(tracker.record({ type: 'skipped', revision: 1, tier: 'idle', reason: 'superseded' })).toBe(true)
    expect(tracker.results.size).toBe(0)
  })

  test('preserves finished tiers and completes after skipped/deep failure', () => {
    const tracker = new TierCompletionTracker(['fast', 'deep', 'idle'])
    expect(tracker.record(result('fast'))).toBe(false)
    expect(tracker.record({ type: 'error', tier: 'deep', revision: 1, message: 'textlint failed' })).toBe(false)
    expect(tracker.record({ type: 'skipped', tier: 'idle', revision: 1, reason: 'superseded' })).toBe(true)
    expect([...tracker.results.keys()]).toEqual(['fast'])
  })

  test('duplicates and unrequested tiers do not finish the waiter early', () => {
    const tracker = new TierCompletionTracker(['fast', 'deep'])
    expect(tracker.record(result('fast'))).toBe(false)
    expect(tracker.record(result('fast'))).toBe(false)
    expect(tracker.record(result('idle'))).toBe(false)
    expect(tracker.results.has('idle')).toBe(false)
    expect(tracker.record(result('deep'))).toBe(true)
    expect(tracker.record(result('deep'))).toBe(true)
    expect(tracker.results.size).toBe(2)
  })

  test('single tier can be completed by an error, including formatter shadow revisions', () => {
    const tracker = new TierCompletionTracker(['deep'])
    expect(tracker.record({ type: 'error', tier: 'deep', revision: -30, message: 'broken' })).toBe(true)
    expect(tracker.results.size).toBe(0)
  })
})
