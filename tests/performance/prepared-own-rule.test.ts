import { describe, expect, test } from 'vitest'
import { createDefaultConfig } from '../../src/core/config/validate'
import {
  prepareOwnRuleExecution,
  runOwnRules
} from '../../src/core/engine/engine'
import { createWorkload } from './workloads'

const Tiers = ['fast', 'deep', 'idle'] as const

describe('prepared own-rule execution (within one Worker lint request)', () => {
  test.each([
    '📊報告します。色々試します。資料をを確認します。',
    '# 仕様\n\n`色々` の表記です。\n> 引用です。\n\n予約をすることができます。',
    '「まず最初に」と『ご確認してください』は例示です。本文は行ないます。',
    createWorkload('repetition', 10_000),
    createWorkload('markdown', 10_000)
  ])('produces exactly the same diagnostics/errors as independent tier runs', text => {
    const config = createDefaultConfig()
    const prepared = prepareOwnRuleExecution(text, config)
    expect(prepared.context.text).toBe(text)
    expect(prepared.context.maskedText.length).toBe(text.length)
    expect(prepared.lineIndex).toBeDefined()

    for (const tier of Tiers) {
      const independent = runOwnRules(text, config, tier, 'markdown')
      const shared = runOwnRules(text, config, tier, 'markdown', prepared)
      expect(shared.diagnostics).toEqual(independent.diagnostics)
      expect(shared.ruleErrors).toEqual(independent.ruleErrors)
      expect(shared.durationMs).toBeGreaterThanOrEqual(0)
    }
  })

  test('preserves text mode, UTF-16 offsets and standalone API compatibility', () => {
    const text = '🌸ご確認してください。デバックをを確認します。'
    const config = createDefaultConfig()
    const plan = prepareOwnRuleExecution(text, config)
    for (const tier of Tiers) {
      expect(runOwnRules(text, config, tier, 'text', plan).diagnostics)
        .toEqual(runOwnRules(text, config, tier, 'text').diagnostics)
    }
  })

  test('rejects a plan from another revision or a different configuration instance', () => {
    const first = '行ないます。'
    const changed = '📚行ないます。'
    const config = createDefaultConfig()
    const plan = prepareOwnRuleExecution(first, config)
    expect(() => runOwnRules(changed, config, 'fast', 'markdown', plan))
      .toThrow('Prepared analysis does not match')
    const nextConfig = structuredClone(config)
    expect(() => runOwnRules(first, nextConfig, 'fast', 'markdown', plan))
      .toThrow('Prepared analysis does not match')
  })

  test('reuses a prepared context only within its owning request', () => {
    const text = createWorkload('prose', 1000)
    const config = createDefaultConfig()
    const first = prepareOwnRuleExecution(text, config)
    const second = prepareOwnRuleExecution(text, config)
    expect(first).not.toBe(second)
    expect(first.context).not.toBe(second.context)
    expect(first.lineIndex).not.toBe(second.lineIndex)
  })
})
