import { describe, expect, test } from 'vitest'
import { getPreset } from '../../src/core/config/presets'
import { buildRuleRegistry } from '../../src/core/rules/registry'
import { runSingleRule, runTier, testConfig } from '../helpers'

const ruleId = 'style/cross-paragraph-tone'
const check = (text: string) => runSingleRule(ruleId, text, testConfig())

describe('cross-paragraph tone consistency', () => {
  test('highlights one plain-style minority paragraph among two polite-style paragraphs', () => {
    const source = '本日は晴れです。\n\n明日も晴れます。\n\n😊昨日は雨だ。'
    const results = check(source)
    expect(results).toHaveLength(1)
    expect(results[0]?.start).toBe(source.lastIndexOf('だ。'))
    expect(source.slice(results[0]!.start, results[0]!.end)).toBe('だ')
    expect(results[0]?.message).toContain('ですます調')
    expect(results[0]?.fixKind).toBe('none')
    expect(results[0]?.replacement).toBeUndefined()
  })

  test('highlights polite-style minority among plain-style paragraphs', () => {
    const source = 'これは基準である。\n\n規則は明確だ。\n\n説明します。'
    const results = check(source)
    expect(results).toHaveLength(1)
    expect(source.slice(results[0]!.start, results[0]!.end)).toBe('ます')
  })

  test('does not report ties, consistent prose, or a lone paragraph', () => {
    expect(check('今日は晴れです。\n\n昨日は雨だ。')).toEqual([])
    expect(check('今日は晴れです。\n\n明日も晴れます。\n\n来週も晴れでしょう。')).toEqual([])
    expect(check('今日は晴れです。昨日は雨だ。')).toEqual([])
  })

  test('ignores paragraphs containing both styles to avoid duplicate mixed-tone diagnostics', () => {
    const source = 'これは正しいです。\n\nこちらも正しいです。\n\nこれは誤りだ。しかし説明します。'
    expect(check(source)).toEqual([])
    expect(runSingleRule('style/mixed-tone', source, testConfig()).length).toBeGreaterThan(0)
  })

  test('does not compare prose across Markdown heading sections', () => {
    const source = '# 敬体の節\n今日は晴れです。\n\n明日も晴れます。\n\n# 常体の節\n昨日は雨だ。'
    expect(check(source)).toEqual([])
  })

  test('ignores blockquotes, lists, tables, code fences and inline quotations', () => {
    const source = [
      '今日は晴れです。',
      '',
      '明日も晴れます。',
      '',
      '> 昨日は雨だ。',
      '',
      '- 昨日は雨だ。',
      '',
      '| 昨日は雨だ。 |',
      '',
      '```text',
      '昨日は雨だ。',
      '```',
      '',
      '「昨日は雨だ。」と説明します。',
      '',
      '同じように説明します。'
    ].join('\n')
    expect(check(source)).toEqual([])
  })

  test('ignores masked code/URLs while detecting normal prose', () => {
    const source = '今日は晴れです。\n\n明日も晴れます。\n\n`昨日は雨だ。` 昨日は雨だ。'
    const results = check(source)
    expect(results).toHaveLength(1)
    expect(results[0]?.start).toBe(source.lastIndexOf('だ。'))
  })

  test('registers an idle rule with conservative built-in preset severity and no safe fix', () => {
    const rule = buildRuleRegistry(testConfig()).get(ruleId)
    expect(rule?.tier).toBe('idle')
    expect(getPreset('general')?.rules[ruleId]).toEqual({ enabled: true, severity: 'info' })
    expect(getPreset('technical')?.rules[ruleId]).toEqual({ enabled: true, severity: 'info' })
    expect(getPreset('strict')?.rules[ruleId]).toEqual({ enabled: true, severity: 'warning' })
    expect(getPreset('minimal')?.rules[ruleId]).toBeUndefined()
    const result = runTier('今日は晴れです。\n\n明日も晴れます。\n\n昨日は雨だ。', testConfig(), 'idle')
    expect(result.diagnostics.some((diagnostic) => diagnostic.ruleId === ruleId)).toBe(true)
    expect(result.ruleErrors).toEqual([])
  })
})
