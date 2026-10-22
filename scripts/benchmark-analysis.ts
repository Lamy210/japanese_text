/**
 * Run with `bun run bench:analysis` or `bun run bench:smoke`.
 * Measures pure own-rule execution in the local runtime, NOT Worker scheduling,
 * browser input latency, textlint, real-world documents or end-to-end typing.
 * This is a baseline tool, not a hard performance gate on shared CI hardware.
 */
import { createDefaultConfig } from '../src/core/config/validate'
import { buildRuleContext, prepareOwnRuleExecution, runOwnRules } from '../src/core/engine/engine'
import {
  BENCHMARK_LENGTHS,
  BENCHMARK_WORKLOADS,
  createWorkload,
  summarizeLatency,
  type LatencySummary,
  type WorkloadKind
} from '../tests/performance/workloads'

type Stage = 'context' | 'fast' | 'deep-own' | 'idle' | 'all-own-fresh' | 'all-own-shared'
interface Row {
  workload: WorkloadKind
  utf16Length: number
  stage: Stage
  latency: LatencySummary
  totalDiagnostics: number
}

const args = new Set(process.argv.slice(2))
const smoke = args.has('--smoke')
const json = args.has('--json')
const sizes = smoke ? [1_000, 10_000] : [...BENCHMARK_LENGTHS]
const warmups = smoke ? 0 : 2
const iterations = smoke ? 1 : 5

function measure(fn: () => number): { latency: LatencySummary; totalDiagnostics: number } {
  for (let j = 0; j < warmups; j++) fn()
  const samplesMs: number[] = []
  let totalDiagnostics = 0
  for (let j = 0; j < iterations; j++) {
    const start = performance.now()
    totalDiagnostics += fn()
    const duration = performance.now() - start
    samplesMs.push(duration)
  }
  return { latency: summarizeLatency(samplesMs), totalDiagnostics }
}

const config = createDefaultConfig()
const rows: Row[] = []
for (const kind of BENCHMARK_WORKLOADS) {
  for (const utf16Length of sizes) {
    const text = createWorkload(kind, utf16Length)
    const stages: Array<[Stage, () => number]> = [
      ['context', () => buildRuleContext(text).maskRegions.length],
      ['fast', () => runOwnRules(text, config, 'fast', 'markdown').diagnostics.length],
      ['deep-own', () => runOwnRules(text, config, 'deep', 'markdown').diagnostics.length],
      ['idle', () => runOwnRules(text, config, 'idle', 'markdown').diagnostics.length],
      ['all-own-fresh', () =>
        (['fast', 'deep', 'idle'] as const).reduce(
          (sum, tier) => sum + runOwnRules(text, config, tier, 'markdown').diagnostics.length, 0
        )
      ],
      ['all-own-shared', () => {
        const prepared = prepareOwnRuleExecution(text, config)
        return (['fast', 'deep', 'idle'] as const).reduce(
          (sum, tier) => sum + runOwnRules(text, config, tier, 'markdown', prepared).diagnostics.length, 0
        )
      }]
    ]
    for (const [stage, fn] of stages) {
      rows.push({ workload: kind, utf16Length, stage, ...measure(fn) })
    }
  }
}

const report = {
  schemaVersion: 1,
  scope: 'synthetic own-rule CPU and context only; excludes browser, Worker communication and textlint adapter',
  environment: { runtime: `bun ${Bun.version}`, platform: process.platform, architecture: process.arch },
  warmups,
  iterations,
  rows
}
if (json) {
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
} else {
  console.info('Synthetic baseline only; do not treat these results as browser input latency.')
  console.info('workload\tUTF-16\tstage\tp50(ms)\tp95(ms)\tp99(ms)\tdiagnostics')
  for (const row of rows) {
    console.info([
      row.workload, row.utf16Length, row.stage,
      row.latency.p50Ms.toFixed(2), row.latency.p95Ms.toFixed(2), row.latency.p99Ms.toFixed(2),
      row.totalDiagnostics
    ].join('\t'))
  }
}
