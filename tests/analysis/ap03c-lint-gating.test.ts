import { describe, expect, test } from 'vitest'
import { createDefaultConfig } from '../../src/core/config/validate'
import { configForEnabledAnalysisPacks } from '../../src/core/analysis/lint-config'
import { runOwnRules } from '../../src/core/engine/engine'
import { formatDocument } from '../../src/core/formatter/formatter'

describe('AP-03c effective runtime Pack gates', () => {
  function enabledConfig() {
    const config = createDefaultConfig()
    config.rules['wording/common-typo'] = { enabled: true, severity: 'warning' }
    config.rules['wording/terminology'] = { enabled: true, severity: 'error' }
    config.rules['wording/ng-word'] = { enabled: true, severity: 'error' }
    config.ngWords = [{ id: 'ng1', word: '禁止', severity: 'error' }]
    return config
  }

  test('disabling Dictionary turns off all owned Rules without modifying the source', () => {
    const config = enabledConfig()
    const original = structuredClone(config)
    config.analysis.packs.dictionary = false
    const gated = configForEnabledAnalysisPacks(config)
    expect(gated).not.toBe(config)
    expect(gated.rules).not.toBe(config.rules)
    for (const id of ['wording/common-typo', 'wording/terminology', 'wording/ng-word']) {
      expect(config.rules[id]!.enabled).toBe(true)
      expect(gated.rules[id]).toEqual({ ...config.rules[id], enabled: false })
      expect(gated.rules[id]).not.toBe(config.rules[id])
    }
    expect(gated.rules['wording/terminology']!.severity).toBe('error')
    expect(gated.rules['typography/full-width-space']).toBe(config.rules['typography/full-width-space'])
    expect(config.analysis.packs.dictionary).toBe(false)
    expect({ ...config, analysis: original.analysis }).toEqual(original)
  })

  test('real Fast Lint and Formatter receive no Dictionary diagnostics when Pack is OFF', () => {
    const config = enabledConfig()
    const source = 'コミニュケーションと禁止を確認します。Github と表記します。'
    const enabled = runOwnRules(source, config, 'fast', 'text')
    expect(enabled.diagnostics.some(x => x.ruleId === 'wording/common-typo')).toBe(true)
    expect(enabled.diagnostics.some(x => x.ruleId === 'wording/ng-word')).toBe(true)
    expect(enabled.diagnostics.some(x => x.ruleId === 'wording/terminology')).toBe(true)

    config.analysis.packs.dictionary = false
    const gated = runOwnRules(source, configForEnabledAnalysisPacks(config), 'fast', 'text')
    const dict = new Set(['wording/common-typo', 'wording/ng-word', 'wording/terminology'])
    expect(gated.diagnostics.filter(x => dict.has(x.ruleId))).toEqual([])
    expect(formatDocument(source, gated.diagnostics).appliedFixes.every(x => !dict.has(x.ruleId))).toBe(true)
    expect(gated.ruleErrors).toEqual([])
  })

  test('enabled Pack is a no-op and an already-disabled rule stays disabled', () => {
    const config = enabledConfig()
    expect(configForEnabledAnalysisPacks(config)).toBe(config)
    config.rules['wording/ng-word'] = { enabled: false, severity: 'error' }
    config.analysis.packs.dictionary = false
    const effective = configForEnabledAnalysisPacks(config)
    expect(effective.rules['wording/ng-word']).toBe(config.rules['wording/ng-word'])
    expect(effective.rules['wording/common-typo']!.enabled).toBe(false)
  })

  test('required core rules remain runnable even when invalid caller flags disable core', () => {
    const config = enabledConfig()
    config.analysis.packs.core = false
    config.rules['typography/full-width-space'] = { enabled: true, severity: 'warning' }
    config.analysis.packs.dictionary = false
    const gated = configForEnabledAnalysisPacks(config)
    expect(gated.rules['typography/full-width-space']!.enabled).toBe(true)
    const output = runOwnRules('これは　文章です。', gated, 'fast', 'text')
    expect(output.diagnostics.some(x => x.ruleId === 'typography/full-width-space')).toBe(true)
  })

  test('Pack metadata is not a persisted rule-setting mutation', () => {
    const config = enabledConfig()
    const sourceSettings = structuredClone(config.rules)
    config.analysis.packs.dictionary = false
    configForEnabledAnalysisPacks(config)
    config.analysis.packs.dictionary = true
    expect(config.rules).toEqual(sourceSettings)
    const result = runOwnRules('コミニュケーションです。', config, 'fast', 'text')
    expect(result.diagnostics.some(x => x.ruleId === 'wording/common-typo')).toBe(true)
  })
})
