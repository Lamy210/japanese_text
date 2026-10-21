import { describe, expect, test } from 'vitest'
import { getPreset } from '../../src/core/config/presets'
import { formatDocument } from '../../src/core/formatter/formatter'
import { buildRuleRegistry } from '../../src/core/rules/registry'
import { runSingleRule, runTier, testConfig } from '../helpers'

const phraseId = 'wording/repeated-phrase'
const conjunctionId = 'style/consecutive-conjunction'
const check = (ruleId: string, text: string) => runSingleRule(ruleId, text, testConfig())

describe('repeated Japanese phrases', () => {
  test('flags the second occurrence of an immediately repeated particle phrase with exact UTF-16 offsets', () => {
    const text = '😊この仕様について、について説明します。'
    const results = check(phraseId, text)
    expect(results).toHaveLength(1)
    expect(results[0]?.start).toBe(text.lastIndexOf('について'))
    expect(text.slice(results[0]!.start, results[0]!.end)).toBe('について')
    expect(results[0]?.message).toContain('重複')
    expect(results[0]?.fixKind).toBe('none')
    expect(results[0]?.replacement).toBeUndefined()
  })

  test('recognizes other bounded patterns with full-width commas and spaces', () => {
    const text = '実装に関して， に関して確認します。'
    const results = check(phraseId, text)
    expect(results).toHaveLength(1)
    expect(results[0]?.start).toBe(text.lastIndexOf('に関して'))
  })

  test('does not flag nonadjacent repetitions or different expressions', () => {
    expect(check(phraseId, '日本について、教育について説明します。')).toEqual([])
    expect(check(phraseId, '仕様について、設計に関して議論します。')).toEqual([])
    expect(check(phraseId, 'この表現について説明します。')).toEqual([])
  })

  test('ignores inline quotations, fenced/inline code, links, block quotes, lists and headings', () => {
    const text = [
      '「について、について」',
      '`について、について`',
      '```md',
      'について、について',
      '```',
      '[こちら](https://example.com/について、について)',
      '> について、について',
      '- について、について',
      '# について、について'
    ].join('\n')
    expect(check(phraseId, text)).toEqual([])
  })

  test('finds prose outside a masked code region without shifting offsets', () => {
    const text = '`について、について` 本文について、について説明します。'
    const results = check(phraseId, text)
    expect(results).toHaveLength(1)
    expect(results[0]?.start).toBe(text.lastIndexOf('について'))
  })
})

describe('consecutive Japanese conjunctions', () => {
  test('flags the second sentence-initial repeated connective, not the first', () => {
    const text = '😊しかし、雨です。しかし、風もあります。'
    const results = check(conjunctionId, text)
    expect(results).toHaveLength(1)
    expect(results[0]?.start).toBe(text.lastIndexOf('しかし'))
    expect(text.slice(results[0]!.start, results[0]!.end)).toBe('しかし')
    expect(results[0]?.message).toContain('接続詞')
  })

  test('detects adjacent sentences across a single newline', () => {
    const text = 'また、準備します。\nまた、確認します。'
    expect(check(conjunctionId, text)).toHaveLength(1)
  })

  test('does not report different, non-adjacent or non-connective expressions', () => {
    expect(check(conjunctionId, 'しかし、雨です。また、風があります。')).toEqual([])
    expect(check(conjunctionId, 'しかし、雨です。今日は寒いです。しかし、風もあります。')).toEqual([])
    expect(check(conjunctionId, 'また会いましょう。また、連絡します。')).toEqual([])
    expect(check(conjunctionId, 'しかしながら、雨です。しかし、風もあります。')).toEqual([])
  })

  test('does not compare across blank paragraphs or Markdown structural boundaries', () => {
    expect(check(conjunctionId, 'しかし、雨です。\n\nしかし、寒いです。')).toEqual([])
    expect(check(conjunctionId, 'しかし、雨です。\n# 見出し\nしかし、寒いです。')).toEqual([])
    expect(check(conjunctionId, 'しかし、雨です。\n- リストです。\nしかし、寒いです。')).toEqual([])
    expect(check(conjunctionId, 'しかし、雨です。\n> 引用です。\nしかし、寒いです。')).toEqual([])
  })

  test('ignores quoted dialogue and fenced/inline code, without leaking prior evidence', () => {
    const text = [
      '「しかし、雨です。しかし、寒いです。」',
      '```text',
      'しかし、雨です。しかし、寒いです。',
      '```',
      'しかし、雨です。',
      '`しかし、寒いです。`',
      'しかし、風もあります。'
    ].join('\n')
    expect(check(conjunctionId, text)).toEqual([])
  })

  test('reports the second of three consecutive connectors and preserves no-fix semantics', () => {
    const text = 'しかし、雨です。しかし、風です。しかし、寒いです。'
    const results = check(conjunctionId, text)
    expect(results).toHaveLength(2)
    for (const result of results) {
      expect(result.fixKind).toBe('none')
      expect(result.replacement).toBeUndefined()
    }
    expect(formatDocument(text, results).text).toBe(text)
  })
})

describe('rule registration and backward-compatible presets', () => {
  test('registers both native fast rules with conservative presets and no new dependencies', () => {
    const registry = buildRuleRegistry(testConfig())
    expect(registry.get(phraseId)?.tier).toBe('fast')
    expect(registry.get(conjunctionId)?.tier).toBe('fast')
    for (const id of [phraseId, conjunctionId]) {
      expect(getPreset('general')?.rules[id]).toEqual({ enabled: true, severity: 'info' })
      expect(getPreset('technical')?.rules[id]).toEqual({ enabled: true, severity: 'info' })
      expect(getPreset('strict')?.rules[id]).toEqual({ enabled: true, severity: 'warning' })
      expect(getPreset('minimal')?.rules[id]).toBeUndefined()
    }
    const results = runTier('について、について説明します。しかし、雨です。しかし、風です。', testConfig(), 'fast')
    expect(results.ruleErrors).toEqual([])
    expect(results.diagnostics.some((d) => d.ruleId === phraseId)).toBe(true)
    expect(results.diagnostics.some((d) => d.ruleId === conjunctionId)).toBe(true)
  })
})
