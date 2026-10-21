import { describe, expect, test } from 'vitest'
import { runSingleRule, testConfig } from '../helpers'
import data from './japanese-quality-v2.json'
import { summarizeQuality, type QualityRow } from './quality-summary'
import { type SpanLabel } from './scorer'

type GoldLabel = { surface: string; occurrence: number }
type Sample = {
  id: string
  ruleId: string
  genre: string
  group: string
  split: 'development' | 'holdout'
  text: string
  expected: GoldLabel[]
  note?: string
}

const samples: Sample[] = data.cases as Sample[]
const supported = new Set([
  'wording/double-honorific',
  'wording/nominalized-action',
  'wording/repeated-phrase',
  'wording/redundancy',
  'style/consecutive-conjunction',
  'style/additive-conjunction-density'
])

function nthOffset(text: string, surface: string, occurrence: number): number {
  if (surface.length === 0 || !Number.isSafeInteger(occurrence) || occurrence < 1) {
    throw new Error('Invalid gold annotation')
  }
  let offset = 0
  let location = -1
  for (let i = 0; i < occurrence; i++) {
    location = text.indexOf(surface, offset)
    if (location < 0) throw new Error(`Missing annotation for ${surface} #${occurrence}`)
    offset = location + surface.length
  }
  return location
}

function gold(sample: Sample): SpanLabel[] {
  return sample.expected.map(({ surface, occurrence }) => {
    const start = nthOffset(sample.text, surface, occurrence)
    return { ruleId: sample.ruleId, start, end: start + surface.length }
  })
}

function predict(sample: Sample): SpanLabel[] {
  return runSingleRule(sample.ruleId, sample.text, testConfig()).map(
    ({ ruleId, start, end }) => ({ ruleId, start, end })
  )
}

function sortSpans(spans: readonly SpanLabel[]): SpanLabel[] {
  return [...spans].sort((a, b) =>
    a.start - b.start || a.end - b.end || a.ruleId.localeCompare(b.ruleId)
  )
}

function analyze(): QualityRow[] {
  return samples.map(s => ({
    ruleId: s.ruleId,
    genre: s.genre,
    group: s.group,
    split: s.split,
    gold: gold(s),
    predicted: predict(s)
  }))
}

describe('quality evaluation v2: annotations and coverage', () => {
  test('uses unique IDs, explicit UTF-16 gold and distinct domains/splits', () => {
    expect(data.schemaVersion).toBe(2)
    expect(samples.length).toBeGreaterThanOrEqual(100)
    expect(new Set(samples.map(x => x.id)).size).toBe(samples.length)
    expect(samples.filter(x => x.expected.length > 0).length).toBeGreaterThanOrEqual(40)
    expect(samples.filter(x => x.expected.length === 0).length).toBeGreaterThanOrEqual(40)
    expect(new Set(samples.map(x => x.ruleId))).toEqual(supported)
    expect(new Set(samples.map(x => x.split))).toEqual(new Set(['development', 'holdout']))
    for (const sample of samples) {
      expect(sample.id.trim()).not.toBe('')
      expect(sample.text).not.toBe('')
      expect(['development', 'holdout']).toContain(sample.split)
      expect(sample.genre.trim()).not.toBe('')
      expect(sample.group.trim()).not.toBe('')
      const labels = gold(sample)
      expect(new Set(labels.map(x => JSON.stringify(x))).size).toBe(labels.length)
      expect(labels.every(x => x.start >= 0 && x.end <= sample.text.length && x.end > x.start)).toBe(true)
    }
  })
})

describe('quality evaluation v2: independently declared diagnostic spans', () => {
  for (const sample of samples) {
    test(`${sample.id}: ${sample.ruleId}, ${sample.group}`, () => {
      expect(sortSpans(predict(sample))).toEqual(sortSpans(gold(sample)))
    })
  }
})

describe('quality evaluation v2: transparent grouped metrics', () => {
  test('scores exact spans and counts false alarms on negative samples separately', () => {
    const rows: QualityRow[] = [
      {
        ruleId: 'demo/a', genre: 'business', group: 'positive', split: 'development',
        gold: [{ ruleId: 'demo/a', start: 0, end: 2 }],
        predicted: [{ ruleId: 'demo/a', start: 0, end: 2 }]
      },
      {
        ruleId: 'demo/a', genre: 'business', group: 'negative', split: 'holdout',
        gold: [], predicted: [{ ruleId: 'demo/a', start: 0, end: 2 }]
      },
      {
        ruleId: 'demo/b', genre: 'technical', group: 'negative', split: 'holdout',
        gold: [], predicted: []
      }
    ]
    const summary = summarizeQuality(rows)
    expect(summary.overall.counts).toEqual({ tp: 1, fp: 1, fn: 0 })
    expect(summary.overall.negativeCaseFalseAlarmRate).toBe(0.5)
    expect(summary.perRule['demo/a']?.counts.fp).toBe(1)
    expect(summary.perRule['demo/b']?.metrics.precision).toBeNull()
    expect(summary.perSplit.holdout?.cases).toBe(2)
    expect(summary.perGenre.business?.falsePositiveCases).toBe(1)
  })

  test('maintains strict zero-regression counts on this authored synthetic fixture', () => {
    const summary = summarizeQuality(analyze())
    console.info('Synthetic quality v2 (NOT real-world accuracy):', JSON.stringify(summary))
    expect(summary.overall.cases).toBe(samples.length)
    expect(summary.overall.counts.tp).toBeGreaterThan(40)
    expect(summary.overall.counts.fp).toBe(0)
    expect(summary.overall.counts.fn).toBe(0)
    expect(summary.overall.falsePositiveCases).toBe(0)
    expect(Object.keys(summary.perRule)).toHaveLength(supported.size)
    expect(summary.perSplit.development?.cases).toBeGreaterThan(0)
    expect(summary.perSplit.holdout?.cases).toBeGreaterThan(0)
    for (const bucket of Object.values(summary.perRule)) {
      expect(bucket.positiveCases).toBeGreaterThan(0)
      expect(bucket.negativeCases).toBeGreaterThan(0)
      expect(bucket.counts.fp).toBe(0)
      expect(bucket.counts.fn).toBe(0)
    }
  })
})
