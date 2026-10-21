import { describe, expect, test } from 'vitest'
import type { TermEntry } from '../../src/core/config/schema'
import { runSingleRule, testConfig } from '../helpers'
import doc from './common-typo-v1.json'
import { addCounts, metrics, scoreSpans, type Counts, type SpanLabel } from './scorer'

type Label = { surface: string; occurrence: number; replacement: string }
type Sample = {
  id: string
  group: string
  text: string
  expected: Label[]
  terminology?: TermEntry[]
}
const samples = doc.cases as Sample[]
const ruleId = 'wording/common-typo'

function labels(sample: Sample): SpanLabel[] {
  return sample.expected.map(({ surface, occurrence }) => {
    if (!surface || !Number.isSafeInteger(occurrence) || occurrence < 1) throw Error('Invalid annotation')
    let offset = 0
    let start = -1
    for (let i = 0; i < occurrence; i++) {
      start = sample.text.indexOf(surface, offset)
      if (start < 0) throw Error(`Invalid gold occurrence: ${sample.id} ${surface}`)
      offset = start + surface.length
    }
    return { ruleId, start, end: start + surface.length }
  })
}

function predict(sample: Sample) {
  const config = testConfig()
  config.terminology = sample.terminology ?? []
  return runSingleRule(ruleId, sample.text, config)
}

describe('common typo corpus: exact independent gold spans', () => {
  test('contains unique positive, negative, masked and user-override samples', () => {
    expect(doc.schemaVersion).toBe(1)
    expect(samples.length).toBeGreaterThanOrEqual(30)
    expect(new Set(samples.map(s => s.id)).size).toBe(samples.length)
    expect(samples.filter(s => s.expected.length > 0).length).toBeGreaterThanOrEqual(12)
    expect(samples.filter(s => s.expected.length === 0).length).toBeGreaterThanOrEqual(12)
    for (const s of samples) {
      expect(s.id).toBeTruthy()
      expect(s.text).toBeTruthy()
      expect(new Set(labels(s).map(x => JSON.stringify(x))).size).toBe(s.expected.length)
    }
  })

  for (const sample of samples) {
    test(`${sample.id} (${sample.group})`, () => {
      const predicted = predict(sample)
      const expected = labels(sample)
      const actual = predicted.map(({ ruleId, start, end }) => ({ ruleId, start, end }))
      expect(actual).toEqual(expected)
      for (let i = 0; i < expected.length; i++) {
        expect(predicted[i]?.replacement).toBe(sample.expected[i]?.replacement)
        expect(predicted[i]?.fixKind).toBe('suggestion')
      }
    })
  }

  test('reports transparent TP/FP/FN on this synthetic sample, not production accuracy', () => {
    let count: Counts = { tp: 0, fp: 0, fn: 0 }
    for (const s of samples) {
      count = addCounts(count, scoreSpans(labels(s), predict(s).map(d => ({
        ruleId: d.ruleId, start: d.start, end: d.end
      }))))
    }
    const result = metrics(count)
    console.info('Synthetic typo corpus regression:', JSON.stringify(result))
    expect(count.tp).toBeGreaterThanOrEqual(16)
    expect(count.fp).toBe(0)
    expect(count.fn).toBe(0)
  })
})
