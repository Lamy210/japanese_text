import { describe, expect, test } from 'vitest'
import { createDefaultConfig } from '../../src/core/config/validate'
import { listRuleManifests } from '../../src/core/rules/registry'
import type {
  AnalysisCapability, AnalysisProviderId, AnalysisResolutionInput,
  AnalysisRuleManifestV1, AnalysisPackId, ProviderDescriptorV1
} from '../../src/core/analysis/contracts'
import { createLegacyAnalysisCatalog, defaultAnalysisPackSelection } from '../../src/core/analysis/packs'
import { compileAnalysisCatalog, resolveAnalysisRules } from '../../src/core/analysis/resolver'

const baseline = createLegacyAnalysisCatalog()

function input(overrides: Partial<AnalysisResolutionInput> = {}): AnalysisResolutionInput {
  return {
    manifestVersion: 1,
    packEnabled: defaultAnalysisPackSelection(),
    ruleSettings: createDefaultConfig().rules,
    activeDocumentType: 'markdown',
    activeProviderId: null,
    runtimeCapabilities: new Set<AnalysisCapability>(),
    assetReadyIds: new Set<string>(),
    readyProviderIds: new Set<AnalysisProviderId>(),
    policy: { nlpConsent: false, privateSession: true },
    ...overrides
  }
}

function resolve(ruleId: string, options: Partial<AnalysisResolutionInput> = {}) {
  return resolveAnalysisRules(baseline, input(options)).find(result => result.ruleId === ruleId)
}

describe('AP-02 metadata contracts and legacy compatibility', () => {
  test('declares each existing rule exactly once without changing any ID', () => {
    const ruleIds = baseline.rules.map(rule => rule.id)
    expect([...ruleIds].sort()).toEqual(listRuleManifests().map(rule => rule.id).sort())
    expect(new Set(ruleIds).size).toBe(ruleIds.length)
    expect(baseline.packs.find(pack => pack.id === 'core')?.required).toBe(true)
    expect(baseline.rules.find(rule => rule.id === 'wording/common-typo')?.primaryPackId).toBe('dictionary')
    expect(baseline.rules.find(rule => rule.id === 'wording/terminology')?.primaryPackId).toBe('dictionary')
    expect(baseline.providers.map(x => x.id).sort()).toEqual(['builtin', 'textlint'])
    expect(Object.isFrozen(baseline.rules)).toBe(true)
    expect(Object.isFrozen(baseline.packs[0]?.declaredRuleIds)).toBe(true)
  })

  test('PACK-001: core is always enabled despite a disabled Profile flag', () => {
    const config = createDefaultConfig()
    const coreId = baseline.rules.find(rule => rule.primaryPackId === 'core' &&
      config.rules[rule.id]?.enabled)?.id
    expect(coreId).toBeDefined()
    const result = resolve(coreId!, {
      packEnabled: { ...defaultAnalysisPackSelection(), core: false }
    })
    expect(result).toMatchObject({ status: 'runnable', ruleId: coreId })
  })

  test('PACK-003/004: pack gating does not modify per-rule enabled flags', () => {
    const settings = structuredClone(createDefaultConfig().rules)
    settings['wording/common-typo'] = { enabled: true, severity: 'info' }
    const enabled = { ...defaultAnalysisPackSelection(), dictionary: false }
    const off = resolve('wording/common-typo', { packEnabled: enabled, ruleSettings: settings })
    expect(off).toEqual({ status: 'skipped', ruleId: 'wording/common-typo', reason: 'pack-disabled' })
    enabled.dictionary = true
    const on = resolve('wording/common-typo', { packEnabled: enabled, ruleSettings: settings })
    expect(on).toEqual({ status: 'runnable', ruleId: 'wording/common-typo', providerId: 'builtin' })
    expect(settings['wording/common-typo']).toMatchObject({ enabled: true, severity: 'info' })
    settings['wording/common-typo']!.enabled = false
    expect(resolve('wording/common-typo', { packEnabled: enabled, ruleSettings: settings }))
      .toMatchObject({ reason: 'rule-disabled' })
  })

  test('resolution is deterministic and sorted by rule ID', () => {
    const first = resolveAnalysisRules(baseline, input())
    const second = resolveAnalysisRules(baseline, input())
    expect(second).toEqual(first)
    expect(first.map(r => r.ruleId)).toEqual([...first.map(r => r.ruleId)].sort())
    expect(first).toHaveLength(baseline.rules.length)
  })

  test('does not start newly introduced rules when Profile settings are absent', () => {
    expect(resolve('wording/common-typo', { ruleSettings: {} }))
      .toEqual({ status: 'skipped', ruleId: 'wording/common-typo', reason: 'rule-disabled' })
  })

  test('PACK-005/007: rejects duplicates, missing references and cycles', () => {
    const core = baseline.packs.find(p => p.id === 'core')!
    const grammar = baseline.packs.find(p => p.id === 'grammar')!
    expect(() => compileAnalysisCatalog({
      ...baseline, packs: [...baseline.packs, core]
    })).toThrow('Duplicate analysis pack ID')
    expect(() => compileAnalysisCatalog({
      ...baseline, providers: [...baseline.providers, baseline.providers[0]!]
    })).toThrow('Duplicate analysis provider ID')
    expect(() => compileAnalysisCatalog({
      ...baseline, rules: [...baseline.rules, baseline.rules[0]!]
    })).toThrow('Duplicate analysis rule ID')
    expect(() => compileAnalysisCatalog({
      ...baseline,
      packs: baseline.packs.map(p => p.id === 'core' ? { ...p, dependencyPackIds: ['dictionary' as AnalysisPackId] } : p)
    })).toThrow('Circular analysis pack dependency')
    expect(() => compileAnalysisCatalog({
      ...baseline,
      packs: baseline.packs.map(p => p.id === 'grammar' ? { ...p, dependencyPackIds: ['missing' as AnalysisPackId] } : p)
    })).toThrow()
    expect(() => compileAnalysisCatalog({
      ...baseline,
      packs: baseline.packs.map(p => p.id === 'grammar' ? { ...p, declaredRuleIds: ['style/fictional'] } : p)
    })).toThrow('Declared rule')
    expect(() => compileAnalysisCatalog({
      ...baseline,
      packs: baseline.packs.map(p => p.id === grammar.id
        ? { ...p, manifestVersion: 2 as 1 } : p)
    })).toThrow('Invalid analysis pack')
  })

  test('catalog is cloned before use and provider mismatch is rejected', () => {
    const pack = baseline.packs.find(x => x.id === 'grammar')!
    const a = compileAnalysisCatalog(baseline)
    expect(a.rules).not.toBe(baseline.rules)
    expect(a.packs).not.toBe(baseline.packs)
    expect(() => compileAnalysisCatalog({
      ...baseline,
      providers: baseline.providers.filter(p => p.id !== 'textlint')
    })).toThrow('Unknown pack or provider')
    expect(() => compileAnalysisCatalog({
      ...baseline,
      packs: baseline.packs.map(p => p.id === pack.id ? { ...p, required: true } : p),
      rules: baseline.rules.map(rule => rule.id === 'wording/common-typo'
        ? { ...rule, execution: 'nlp' as const, fixKindCeiling: 'suggestion' as const } : rule)
    })).toThrow('Incompatible provider')
  })
})

function nlpFixture() {
  const candidate: AnalysisRuleManifestV1 = {
    metadataVersion: 1, id: 'grammar/check-pos', primaryPackId: 'grammar',
    providerId: 'lindera-ipadic', execution: 'nlp',
    capabilitiesRequired: ['pos'], supportedDocTypes: ['text'],
    enabledByDefault: true, diagnosticIssueFamily: null, fixKindCeiling: 'suggestion'
  }
  const provider: ProviderDescriptorV1 = {
    id: 'lindera-ipadic', implementationVersion: 'test', capabilities: ['pos'],
    needsAssets: ['ja-ipadic-test'], networkPolicy: 'explicit-download',
    executionContext: 'nlp-worker', supportedDocTypes: ['text']
  }
  return compileAnalysisCatalog({
    packs: baseline.packs.map(pack => pack.id === 'grammar'
      ? { ...pack, declaredRuleIds: [candidate.id] } : pack),
    rules: [...baseline.rules, candidate],
    providers: [...baseline.providers, provider]
  })
}

describe('AP-02 NLP readiness and consent precedence', () => {
  const catalog = nlpFixture()
  const base = {
    packEnabled: { ...defaultAnalysisPackSelection(), grammar: true, morphology: true },
    activeProviderId: 'lindera-ipadic' as const,
    activeDocumentType: 'text' as const,
    policy: { nlpConsent: true, privateSession: true }
  }
  const check = (options: Partial<AnalysisResolutionInput> = {}) =>
    resolveAnalysisRules(catalog, input({ ...base, ...options }))
      .find(x => x.ruleId === 'grammar/check-pos')

  test('PACK-002: grammar stays available without morphology; only NLP rule is gated', () => {
    expect(check({ packEnabled: { ...base.packEnabled, morphology: false } }))
      .toMatchObject({ status: 'skipped', reason: 'provider-disabled' })
    expect(resolve('wording/common-typo')).toMatchObject({ status: 'runnable' })
  })

  test('checks document type before consent, then provider, assets and capabilities', () => {
    expect(check({ activeDocumentType: 'markdown', policy: { nlpConsent: false, privateSession: true } }))
      .toMatchObject({ reason: 'unsupported-doctype' })
    expect(check({ policy: { nlpConsent: false, privateSession: true } }))
      .toMatchObject({ reason: 'consent-required' })
    expect(check({ activeProviderId: null })).toMatchObject({ reason: 'provider-disabled' })
    expect(check()).toMatchObject({ reason: 'provider-not-ready' })
    const ready = new Set<AnalysisProviderId>(['lindera-ipadic'])
    expect(check({ readyProviderIds: ready })).toMatchObject({ reason: 'asset-not-ready' })
    expect(check({ readyProviderIds: ready, assetReadyIds: new Set(['ja-ipadic-test']) }))
      .toMatchObject({ reason: 'capability-missing' })
    expect(check({
      readyProviderIds: ready, assetReadyIds: new Set(['ja-ipadic-test']),
      runtimeCapabilities: new Set<AnalysisCapability>(['pos'])
    })).toEqual({ status: 'runnable', ruleId: 'grammar/check-pos', providerId: 'lindera-ipadic' })
  })

  test('runtime failure is not misreported as no diagnostics', () => {
    expect(check({
      failedProviderIds: new Set<AnalysisProviderId>(['lindera-ipadic']),
      readyProviderIds: new Set<AnalysisProviderId>(['lindera-ipadic'])
    })).toEqual({ status: 'skipped', ruleId: 'grammar/check-pos', reason: 'runtime-failed' })
  })

  test('rejects impossible Provider capability declarations before runtime', () => {
    expect(() => compileAnalysisCatalog({
      ...catalog,
      rules: catalog.rules.map(rule => rule.id === 'grammar/check-pos'
        ? { ...rule, capabilitiesRequired: ['reading' as const] } : rule)
    })).toThrow('Provider lacks declared capability')

    // A valid descriptor alone must not count as runtime readiness.
    expect(check({
      readyProviderIds: new Set<AnalysisProviderId>(['lindera-ipadic']),
      assetReadyIds: new Set(['ja-ipadic-test']),
      runtimeCapabilities: new Set()
    })).toMatchObject({ status: 'skipped', reason: 'capability-missing' })
  })

  test('refuses unsupported NLP Safe Fix policy', () => {
    expect(() => compileAnalysisCatalog({
      ...catalog,
      rules: catalog.rules.map(rule => rule.id === 'grammar/check-pos'
        ? { ...rule, fixKindCeiling: 'safe' as const } : rule)
    })).toThrow('Invalid analysis rule')
  })
})
