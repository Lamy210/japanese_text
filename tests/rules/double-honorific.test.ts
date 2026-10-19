import { describe, expect, test } from 'vitest'
import { getPreset } from '../../src/core/config/presets'
import { buildRuleRegistry } from '../../src/core/rules/registry'
import { runSingleRule, runTier, testConfig } from '../helpers'

const ruleId = 'wording/double-honorific'

describe('double honorific detection', () => {
  const examples: Array<[string, string]> = [
    ['お読みになられる', 'お読みになる'],
    ['お読みになられます', 'お読みになります'],
    ['お読みになられました', 'お読みになりました'],
    ['ご覧になられる', 'ご覧になる'],
    ['ご覧になられます', 'ご覧になります'],
    ['ご覧になられました', 'ご覧になりました'],
    ['おっしゃられる', 'おっしゃる'],
    ['おっしゃられます', 'おっしゃいます'],
    ['おっしゃられました', 'おっしゃいました']
  ]

  test.each(examples)('suggests %s -> %s without a safe auto-fix', (incorrect, replacement) => {
    const source = `お客様は${incorrect}でしょう。`
    const findings = runSingleRule(ruleId, source, testConfig())
    expect(findings).toHaveLength(1)
    expect(source.slice(findings[0]!.start, findings[0]!.end)).toBe(incorrect)
    expect(findings[0]!.replacement).toBe(replacement)
    expect(findings[0]!.fixKind).toBe('suggestion')
    expect(findings[0]!.source).toBe('core')
  })

  test('never diagnoses established expressions or acceptable honorific chaining', () => {
    const text = 'お読みになる。ご覧になります。おっしゃいます。お召し上がりになる。お伺いいたす。お読みになっていらっしゃる。'
    expect(runSingleRule(ruleId, text, testConfig())).toEqual([])
  })

  test('preserves UTF-16 positions across emoji and repeated expressions', () => {
    const text = '😊お読みになられる。ご覧になられました。'
    const diagnostics = runSingleRule(ruleId, text, testConfig())
    expect(diagnostics).toHaveLength(2)
    expect(diagnostics.map((d) => [d.start, d.end])).toEqual([
      [text.indexOf('お読みになられる'), text.indexOf('お読みになられる') + 'お読みになられる'.length],
      [text.indexOf('ご覧になられました'), text.indexOf('ご覧になられました') + 'ご覧になられました'.length]
    ])
  })

  test('ignores masked Markdown code and detects ordinary prose', () => {
    const text = [
      '`お読みになられる`',
      '```ts',
      '// ご覧になられる',
      '```',
      'おっしゃられる。'
    ].join('\n')
    const diagnostics = runSingleRule(ruleId, text, testConfig())
    expect(diagnostics).toHaveLength(1)
    expect(text.slice(diagnostics[0]!.start, diagnostics[0]!.end)).toBe('おっしゃられる')
  })

  test('is registered as fast-tier; general/technical opt in, strict warns, minimal opts out', () => {
    const config = testConfig()
    const rule = buildRuleRegistry(config).get(ruleId)
    expect(rule).toBeDefined()
    expect(rule?.tier).toBe('fast')
    expect(getPreset('general')?.rules[ruleId]).toEqual({ enabled: true, severity: 'info' })
    expect(getPreset('technical')?.rules[ruleId]).toEqual({ enabled: true, severity: 'info' })
    expect(getPreset('strict')?.rules[ruleId]).toEqual({ enabled: true, severity: 'warning' })
    expect(getPreset('minimal')?.rules[ruleId]).toBeUndefined()
    const fast = runTier('お読みになられる。', config, 'fast')
    expect(fast.diagnostics.some((d) => d.ruleId === ruleId)).toBe(true)
    expect(fast.ruleErrors).toEqual([])
  })
})
