import { describe, expect, test } from 'vitest'
import { createDefaultConfig } from '../../src/core/config/validate'
import { runnableLegacyBuiltinRuleIds } from '../../src/core/analysis/legacy-runtime-gate'
import { prepareOwnRuleExecution, runOwnRules } from '../../src/core/engine/engine'
import { testConfig } from '../helpers'

const specimen = 'シュミレーションの確認です。 記載禁止 テストGithub。'
const restricted = ['wording/common-typo', 'wording/terminology', 'wording/ng-word']

function sampleConfig() {
  const config = testConfig()
  config.ngWords = [{ id: 'ng1', word: '記載禁止', severity: 'error' }]
  return config
}

function diagnostics(config: ReturnType<typeof sampleConfig>) {
  return runOwnRules(specimen, config, 'fast', 'markdown').diagnostics
}

describe('AP-03c initial Dictionary Pack runtime gate', () => {
  test('baseline with default packs matches explicitly enabled Dictionary Pack', () => {
    const defaults = sampleConfig()
    const explicitlyEnabled = sampleConfig()
    explicitlyEnabled.analysis = {
      ...explicitlyEnabled.analysis,
      packs: { ...explicitlyEnabled.analysis.packs, dictionary: true }
    }
    expect(diagnostics(defaults)).toEqual(diagnostics(explicitlyEnabled))
    const ids = diagnostics(defaults).map(x => x.ruleId)
    for (const id of restricted) expect(ids).toContain(id)
  })

  test('Dictionary Pack OFF suppresses all three owned rules but leaves Core diagnostics', () => {
    const config = sampleConfig()
    const before = diagnostics(config)
    config.analysis = {
      ...config.analysis,
      packs: { ...config.analysis.packs, dictionary: false }
    }
    const after = diagnostics(config)
    expect(after.filter(x => restricted.includes(x.ruleId))).toEqual([])
    expect(after.filter(x => !restricted.includes(x.ruleId)))
      .toEqual(before.filter(x => !restricted.includes(x.ruleId)))
    expect(config.rules['wording/common-typo']?.enabled).toBe(true)
    expect(config.rules['wording/ng-word']?.enabled).toBe(true)
    expect(config.rules['wording/terminology']?.enabled).toBe(true)
  })

  test('restoring Dictionary Pack does not overwrite individual Rule flags', () => {
    const config = sampleConfig()
    config.rules['wording/common-typo'] = { enabled: false, severity: 'error' }
    config.analysis = {
      ...config.analysis,
      packs: { ...config.analysis.packs, dictionary: false }
    }
    expect(diagnostics(config).some(x => restricted.includes(x.ruleId))).toBe(false)
    config.analysis = {
      ...config.analysis,
      packs: { ...config.analysis.packs, dictionary: true }
    }
    const ids = diagnostics(config).map(x => x.ruleId)
    expect(ids).not.toContain('wording/common-typo')
    expect(ids).toContain('wording/ng-word')
    expect(ids).toContain('wording/terminology')
    expect(config.rules['wording/common-typo']).toEqual({ enabled: false, severity: 'error' })
  })

  test('core cannot be disabled; metadata-only packs do not yet gate legacy rules', () => {
    const config = sampleConfig()
    const base = runnableLegacyBuiltinRuleIds(config, 'markdown')
    config.analysis = {
      ...config.analysis,
      packs: {
        ...config.analysis.packs,
        core: false,
        grammar: false,
        style: false,
        morphology: false,
        technical: false
      }
    }
    const selected = runnableLegacyBuiltinRuleIds(config, 'markdown')
    expect([...selected].sort()).toEqual([...base].sort())
    expect(selected.has('typography/full-width-space')).toBe(true)
    expect(selected.has('wording/common-typo')).toBe(true)
  })

  test('a cached PreparedOwnRuleExecution still obeys the same request config', () => {
    const original = sampleConfig()
    const prepared = prepareOwnRuleExecution(specimen, original)
    const before = runOwnRules(specimen, original, 'fast', 'markdown', prepared)
    expect(before.diagnostics.map(x => x.ruleId)).toContain('wording/common-typo')
    const switched = sampleConfig()
    switched.analysis = {
      ...switched.analysis, packs: { ...switched.analysis.packs, dictionary: false }
    }
    // Reusing another Profile's prepared snapshot must fail, not leak diagnostics.
    expect(() => runOwnRules(specimen, switched, 'fast', 'markdown', prepared))
      .toThrow(/Prepared analysis does not match/)
  })

  test('default AppConfig keeps legacy rule execution compatible', () => {
    const config = createDefaultConfig()
    const runnable = runnableLegacyBuiltinRuleIds(config, 'markdown')
    expect(runnable.has('wording/common-typo')).toBe(true)
    expect(runnable.has('wording/terminology')).toBe(true)
    expect(runnable.has('wording/ng-word')).toBe(false) // user NG rule is absent in General preset
  })
})
