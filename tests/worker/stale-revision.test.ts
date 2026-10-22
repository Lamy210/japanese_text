import { describe, expect, test } from 'vitest'
import type { LintTierResult, WorkerResponse } from '../../src/worker/protocol'
import { RevisionGate, isTierCompletion } from '../../src/worker/revision-gate'

describe('Worker RevisionGate', () => {
  test('only newer UI revisions obsolete older positive revision work', () => {
    const gate = new RevisionGate()
    gate.receive(10)
    expect(gate.isObsolete(10)).toBe(false)
    expect(gate.isObsolete(9)).toBe(true)
    gate.receive(10)
    expect(gate.isObsolete(10)).toBe(false)
    gate.receive(8)
    expect(gate.isObsolete(8)).toBe(true)
    gate.receive(11)
    expect(gate.isObsolete(10)).toBe(true)
    expect(gate.isObsolete(11)).toBe(false)
  })

  test('negative shadow revisions never supersede current UI or get skipped', () => {
    const gate = new RevisionGate()
    gate.receive(10)
    gate.receive(-1)
    gate.receive(-90)
    expect(gate.isObsolete(-1)).toBe(false)
    expect(gate.isObsolete(-90)).toBe(false)
    expect(gate.isObsolete(10)).toBe(false)
    gate.receive(12)
    expect(gate.isObsolete(-90)).toBe(false)
    expect(gate.isObsolete(10)).toBe(true)
  })

  test('revisions at zero and out-of-order same-tier requests have stable policy', () => {
    const gate = new RevisionGate()
    gate.receive(0)
    expect(gate.isObsolete(0)).toBe(false)
    gate.receive(2)
    expect(gate.isObsolete(0)).toBe(true)
    gate.receive(1)
    expect(gate.isObsolete(1)).toBe(true)
  })

  test('all tier terminal messages count as completion, ready does not', () => {
    const success: LintTierResult = {
      type: 'result', revision: 10, tier: 'fast', diagnostics: [], ruleErrors: [], durationMs: 1
    }
    const messages: WorkerResponse[] = [
      success,
      { type: 'skipped', revision: 9, tier: 'deep', reason: 'superseded' },
      { type: 'error', revision: 10, tier: 'idle', message: 'failed' },
      { type: 'ready', segmenterAvailable: true }
    ]
    expect(messages.map(isTierCompletion)).toEqual([true, true, true, false])
  })
})
