import { describe, expect, test } from 'vitest'
import type {
  AnalysisCatalog, AnalysisResolutionInput, AnalysisPackId
} from '../../src/core/analysis/contracts'
import { createAnalysisResolver } from '../../src/core/analysis/resolver'
import { buildLegacyAnalysisCatalog } from '../../src/core/analysis/packs'
import { listRuleManifests } from '../../src/core/rules/registry'
import { runSingleRule, testConfig } from '../helpers'

const allEnabled: Record<AnalysisPackId, boolean> = {
  core: true, grammar: true, dictionary: true,
  morphology: true, technical: true, style: true
}

function sampleCatalog(): AnalysisCatalog {
  return {
    packs: [
      {
        id: 'core', label: 'Core', required: true,
        defaultEnabledOnFreshInstall: true, declaredRuleIds: ['wording/known-rule'],
        capabilitiesProvided: [], dependencyPackIds: [], manifestVersion: 1
      },
      {
        id: 'grammar', label: 'Grammar', required: false,
        defaultEnabledOnFreshInstall: false, declaredRuleIds: ['wording/experimental'],
        capabilitiesProvided: [], dependencyPackIds: ['core'], manifestVersion: 1
      },
      {
        id: 'morphology', label: 'Morphology', required: false,
        defaultEnabledOnFreshInstall: false, declaredRuleIds: [],
        capabilitiesProvided: ['pos'], dependencyPackIds: ['core'], manifestVersion: 1
      }
    ],
    providers: [
      {
        id: 'builtin', implementationVersion: 'legacy',
        capabilities: [], needsAssets: [], networkPolicy: 'never',
        executionContext: 'analysis-worker', supportedDocTypes: ['text', 'markdown']
      },
      {
        id: 'lindera-ipadic', implementationVersion: 'poc-1',
        capabilities: ['pos'], needsAssets: ['ja-ipadic-v1'],
        networkPolicy: 'explicit-download', executionContext: 'nlp-worker',
        supportedDocTypes: ['text', 'markdown']
      }
    ],
    rules: [
      {
        id: 'wording/known-rule', primaryPackId: 'core', providerId: 'builtin',
        execution: 'existing-fast', capabilitiesRequired: [],
        supportedDocTypes: ['text', 'markdown'], enabledByDefault: true,
        diagnosticIssueFamily: null, fixKindCeiling: 'safe', metadataVersion: 1
      },
      {
        id: 'wording/experimental', primaryPackId: 'grammar',
        providerId: 'lindera-ipadic', execution: 'nlp',
        capabilitiesRequired: ['pos'], supportedDocTypes: ['markdown'],
        enabledByDefault: false, diagnosticIssueFamily: null,
        fixKindCeiling: 'suggestion', metadataVersion: 1
      }
    ]
  }
}

function options(): AnalysisResolutionInput {
  return {
    manifestVersion: 1,
    packEnabled: { ...allEnabled, core: false },
    ruleSettings: {},
    activeDocumentType: 'markdown',
    activeProviderId: 'lindera-ipadic',
    runtimeCapabilities: new Set(['pos']),
    assetReadyIds: new Set(['ja-ipadic-v1']),
    readyProviderIds: new Set(['lindera-ipadic']),
    policy: { nlpConsent: true, privateSession: true }
  }
}

const resultOf = (value: AnalysisResolutionInput) =>
  createAnalysisResolver(sampleCatalog()).resolve(value).find(x => x.ruleId === 'wording/experimental')

describe('AP-02 analysis pack manifest and rule resolution', () => {
  test('covers every existing rule exactly once without affecting legacy lint', () => {
    const catalog = buildLegacyAnalysisCatalog()
    const resolver = createAnalysisResolver(catalog)
    const legacyIds = listRuleManifests().map(x => x.id).sort()
    expect(catalog.rules.map(x => x.id).sort()).toEqual(legacyIds)
    expect(catalog.rules.filter(x => x.primaryPackId === 'dictionary').map(x => x.id).sort())
      .toEqual(['wording/common-typo', 'wording/ng-word', 'wording/terminology'])
    const input: AnalysisResolutionInput = {
      ...options(), activeProviderId: null, readyProviderIds: new Set(),
      packEnabled: allEnabled, policy: { nlpConsent: false, privateSession: true },
      runtimeCapabilities: new Set(), assetReadyIds: new Set()
    }
    const results = resolver.resolve(input)
    expect(results).toHaveLength(legacyIds.length)
    expect(results.map(x => x.ruleId)).toEqual(legacyIds)
    expect(results.every(x => x.status === 'runnable')).toBe(true)
    // Pure metadata resolution does not change existing diagnostics and fixes.
    const source = 'シュミレーションを確認しました。'
    const before = runSingleRule('wording/common-typo', source, testConfig())
    resolver.resolve(input)
    expect(runSingleRule('wording/common-typo', source, testConfig())).toEqual(before)
  })

  test('always enables core and closes declared pack dependencies without mutating flags', () => {
    const resolver = createAnalysisResolver(sampleCatalog())
    const flags = Object.freeze({ ...allEnabled, core: false, grammar: true, morphology: false })
    const active = resolver.effectivePacks(flags)
    expect(active.core).toBe(true)
    expect(active.grammar).toBe(true)
    expect(active.morphology).toBe(false)
    expect(flags.core).toBe(false)
    expect(Object.isFrozen(active)).toBe(true)
  })

  test('returns stable sorted output and explicit skipped reasons in priority order', () => {
    const resolver = createAnalysisResolver(sampleCatalog())
    const baseline = options()
    expect(resolver.resolve(baseline)).toEqual([
      { status: 'runnable', ruleId: 'wording/experimental', providerId: 'lindera-ipadic' },
      { status: 'runnable', ruleId: 'wording/known-rule', providerId: 'builtin' }
    ])
    const packOff = { ...baseline, packEnabled: { ...baseline.packEnabled, grammar: false } }
    expect(resultOf(packOff)).toEqual({
      status: 'skipped', ruleId: 'wording/experimental', reason: 'pack-disabled'
    })
    const ruleOff = { ...baseline, ruleSettings: { 'wording/experimental': { enabled: false } } }
    expect(resultOf(ruleOff)).toMatchObject({ status: 'skipped', reason: 'rule-disabled' })
    expect(resultOf({ ...ruleOff, activeDocumentType: 'text' }))
      .toMatchObject({ reason: 'rule-disabled' })
    expect(resultOf({ ...baseline, activeDocumentType: 'text' }))
      .toMatchObject({ reason: 'unsupported-doctype' })
    expect(resultOf({ ...baseline, policy: { nlpConsent: false, privateSession: false } }))
      .toMatchObject({ reason: 'consent-required' })
    expect(resultOf({ ...baseline, activeProviderId: null }))
      .toMatchObject({ reason: 'provider-disabled' })
    expect(resultOf({ ...baseline, packEnabled: { ...baseline.packEnabled, morphology: false } }))
      .toMatchObject({ reason: 'provider-disabled' })
    expect(resultOf({ ...baseline, failedProviderIds: new Set(['lindera-ipadic']) }))
      .toMatchObject({ reason: 'runtime-failed' })
    expect(resultOf({ ...baseline, readyProviderIds: new Set() }))
      .toMatchObject({ reason: 'provider-not-ready' })
    expect(resultOf({ ...baseline, assetReadyIds: new Set() }))
      .toMatchObject({ reason: 'asset-not-ready' })
    expect(resultOf({ ...baseline, runtimeCapabilities: new Set() }))
      .toMatchObject({ reason: 'capability-missing' })
  })

  test('rejects duplicate pack/provider/rule identities and invalid ownership', () => {
    const initial = sampleCatalog()
    const cases: AnalysisCatalog[] = [
      { ...initial, packs: [...initial.packs, initial.packs[0]!] },
      { ...initial, providers: [...initial.providers, initial.providers[0]!] },
      { ...initial, rules: [...initial.rules, initial.rules[0]!] },
      { ...initial, packs: initial.packs.map(p =>
        p.id === 'grammar' ? { ...p, declaredRuleIds: [] } : p) },
      { ...initial, packs: initial.packs.map(p =>
        p.id === 'core' ? { ...p, declaredRuleIds: [...p.declaredRuleIds, 'wording/experimental'] } : p) }
    ]
    for (const item of cases) expect(() => createAnalysisResolver(item)).toThrow()
  })

  test('rejects cycles, dangling dependencies and missing required core', () => {
    const base = sampleCatalog()
    for (const mutate of [
      (p: AnalysisCatalog['packs'][number]) =>
        p.id === 'core' ? { ...p, dependencyPackIds: ['grammar' as const] } : p,
      (p: AnalysisCatalog['packs'][number]) =>
        p.id === 'grammar' ? { ...p, dependencyPackIds: ['technical' as const] } : p,
      (p: AnalysisCatalog['packs'][number]) =>
        p.id === 'core' ? { ...p, required: false } : p
    ]) expect(() => createAnalysisResolver({ ...base, packs: base.packs.map(mutate) })).toThrow()
  })

  test('refuses unsafe NLP Fix, undeclared capability, provider mismatch and bogus rule ID', () => {
    const base = sampleCatalog()
    const transform = [
      (r: AnalysisCatalog['rules'][number]) => r.execution === 'nlp' ? { ...r, fixKindCeiling: 'safe' as const } : r,
      (r: AnalysisCatalog['rules'][number]) => r.execution === 'nlp' ? { ...r, capabilitiesRequired: ['reading' as const] } : r,
      (r: AnalysisCatalog['rules'][number]) => r.execution === 'nlp' ? { ...r, providerId: 'builtin' as const } : r,
      (r: AnalysisCatalog['rules'][number]) => r.execution === 'nlp' ? { ...r, id: 'BAD-ID' } : r
    ]
    for (const mutate of transform) expect(() => createAnalysisResolver({
      ...base, rules: base.rules.map(mutate)
    })).toThrow()
  })

  test('rejects an unknown selected provider and unsupported version without network side effects', () => {
    const resolver = createAnalysisResolver(sampleCatalog())
    expect(() => resolver.resolve({
      ...options(), activeProviderId: 'missing' as AnalysisResolutionInput['activeProviderId']
    })).toThrow()
    expect(() => resolver.resolve({ ...options(), manifestVersion: 2 as 1 })).toThrow()
  })
})
