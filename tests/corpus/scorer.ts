/**
 * Exact-span evaluation utilities. A diagnostic is correct only if ruleId,
 * start and end (UTF-16) all match an independently annotated gold span.
 */
export interface SpanLabel {
  ruleId: string
  start: number
  end: number
}
export interface Counts {
  tp: number
  fp: number
  fn: number
}
export interface Metrics extends Counts {
  precision: number | null
  recall: number | null
}

function key(label: SpanLabel): string {
  return JSON.stringify([label.ruleId, label.start, label.end])
}

/** Multiset accounting makes duplicate predictions visible as false positives. */
export function scoreSpans(gold: readonly SpanLabel[], predicted: readonly SpanLabel[]): Counts {
  const remaining = new Map<string, number>()
  for (const span of gold) {
    const k = key(span)
    remaining.set(k, (remaining.get(k) ?? 0) + 1)
  }
  let tp = 0
  let fp = 0
  for (const span of predicted) {
    const k = key(span)
    const n = remaining.get(k) ?? 0
    if (n > 0) {
      tp++
      remaining.set(k, n - 1)
    } else {
      fp++
    }
  }
  const fn = [...remaining.values()].reduce((sum, n) => sum + n, 0)
  return { tp, fp, fn }
}

export function metrics(counts: Counts): Metrics {
  return {
    ...counts,
    precision: counts.tp + counts.fp === 0 ? null : counts.tp / (counts.tp + counts.fp),
    recall: counts.tp + counts.fn === 0 ? null : counts.tp / (counts.tp + counts.fn)
  }
}

export function addCounts(a: Counts, b: Counts): Counts {
  return { tp: a.tp + b.tp, fp: a.fp + b.fp, fn: a.fn + b.fn }
}
