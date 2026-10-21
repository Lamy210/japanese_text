/**
 * Diagnostic quality accounting. This is deliberately test-only:
 * the counters describe an annotated corpus, not an unbiased field estimate.
 */
import { addCounts, metrics, scoreSpans, type Counts, type Metrics, type SpanLabel } from './scorer'

export interface QualityRow {
  ruleId: string
  genre: string
  group: string
  split: 'development' | 'holdout'
  gold: readonly SpanLabel[]
  predicted: readonly SpanLabel[]
}

export interface QualityBucket {
  cases: number
  positiveCases: number
  negativeCases: number
  falsePositiveCases: number
  counts: Counts
  metrics: Metrics
  /** Fraction of negative examples with at least one false positive. */
  negativeCaseFalseAlarmRate: number | null
}

function summarizeBucket(rows: readonly QualityRow[]): QualityBucket {
  let counts: Counts = { tp: 0, fp: 0, fn: 0 }
  let negativeCases = 0
  let falsePositiveCases = 0
  for (const row of rows) {
    const sampleCounts = scoreSpans(row.gold, row.predicted)
    counts = addCounts(counts, sampleCounts)
    if (row.gold.length === 0) {
      negativeCases++
      if (sampleCounts.fp > 0) falsePositiveCases++
    }
  }
  return {
    cases: rows.length,
    positiveCases: rows.length - negativeCases,
    negativeCases,
    falsePositiveCases,
    counts,
    metrics: metrics(counts),
    negativeCaseFalseAlarmRate: negativeCases > 0 ? falsePositiveCases / negativeCases : null
  }
}

export interface QualitySummary {
  overall: QualityBucket
  perRule: Record<string, QualityBucket>
  perGenre: Record<string, QualityBucket>
  perSplit: Record<string, QualityBucket>
  perGroup: Record<string, QualityBucket>
}

function byField(rows: readonly QualityRow[], get: (row: QualityRow) => string): Record<string, QualityBucket> {
  const grouped = new Map<string, QualityRow[]>()
  for (const row of rows) {
    const key = get(row)
    const group = grouped.get(key) ?? []
    group.push(row)
    grouped.set(key, group)
  }
  return Object.fromEntries([...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, members]) => [name, summarizeBucket(members)]))
}

export function summarizeQuality(rows: readonly QualityRow[]): QualitySummary {
  return {
    overall: summarizeBucket(rows),
    perRule: byField(rows, row => row.ruleId),
    perGenre: byField(rows, row => row.genre),
    perSplit: byField(rows, row => row.split),
    perGroup: byField(rows, row => row.group)
  }
}
