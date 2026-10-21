import { describe, expect, test } from 'vitest'
import {
  BENCHMARK_LENGTHS,
  BENCHMARK_WORKLOADS,
  createWorkload,
  summarizeLatency
} from './workloads'
import { buildRuleContext, runOwnRules } from '../../src/core/engine/engine'
import { createDefaultConfig } from '../../src/core/config/validate'

describe('analysis performance harness validity', () => {
  test('covers short, medium and long documents without storing source content', () => {
    expect(BENCHMARK_LENGTHS).toEqual([1_000, 10_000, 50_000, 100_000])
    expect(BENCHMARK_WORKLOADS).toContain('markdown')
    expect(BENCHMARK_WORKLOADS).toContain('repetition')
    expect(BENCHMARK_WORKLOADS).toContain('long-sentence')
    for (const kind of BENCHMARK_WORKLOADS) {
      for (const length of BENCHMARK_LENGTHS) {
        const a = createWorkload(kind, length)
        expect(a.length).toBe(length)
        expect(createWorkload(kind, length)).toBe(a)
        expect(a).not.toContain('example@')
      }
    }
  })

  test('rejects unsafe generator lengths', () => {
    for (const length of [0, -1, NaN, Infinity, 1.1, 1_000_001]) {
      expect(() => createWorkload('prose', length)).toThrow()
    }
  })

  test('p50/p95/p99 use sorted nearest-rank order, not average or input order', () => {
    expect(summarizeLatency([9, 1, 5, 7, 3])).toEqual({
      count: 5, minMs: 1, p50Ms: 5, p95Ms: 9, p99Ms: 9, maxMs: 9
    })
    expect(summarizeLatency([0])).toEqual({
      count: 1, minMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0
    })
    expect(() => summarizeLatency([])).toThrow()
    expect(() => summarizeLatency([0, NaN])).toThrow()
    expect(() => summarizeLatency([1, -1])).toThrow()
  })

  test('benchmark engines run real rules on synthetic workloads without errors', () => {
    const cfg = createDefaultConfig()
    for (const workload of ['prose', 'markdown', 'repetition'] as const) {
      const text = createWorkload(workload, 1000)
      const ctx = buildRuleContext(text)
      expect(ctx.text).toBe(text)
      expect(ctx.maskedText.length).toBe(text.length)
      expect(ctx.lines.length).toBe(ctx.lineStarts.length)
      for (const tier of ['fast', 'deep', 'idle'] as const) {
        const result = runOwnRules(text, cfg, tier, 'markdown')
        expect(result.ruleErrors).toEqual([])
        expect(result.durationMs).toBeGreaterThanOrEqual(0)
      }
    }
  })
})
