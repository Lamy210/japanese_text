import { describe, expect, test } from 'vitest'
import { nextShadowLintRevision } from '../../src/state/shadow-revisions'

describe('unique negative Shadow revisions', () => {
  test('never shares a waiter key during rapid consecutive lint requests', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 10_000; i++) {
      const revision = nextShadowLintRevision()
      expect(Number.isSafeInteger(revision)).toBe(true)
      expect(revision).toBeLessThan(0)
      expect(seen.has(revision)).toBe(false)
      seen.add(revision)
    }
    expect(seen.size).toBe(10_000)
  })
})
