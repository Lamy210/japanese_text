import { describe, expect, test } from 'vitest'
import { runSingleRule, testConfig } from '../helpers'
import examples from './japanese-writing-v1.json'
import { addCounts, metrics, scoreSpans, type Counts, type SpanLabel } from './scorer'

type Expected = { surface: string; occurrence: number }
type LabeledCase = {
  id: string
  ruleId: string
  group: string
  text: string
  expected: Expected[]
  note?: string
}
const cases: LabeledCase[] = examples.cases

/**
 * Occurrences are 1-based and refer to the original source, including masked
 * tokens. This prevents an implementation's masking logic from becoming the
 * source of truth for gold annotations.
 */
function nthSpan(text: string, surface: string, occurrence: number): { start: number; end: number } {
  if (!Number.isSafeInteger(occurrence) || occurrence < 1 || surface.length === 0) {
    throw new Error('Invalid corpus annotation')
  }
  let index = -1
  let offset = 0
  for (let n = 0; n < occurrence; n++) {
    index = text.indexOf(surface, offset)
    if (index < 0) throw new Error(`Missing occurrence ${occurrence} for ${surface}`)
    offset = index + surface.length
  }
  return { start: index, end: index + surface.length }
}

function goldFor(sample: LabeledCase): SpanLabel[] {
  return sample.expected.map(({ surface, occurrence }) => ({
    ruleId: sample.ruleId,
    ...nthSpan(sample.text, surface, occurrence)
  }))
}

function scan(sample: LabeledCase): SpanLabel[] {
  return runSingleRule(sample.ruleId, sample.text, testConfig())
    .map(({ ruleId, start, end }) => ({ ruleId, start, end }))
}

const ordered = (spans: SpanLabel[]) =>
  spans.sort((a, b) => a.start - b.start || a.end - b.end || a.ruleId.localeCompare(b.ruleId))

describe('Japanese writing corpus: integrity', () => {
  test('has unique IDs, bounded targets, UTF-16-valid independent gold spans and both classes', () => {
    expect(examples.schemaVersion).toBe(1)
    expect(cases.length).toBeGreaterThanOrEqual(50)
    expect(new Set(cases.map((entry) => entry.id)).size).toBe(cases.length)
    expect(cases.filter((entry) => entry.expected.length > 0).length).toBeGreaterThanOrEqual(20)
    expect(cases.filter((entry) => entry.expected.length === 0).length).toBeGreaterThanOrEqual(20)
    const supported = new Set(['wording/repeated-phrase', 'style/consecutive-conjunction'])
    for (const sample of cases) {
      expect(sample.id.trim().length).toBeGreaterThan(0)
      expect(supported.has(sample.ruleId)).toBe(true)
      expect(sample.text.length).toBeGreaterThan(0)
      for (const span of goldFor(sample)) {
        expect(span.start).toBeGreaterThanOrEqual(0)
        expect(span.end).toBeLessThanOrEqual(sample.text.length)
        expect(span.start).toBeLessThan(span.end)
      }
      expect(new Set(goldFor(sample).map((span) => JSON.stringify(span))).size)
        .toBe(sample.expected.length)
    }
  })
})

describe('Japanese writing corpus: exact diagnostic locations', () => {
  for (const sample of cases) {
    test(`${sample.id}: ${sample.group}`, () => {
      expect(ordered(scan(sample))).toEqual(ordered(goldFor(sample)))
    })
  }
})

describe('Japanese writing corpus: evaluation accounting', () => {
  test('counts unexpected, missing and duplicate predictions separately', () => {
    const a = { ruleId: 'demo/a', start: 0, end: 2 }
    const b = { ruleId: 'demo/a', start: 3, end: 5 }
    const c = { ruleId: 'demo/b', start: 0, end: 2 }
    expect(scoreSpans([a, b], [a, a, c])).toEqual({ tp: 1, fp: 2, fn: 1 })
    expect(scoreSpans([], [])).toEqual({ tp: 0, fp: 0, fn: 0 })
    expect(metrics({ tp: 1, fp: 1, fn: 3 })).toMatchObject({ precision: 0.5, recall: 0.25 })
    expect(metrics({ tp: 0, fp: 0, fn: 0 })).toMatchObject({ precision: null, recall: null })
  })

  test('aggregates TP/FP/FN per rule without mistaking true negatives for correct spans', () => {
    const summary = new Map<string, Counts>()
    for (const sample of cases) {
      const counts = scoreSpans(goldFor(sample), scan(sample))
      summary.set(sample.ruleId, addCounts(summary.get(sample.ruleId) ?? { tp: 0, fp: 0, fn: 0 }, counts))
    }
    expect(summary.size).toBe(2)
    for (const [ruleId, counts] of summary) {
      const result = metrics(counts)
      // These are regression fixtures, NOT an unbiased estimate of real-world accuracy.
      console.info(`Corpus (synthetic) ${ruleId}: ${JSON.stringify(result)}`)
      expect(counts.tp).toBeGreaterThan(0)
      expect(counts.fp).toBe(0)
      expect(counts.fn).toBe(0)
    }
  })
})
