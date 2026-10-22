import { describe, expect, test } from 'vitest'
import { createDefaultConfig } from '../../src/core/config/validate'
import { listRuleManifests } from '../../src/core/rules/registry'
import type { AnalysisCatalog, AnalysisRuleManifestV1, ResolutionInput } from '../../src/core/analysis/contracts'
import { createDefaultAnalysisCatalog, resolveAnalysisRules, validateAnalysisCatalog } from '../../src/core/analysis/resolver'

const catalog = () => createDefaultAnalysisCatalog(listRuleManifests())
const input = (): ResolutionInput => ({
  manifestVersion: 1,
  ruleSettings: createDefaultConfig().rules,
  activeDocumentType: 'markdown',
  activeProviderId: null,
  readyProviderIds: new Set(['builtin', 'textlint']),
  runtimeCapabilities: new Set(),
  assetReadyIds: new Set(),
  nlpConsent: false
})
const clone = (value: AnalysisCatalog): AnalysisCatalog => structuredClone(value)
const decision = (state: AnalysisCatalog, options: ResolutionInput, id: string) =>
  resolveAnalysisRules(state, options).find(x => x.ruleId === id)

describe('AP-02: Pack registry compatibility', () => {
  test('assigns every builtin and textlint Rule to exactly one Pack without renaming', () => {
    const existing = listRuleManifests()
    const result = catalog()
    expect(result.packs.map(p => p.id)).toEqual(['core', 'grammar', 'dictionary', 'morphology', 'technical', 'style'])
    expect(result.rules).toHaveLength(existing.length)
    expect(new Set(result.rules.map(r => r.id)).size).toBe(existing.length)
    expect(new Set(result.rules.map(r => r.id))).toEqual(new Set(existing.map(m => m.id)))
    for (const rule of result.rules) {
      const original = existing.find(m => m.id === rule.id)!
      expect(rule).toMatchObject(original)
      expect(rule.execution).toBe('existing-' + original.tier)
      expect(rule.primaryPackId).not.toBe('morphology')
    }
    expect(result.rules.find(r => r.id === 'wording/common-typo')?.primaryPackId).toBe('dictionary')
    expect(result.rules.find(r => r.id === 'wording/double-honorific')?.primaryPackId).toBe('grammar')
    expect(result.rules.find(r => r.id === 'reference/undefined')?.primaryPackId).toBe('core')
  })

  test('default selection preserves per-rule v1 settings in deterministic Rule ID order', () => {
    const state = catalog()
    const actual = resolveAnalysisRules(state, input())
    expect(actual.map(r => r.ruleId)).toEqual([...actual.map(r => r.ruleId)].sort())
    expect(actual.filter(x => x.status === 'runnable').map(x => x.ruleId).sort())
      .toEqual(Object.entries(createDefaultConfig().rules).filter(([, setting]) => setting.enabled).map(([id]) => id).sort())
    expect(resolveAnalysisRules(state, input())).toEqual(actual)
  })

  test('core cannot be switched off; other Pack toggles do not mutate saved Rule settings', () => {
    const state = catalog()
    const before = input()
    const settings = structuredClone(before.ruleSettings)
    const result = resolveAnalysisRules(state, { ...before, packEnabled: { core: false, dictionary: false } })
    expect(result.find(r => r.ruleId === 'typography/brackets')?.status).toBe('runnable')
    expect(result.find(r => r.ruleId === 'wording/terminology')).toEqual({
      ruleId: 'wording/terminology', status: 'skipped', reason: 'pack-disabled'
    })
    expect(before.ruleSettings).toEqual(settings)
  })

  test('Rule disabled has precedence over an enabled Pack', () => {
    const state = catalog()
    const original = input()
    const settings = { ...original.ruleSettings, 'wording/common-typo': { enabled: false } }
    expect(decision(state, { ...original, ruleSettings: settings }, 'wording/common-typo'))
      .toEqual({ ruleId: 'wording/common-typo', status: 'skipped', reason: 'rule-disabled' })
  })

  test('unready textlint adapter is distinct from a successful clean analysis', () => {
    const state = catalog()
    const original = input()
    expect(decision(state, { ...original, readyProviderIds: new Set(['builtin']) }, 'typography/nfd'))
      .toEqual({ ruleId: 'typography/nfd', status: 'skipped', reason: 'provider-not-ready' })
  })

  test('rejects catalog drift, duplicate IDs, and unknown Pack settings', () => {
    const existing = listRuleManifests()
    expect(() => createDefaultAnalysisCatalog(existing.slice(1))).toThrow('ownership drift')
    expect(() => createDefaultAnalysisCatalog([...existing, existing[0]!])).toThrow('ownership drift')
    expect(() => resolveAnalysisRules(catalog(), { ...input(), packEnabled: { bogus: true } as never }))
      .toThrow('Unknown Pack')
  })
})

describe('AP-02: invalid configuration and NLP capability gating', () => {
  test('rejects duplicate packs, missing dependencies and dependency cycles', () => {
    const base = catalog()
    expect(() => validateAnalysisCatalog({ ...base, packs: [...base.packs, base.packs[0]!] }))
      .toThrow('Duplicate pack ID')
    const missing = clone(base)
    ;(missing.packs.find(p => p.id === 'grammar') as { dependencyPackIds: string[] }).dependencyPackIds = ['missing']
    expect(() => validateAnalysisCatalog(missing)).toThrow('Missing Pack dependency')
    const cyclic = clone(base)
    ;(cyclic.packs.find(p => p.id === 'grammar') as { dependencyPackIds: string[] }).dependencyPackIds = ['style']
    ;(cyclic.packs.find(p => p.id === 'style') as { dependencyPackIds: string[] }).dependencyPackIds = ['grammar']
    expect(() => validateAnalysisCatalog(cyclic)).toThrow('cycle')
  })

  test('rejects duplicate Providers, unregistered Providers and unsupported capabilities', () => {
    const base = catalog()
    expect(() => validateAnalysisCatalog({ ...base, providers: [...base.providers, base.providers[0]!] }))
      .toThrow('Duplicate provider ID')
    const unknown = clone(base)
    ;(unknown.rules[0] as { providerId: string }).providerId = 'missing'
    expect(() => validateAnalysisCatalog(unknown)).toThrow('Invalid analysis rule manifest')
    const mismatch = clone(base)
    ;(mismatch.rules[0] as { capabilitiesRequired: string[] }).capabilitiesRequired = ['pos']
    expect(() => validateAnalysisCatalog(mismatch)).toThrow('lacks declared capability')
  })

  test('NLP requires consent, morphology, ready assets and actual runtime capabilities', () => {
    const base = catalog()
    const descriptor = {
      id: 'lindera-ipadic', implementationVersion: '6.2.0', capabilities: ['tokenize', 'pos'] as const,
      needsAssets: ['ipadic@6.2.0'], networkPolicy: 'explicit-download' as const,
      executionContext: 'nlp-worker' as const, supportedDocTypes: ['markdown', 'text'] as const
    }
    const rule: AnalysisRuleManifestV1 = {
      ...base.rules[0]!, id: 'grammar/pos-test', providerId: 'lindera-ipadic', primaryPackId: 'grammar',
      metadataVersion: 1, execution: 'nlp', capabilitiesRequired: ['pos'], supportedDocTypes: ['markdown']
    }
    const state: AnalysisCatalog = { ...base, providers: [...base.providers, descriptor], rules: [...base.rules, rule] }
    const original = input()
    const common = {
      ...original, ruleSettings: { ...original.ruleSettings, 'grammar/pos-test': { enabled: true } },
      activeProviderId: 'lindera-ipadic', readyProviderIds: new Set(['builtin', 'textlint', 'lindera-ipadic'])
    }
    expect(decision(state, common, rule.id)).toMatchObject({ reason: 'consent-required' })
    expect(decision(state, { ...common, nlpConsent: true }, rule.id))
      .toMatchObject({ reason: 'provider-disabled' })
    const enabled = { ...common, nlpConsent: true, packEnabled: { morphology: true } }
    expect(decision(state, enabled, rule.id)).toMatchObject({ reason: 'asset-not-ready' })
    const assets = { ...enabled, assetReadyIds: new Set(['ipadic@6.2.0']) }
    expect(decision(state, assets, rule.id)).toMatchObject({ reason: 'capability-missing' })
    expect(decision(state, { ...assets, runtimeCapabilities: new Set(['pos' as const]) }, rule.id))
      .toEqual({ ruleId: rule.id, status: 'runnable', providerId: 'lindera-ipadic' })
    expect(decision(state, { ...assets, activeDocumentType: 'text' }, rule.id))
      .toMatchObject({ reason: 'unsupported-doctype' })
  })
})
