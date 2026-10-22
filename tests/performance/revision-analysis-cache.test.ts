import { describe, expect, test } from 'vitest'
import { createDefaultConfig } from '../../src/core/config/validate'
import {
  prepareAnalysisDocument,
  runOwnRules
} from '../../src/core/engine/engine'
import { RevisionAnalysisCache } from '../../src/core/engine/revision-analysis-cache'

const documents = [
  '📚まず最初に確認します。ご確認してください。資料をを確認します。',
  '# 概要\n\n本文です。[参考](https://example.com/資料)\n```ts\nconst v = 2\n```\n',
  'しかし、調査します。また、共有します。一方、評価します。'
]

describe('reuse immutable document context across analysis tiers', () => {
  test('produces the exact same rule diagnostics as independent context construction', () => {
    const cfg = createDefaultConfig()
    for (const text of documents) {
      const prepared = prepareAnalysisDocument(text)
      expect(prepared.text).toBe(text)
      expect(prepared.context.text).toBe(text)
      for (const tier of ['fast', 'deep', 'idle'] as const) {
        const original = runOwnRules(text, cfg, tier, 'markdown')
        const shared = runOwnRules(text, cfg, tier, 'markdown', prepared)
        expect(shared.diagnostics).toEqual(original.diagnostics)
        expect(shared.ruleErrors).toEqual(original.ruleErrors)
      }
    }
  })

  test('rejects mismatched prepared contexts rather than silently returning wrong offsets', () => {
    const cfg = createDefaultConfig()
    const prepared = prepareAnalysisDocument('短い元文です。')
    expect(() => runOwnRules('📚変更された本文です。', cfg, 'fast', 'markdown', prepared)).toThrow()
  })

  test('shares a context for the same revision and text across fast/deep/idle requests', () => {
    const cache = new RevisionAnalysisCache()
    const doc = documents[0]!
    const first = cache.get(42, doc)
    expect(cache.get(42, doc)).toBe(first)
    expect(cache.size).toBe(1)
    const revised = cache.get(43, '文面が変わりました。')
    expect(revised).not.toBe(first)
    expect(cache.get(43, '文面が変わりました。')).toBe(revised)
    expect(cache.size).toBe(2)
  })

  test('does not reuse a cache entry if a revision is unexpectedly paired with different text', () => {
    const cache = new RevisionAnalysisCache()
    const old = cache.get(44, documents[0]!)
    const next = cache.get(44, documents[1]!)
    expect(next).not.toBe(old)
    expect(next.context.text).toBe(documents[1])
    expect(cache.size).toBe(1)
  })

  test('holds at most two revision contexts and evicts least recently used', () => {
    const cache = new RevisionAnalysisCache(2)
    const a = cache.get(1, 'a')
    const b = cache.get(2, 'b')
    expect(cache.get(1, 'a')).toBe(a)
    cache.get(3, 'c')
    expect(cache.size).toBe(2)
    const newB = cache.get(2, 'b')
    expect(newB).not.toBe(b)
    expect(cache.size).toBe(2)
  })

  test('clear destroys cached references and capacity zero is rejected', () => {
    const cache = new RevisionAnalysisCache()
    const old = cache.get(1, '本文です。')
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.get(1, '本文です。')).not.toBe(old)
    expect(() => new RevisionAnalysisCache(0)).toThrow()
  })
})
