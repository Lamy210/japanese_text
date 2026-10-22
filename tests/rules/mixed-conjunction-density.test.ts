import { describe, expect, test } from 'vitest'
import { getPreset } from '../../src/core/config/presets'
import { buildRuleRegistry } from '../../src/core/rules/registry'
import { formatDocument } from '../../src/core/formatter/formatter'
import { runSingleRule, runTier, testConfig } from '../helpers'

const id = 'style/mixed-conjunction-density'
const scan = (text: string) => runSingleRule(id, text, testConfig())

describe('mixed conjunction density: cross-category, nonduplicative hints', () => {
  test('flags the third of three distinct conjunctions including nonadditive signals', () => {
    const text = 'しかし、調査します。また、確認します。一方、問題が残ります。'
    const d = scan(text)
    expect(d).toHaveLength(1)
    expect(text.slice(d[0]!.start, d[0]!.end)).toBe('一方')
    expect(d[0]?.fixKind).toBe('none')
    expect(d[0]?.replacement).toBeUndefined()
    expect(formatDocument(text, d).text).toBe(text)
  })

  test('flags each new third-or-later conjunction in a longer chain', () => {
    const text = 'しかし、確認します。また、共有します。一方、調査します。つまり、対応します。'
    expect(scan(text).map(x => text.slice(x.start, x.end))).toEqual(['一方', 'つまり'])
  })

  test('does not duplicate existing additive connector density or consecutive-same guidance', () => {
    const additive = 'また、確認します。さらに、共有します。加えて、評価します。'
    expect(scan(additive)).toEqual([])
    expect(runSingleRule('style/additive-conjunction-density', additive, testConfig())).toHaveLength(1)
    const same = 'しかし、確認します。しかし、共有します。また、調査します。'
    expect(scan(same)).toEqual([])
    expect(runSingleRule('style/consecutive-conjunction', same, testConfig())).toHaveLength(1)
  })

  test('does not bridge blank paragraphs, heading sections, or narrative sentences', () => {
    const first = 'しかし、調査します。また、確認します。'
    for (const ending of [
      '\n\n一方、共有します。',
      '\n## 次の項目\n一方、共有します。',
      '問題があります。一方、共有します。',
      '\n- 箇条書きです。\n一方、共有します。'
    ]) expect(scan(first + ending)).toEqual([])
  })

  test('ignores quoted, code and markdown blockquoted chains', () => {
    for (const text of [
      '「しかし、調査します。また、確認します。一方、共有します。」',
      '`しかし、調査します。また、確認します。一方、共有します。`',
      '```md\nしかし、調査します。また、確認します。一方、共有します。\n```',
      '> しかし、調査します。また、確認します。一方、共有します。'
    ]) expect(scan(text)).toEqual([])
  })

  test('preserves UTF-16 offsets when emoji precedes three connective sentences', () => {
    const text = '🌸開始します。しかし、調査します。また、確認します。一方、共有します。'
    const results = scan(text)
    expect(results).toHaveLength(1)
    expect(results[0]?.start).toBe(text.lastIndexOf('一方'))
  })

  test('registers informational, safe-by-default configuration', () => {
    const rule = buildRuleRegistry(testConfig()).get(id)
    expect(rule?.tier).toBe('fast')
    expect(rule?.defaultSeverity).toBe('info')
    for (const p of ['general', 'technical', 'strict'] as const) {
      expect(getPreset(p)?.rules[id]).toEqual({ enabled: true, severity: 'info' })
    }
    expect(getPreset('minimal')?.rules[id]).toBeUndefined()
    const run = runTier('しかし、確認します。また、共有します。一方、評価します。', testConfig(), 'fast')
    expect(run.ruleErrors).toEqual([])
    expect(run.diagnostics.some(x => x.ruleId === id)).toBe(true)
  })
})
