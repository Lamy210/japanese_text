/**
 * Dev-only browser benchmark driver. It posts synthetic Japanese documents to
 * the SAME analysis.worker.ts as the app, without reading application state.
 * This does not measure CodeMirror keystrokes, rendering or real user input.
 */
import { createDefaultConfig } from '../core/config/validate'
import type { RuleTier } from '../core/types'
import type { LintRequest, LintTierResult, WorkerResponse } from '../worker/protocol'
import {
  BENCHMARK_LENGTHS,
  BENCHMARK_WORKLOADS,
  createWorkload,
  summarizeLatency,
  type LatencySummary,
  type WorkloadKind
} from '../../tests/performance/workloads'

const ALL_TIERS: RuleTier[] = ['fast', 'deep', 'idle']
const DEFAULT_TIMEOUT_MS = 60_000

export interface WorkerRequestMeasurement {
  /** Main thread postMessage to receipt of all three terminal results. */
  roundTripMs: number
  /** Sum of reported own-rule duration; excludes textlint and transfer time. */
  workerDurationMs: number
  perTierMs: Record<RuleTier, number>
  /** Elapsed since postMessage for the first successful response of each tier. */
  perTierRoundTripMs: Record<RuleTier, number>
  diagnosticsCount: number
}

export interface WorkerBenchmarkOptions {
  workloads: WorkloadKind[]
  lengths: number[]
  iterations: number
  warmups: number
  timeoutMs?: number
}

export interface WorkerBenchmarkRow {
  workload: WorkloadKind
  utf16Length: number
  roundTrip: LatencySummary
  workerDuration: LatencySummary
  /** Wall-clock postMessage -> each tier response; includes preceding tiers. */
  perTierRoundTrip: Record<RuleTier, LatencySummary>
  totalDiagnostics: number
}

export interface WorkerBenchmarkReport {
  schemaVersion: 1
  scope: string
  environment: { userAgent: string }
  iterations: number
  warmups: number
  /** First actual lint round-trip after creating the Worker (includes lazy imports). */
  coldStartMs: number
  rows: WorkerBenchmarkRow[]
}

export function measureWorkerRequest(
  worker: Worker,
  request: LintRequest,
  options: { timeoutMs?: number; now?: () => number } = {}
): Promise<WorkerRequestMeasurement> {
  const wanted = new Set(request.tiers)
  if (wanted.size === 0 || wanted.size !== request.tiers.length) {
    return Promise.reject(new Error('Requested tiers must be nonempty and unique'))
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 180_000) {
    return Promise.reject(new Error('Invalid Worker timeout'))
  }
  const now = options.now ?? (() => performance.now())
  return new Promise((resolve, reject) => {
    const results = new Map<RuleTier, LintTierResult>()
    const perTierRoundTripMs = { fast: 0, deep: 0, idle: 0 }
    const started = now()
    let done = false
    let timer: ReturnType<typeof setTimeout> | undefined

    function finish(error?: Error): void {
      if (done) return
      done = true
      if (timer !== undefined) clearTimeout(timer)
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
      if (error) {
        reject(error)
        return
      }
      const perTierMs = { fast: 0, deep: 0, idle: 0 }
      let diagnosticsCount = 0
      for (const [tier, value] of results) {
        perTierMs[tier] = value.durationMs
        diagnosticsCount += value.diagnostics.length
      }
      resolve({
        roundTripMs: Math.max(0, now() - started),
        workerDurationMs: Object.values(perTierMs).reduce((sum, ms) => sum + ms, 0),
        perTierMs,
        perTierRoundTripMs,
        diagnosticsCount
      })
    }

    function onMessage(event: MessageEvent<WorkerResponse>): void {
      const message = event.data
      if (message.type === 'ready' || message.revision !== request.revision ||
          !wanted.has(message.tier) || results.has(message.tier)) return
      if (message.type !== 'result') {
        finish(new Error(`Worker ${message.type} during ${message.tier} tier`))
        return
      }
      if (message.ruleErrors.length > 0) {
        finish(new Error(`Worker returned ${message.ruleErrors.length} rule failures in ${message.tier}`))
        return
      }
      if (!Number.isFinite(message.durationMs) || message.durationMs < 0) {
        finish(new Error('Worker returned an invalid duration'))
        return
      }
      results.set(message.tier, message)
      perTierRoundTripMs[message.tier] = Math.max(0, now() - started)
      if (results.size === wanted.size) finish()
    }

    function onError(): void {
      finish(new Error('Analysis Worker crashed during benchmark'))
    }

    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
    timer = setTimeout(() => finish(new Error('Worker benchmark timed out')), timeoutMs)
    try {
      worker.postMessage(request)
    } catch (error) {
      finish(error instanceof Error ? error : new Error('Failed to post Worker benchmark request'))
    }
  })
}

function validateOptions(options: WorkerBenchmarkOptions): void {
  const { workloads, lengths, iterations, warmups } = options
  if (workloads.length === 0 || new Set(workloads).size !== workloads.length ||
      workloads.some(w => !BENCHMARK_WORKLOADS.includes(w)) ||
      lengths.length === 0 || new Set(lengths).size !== lengths.length ||
      lengths.some(n => !BENCHMARK_LENGTHS.includes(n as typeof BENCHMARK_LENGTHS[number])) ||
      !Number.isSafeInteger(iterations) || iterations < 1 || iterations > 20 ||
      !Number.isSafeInteger(warmups) || warmups < 0 || warmups > 5 ||
      workloads.length * lengths.length * (iterations + warmups) > 120) {
    throw new Error('Invalid or excessive browser benchmark plan')
  }
}

export async function runBrowserWorkerBenchmark(
  worker: Worker,
  options: WorkerBenchmarkOptions,
  environment: { userAgent?: string; now?: () => number } = {},
  onProgress?: (completed: number, total: number) => void
): Promise<WorkerBenchmarkReport> {
  validateOptions(options)
  // This Worker is private to the benchmark. Its strictly decreasing negative
  // revisions cannot supersede any document lint requests.
  let nextRevision = -1
  const config = createDefaultConfig()
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const total = options.workloads.length * options.lengths.length * options.iterations
  let completed = 0

  const measure = (kind: WorkloadKind, length: number) =>
    measureWorkerRequest(worker, {
      type: 'lint',
      revision: nextRevision--,
      text: createWorkload(kind, length),
      config,
      docType: 'markdown',
      tiers: [...ALL_TIERS]
    }, { timeoutMs, now: environment.now })

  // Capture real first-request latency on the freshly constructed Worker.
  const cold = await measure(options.workloads[0]!, options.lengths[0]!)
  const rows: WorkerBenchmarkRow[] = []
  for (const workload of options.workloads) {
    for (const utf16Length of options.lengths) {
      for (let i = 0; i < options.warmups; i++) await measure(workload, utf16Length)
      const roundTrips: number[] = []
      const ownDurations: number[] = []
      const tierRoundTrips: Record<RuleTier, number[]> = { fast: [], deep: [], idle: [] }
      let totalDiagnostics = 0
      for (let i = 0; i < options.iterations; i++) {
        const sample = await measure(workload, utf16Length)
        roundTrips.push(sample.roundTripMs)
        ownDurations.push(sample.workerDurationMs)
        for (const tier of ALL_TIERS) tierRoundTrips[tier].push(sample.perTierRoundTripMs[tier])
        totalDiagnostics += sample.diagnosticsCount
        completed++
        onProgress?.(completed, total)
      }
      rows.push({
        workload,
        utf16Length,
        roundTrip: summarizeLatency(roundTrips),
        workerDuration: summarizeLatency(ownDurations),
        perTierRoundTrip: {
          fast: summarizeLatency(tierRoundTrips.fast),
          deep: summarizeLatency(tierRoundTrips.deep),
          idle: summarizeLatency(tierRoundTrips.idle)
        },
        totalDiagnostics
      })
    }
  }
  return {
    schemaVersion: 1,
    scope: 'Browser Worker request/response RTT on synthetic input; excludes editor input/paint. Worker duration excludes textlint and transfer.',
    environment: { userAgent: environment.userAgent ?? 'unknown' },
    iterations: options.iterations,
    warmups: options.warmups,
    coldStartMs: cold.roundTripMs,
    rows
  }
}
