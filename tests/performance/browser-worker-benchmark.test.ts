import { describe, expect, test } from 'vitest'
import type { LintRequest, WorkerResponse } from '../../src/worker/protocol'
import {
  measureWorkerRequest,
  runBrowserWorkerBenchmark
} from '../../src/dev/worker-benchmark'
import { createDefaultConfig } from '../../src/core/config/validate'

type Emit = (message: WorkerResponse) => void

function fakeWorker(
  process: (request: LintRequest, emit: Emit) => void
): { worker: Worker; listeners: () => number } {
  const messages = new Set<(event: MessageEvent<WorkerResponse>) => void>()
  const errors = new Set<(event: ErrorEvent) => void>()
  const worker = {
    addEventListener(type: string, callback: (event: never) => void) {
      if (type === 'message') messages.add(callback as (event: MessageEvent<WorkerResponse>) => void)
      if (type === 'error') errors.add(callback as (event: ErrorEvent) => void)
    },
    removeEventListener(type: string, callback: (event: never) => void) {
      if (type === 'message') messages.delete(callback as (event: MessageEvent<WorkerResponse>) => void)
      if (type === 'error') errors.delete(callback as (event: ErrorEvent) => void)
    },
    postMessage(request: LintRequest) {
      queueMicrotask(() => process(request, message =>
        messages.forEach(callback => callback({ data: message } as MessageEvent<WorkerResponse>))
      ))
    }
  } as unknown as Worker
  return { worker, listeners: () => messages.size + errors.size }
}

function emitResults(request: LintRequest, emit: Emit): void {
  emit({ type: 'ready', segmenterAvailable: true })
  request.tiers.forEach(tier => emit({
    type: 'result', revision: request.revision, tier,
    diagnostics: [], ruleErrors: [], durationMs: 3
  }))
}

const request = (revision: number): LintRequest => ({
  type: 'lint', revision, text: '合成文書を確認しました。',
  docType: 'markdown', tiers: ['fast', 'deep', 'idle'],
  config: createDefaultConfig()
})

describe('browser Worker end-to-end latency measurement', () => {
  test('waits for all three tier results and cleans up listeners', async () => {
    const { worker, listeners } = fakeWorker((req, emit) => {
      emitResults(req, emit)
      emit({
        type: 'result', revision: req.revision + 10, tier: 'deep',
        diagnostics: [], ruleErrors: [], durationMs: 999
      })
    })
    const result = await measureWorkerRequest(worker, request(-1))
    expect(result.roundTripMs).toBeGreaterThanOrEqual(0)
    expect(result.workerDurationMs).toBe(9)
    expect(result.diagnosticsCount).toBe(0)
    expect(result.perTierMs).toEqual({ fast: 3, deep: 3, idle: 3 })
    expect(listeners()).toBe(0)
  })

  test('rejects terminal skip, error and rule failures without falsely reporting a latency sample', async () => {
    const modes = [
      (req: LintRequest, emit: Emit) => emit({ type: 'skipped', revision: req.revision, tier: 'fast', reason: 'superseded' }),
      (req: LintRequest, emit: Emit) => emit({ type: 'error', revision: req.revision, tier: 'fast', message: 'failed' }),
      (req: LintRequest, emit: Emit) => emit({
        type: 'result', revision: req.revision, tier: 'fast', diagnostics: [],
        durationMs: 1, ruleErrors: [{ ruleId: 'textlint', message: 'broken' }]
      })
    ]
    for (const mode of modes) {
      const { worker, listeners } = fakeWorker(mode)
      await expect(measureWorkerRequest(worker, request(-1))).rejects.toThrow()
      expect(listeners()).toBe(0)
    }
  })

  test('rejects duplicate tiers and properly handles a silent Worker timeout', async () => {
    const { worker, listeners } = fakeWorker(() => undefined)
    await expect(measureWorkerRequest(worker, { ...request(-2), tiers: ['fast', 'fast'] })).rejects.toThrow()
    await expect(measureWorkerRequest(worker, request(-3), { timeoutMs: 5 })).rejects.toThrow('timed out')
    expect(listeners()).toBe(0)
  })

  test('ignores unknown revisions and duplicate terminal tiers', async () => {
    const { worker } = fakeWorker((req, emit) => {
      emit({ type: 'result', revision: req.revision + 1, tier: 'fast', diagnostics: [], ruleErrors: [], durationMs: 444 })
      emit({ type: 'result', revision: req.revision, tier: 'fast', diagnostics: [], ruleErrors: [], durationMs: 2 })
      emit({ type: 'result', revision: req.revision, tier: 'fast', diagnostics: [], ruleErrors: [], durationMs: 500 })
      emit({ type: 'result', revision: req.revision, tier: 'deep', diagnostics: [], ruleErrors: [], durationMs: 4 })
      emit({ type: 'result', revision: req.revision, tier: 'idle', diagnostics: [], ruleErrors: [], durationMs: 6 })
    })
    const result = await measureWorkerRequest(worker, request(-1))
    expect(result.perTierMs).toEqual({ fast: 2, deep: 4, idle: 6 })
    expect(result.workerDurationMs).toBe(12)
  })

  test('reports only aggregate timings and counts for synthetic inputs, never the text', async () => {
    const { worker } = fakeWorker(emitResults)
    const report = await runBrowserWorkerBenchmark(worker, {
      workloads: ['prose', 'markdown'],
      lengths: [1000],
      iterations: 2,
      warmups: 1,
      timeoutMs: 5000
    }, { userAgent: 'test-browser', now: () => 123 })
    expect(report.rows).toHaveLength(2)
    expect(report.rows[0]?.roundTrip.count).toBe(2)
    expect(report.rows[1]?.roundTrip.count).toBe(2)
    expect(report.environment.userAgent).toBe('test-browser')
    expect(report.coldStartMs).toBeGreaterThanOrEqual(0)
    expect(JSON.stringify(report)).not.toContain('本日の作業')
    expect(JSON.stringify(report)).not.toContain('合成文書を確認')
    expect(report.rows.every(row => row.workerDuration.count === 2)).toBe(true)
    expect(report.scope).toContain('Worker')
  })

  test('fails fast on invalid input plans instead of starting unbounded browser work', async () => {
    const { worker } = fakeWorker(emitResults)
    await expect(runBrowserWorkerBenchmark(worker, {
      workloads: ['prose'], lengths: [1000], iterations: 0, warmups: 0
    })).rejects.toThrow()
    await expect(runBrowserWorkerBenchmark(worker, {
      workloads: ['prose'], lengths: [1000], iterations: 2, warmups: 500
    })).rejects.toThrow()
    await expect(runBrowserWorkerBenchmark(worker, {
      workloads: [], lengths: [1000], iterations: 2, warmups: 0
    })).rejects.toThrow()
  })
})
