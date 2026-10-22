import {
  ANALYSIS_CAPABILITIES, ANALYSIS_PACK_IDS, ANALYSIS_PROVIDER_IDS,
  type AnalysisCatalogV1, type AnalysisPackId, type AnalysisProviderId,
  type AnalysisResolutionInput, type AnalysisRuleManifestV1, type AnalysisRuleResolution,
  type PackManifestV1, type ProviderDescriptorV1
} from './contracts'

const PACKS = new Set<string>(ANALYSIS_PACK_IDS)
const PROVIDERS = new Set<string>(ANALYSIS_PROVIDER_IDS)
const CAPABILITIES = new Set<string>(ANALYSIS_CAPABILITIES)
const RULE_ID = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/u

function uniqueStrings(values: readonly string[], name: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${name}`)
}

function validatePack(pack: PackManifestV1): void {
  if (pack.manifestVersion !== 1 || !PACKS.has(pack.id) || !pack.label.trim() ||
      typeof pack.required !== 'boolean' ||
      typeof pack.defaultEnabledOnFreshInstall !== 'boolean' ||
      !Array.isArray(pack.declaredRuleIds) ||
      !Array.isArray(pack.capabilitiesProvided) ||
      !Array.isArray(pack.dependencyPackIds)) {
    throw new Error(`Invalid analysis pack: ${pack.id}`)
  }
  uniqueStrings(pack.declaredRuleIds, 'pack rule ID')
  uniqueStrings(pack.dependencyPackIds, 'pack dependency')
  uniqueStrings(pack.capabilitiesProvided, 'pack capability')
  if (pack.declaredRuleIds.some(id => !RULE_ID.test(id)) ||
      pack.dependencyPackIds.some(id => !PACKS.has(id)) ||
      pack.capabilitiesProvided.some(cap => !CAPABILITIES.has(cap))) {
    throw new Error(`Invalid declarations in pack: ${pack.id}`)
  }
}

function validateProvider(provider: ProviderDescriptorV1): void {
  if (!PROVIDERS.has(provider.id) || !provider.implementationVersion.trim() ||
      !['analysis-worker', 'nlp-worker'].includes(provider.executionContext) ||
      !['never', 'explicit-download'].includes(provider.networkPolicy) ||
      !Array.isArray(provider.capabilities) || !Array.isArray(provider.needsAssets) ||
      !Array.isArray(provider.supportedDocTypes) ||
      provider.supportedDocTypes.length === 0 ||
      provider.supportedDocTypes.some(doc => doc !== 'markdown' && doc !== 'text') ||
      provider.capabilities.some(cap => !CAPABILITIES.has(cap)) ||
      provider.needsAssets.some(id => typeof id !== 'string' || !id.trim())) {
    throw new Error(`Invalid analysis provider: ${provider.id}`)
  }
  uniqueStrings(provider.capabilities, 'provider capability')
  uniqueStrings(provider.needsAssets, 'provider asset')
  uniqueStrings(provider.supportedDocTypes, 'provider document type')
}

function validateRule(rule: AnalysisRuleManifestV1): void {
  if (rule.metadataVersion !== 1 || !RULE_ID.test(rule.id) ||
      !PACKS.has(rule.primaryPackId) || !PROVIDERS.has(rule.providerId) ||
      !['existing-fast', 'existing-deep', 'existing-idle', 'nlp'].includes(rule.execution) ||
      !Array.isArray(rule.capabilitiesRequired) || !Array.isArray(rule.supportedDocTypes) ||
      rule.supportedDocTypes.length === 0 ||
      rule.supportedDocTypes.some(doc => doc !== 'markdown' && doc !== 'text') ||
      rule.capabilitiesRequired.some(cap => !CAPABILITIES.has(cap)) ||
      typeof rule.enabledByDefault !== 'boolean' ||
      (rule.diagnosticIssueFamily !== null && !rule.diagnosticIssueFamily?.trim()) ||
      !['none', 'suggestion', 'safe'].includes(rule.fixKindCeiling) ||
      (rule.execution === 'nlp' && rule.fixKindCeiling === 'safe')) {
    throw new Error(`Invalid analysis rule: ${rule.id}`)
  }
  uniqueStrings(rule.capabilitiesRequired, 'rule capability')
  uniqueStrings(rule.supportedDocTypes, 'rule document type')
}

/**
 * Reject ambiguous metadata before any runtime work.
 * Copies inputs so later caller mutations cannot alter a compiled registry.
 */
export function compileAnalysisCatalog(input: AnalysisCatalogV1): AnalysisCatalogV1 {
  const packs = new Map<AnalysisPackId, PackManifestV1>()
  const providers = new Map<AnalysisProviderId, ProviderDescriptorV1>()
  const rules = new Map<string, AnalysisRuleManifestV1>()
  for (const raw of input.packs) {
    validatePack(raw)
    if (packs.has(raw.id)) throw new Error(`Duplicate analysis pack ID: ${raw.id}`)
    packs.set(raw.id, raw)
  }
  if (!packs.get('core')?.required) throw new Error('The required core analysis pack is missing')
  if (packs.size !== ANALYSIS_PACK_IDS.length) throw new Error('Analysis catalog must include all six packs')
  for (const raw of input.providers) {
    validateProvider(raw)
    if (providers.has(raw.id)) throw new Error(`Duplicate analysis provider ID: ${raw.id}`)
    providers.set(raw.id, raw)
  }
  for (const raw of input.rules) {
    validateRule(raw)
    if (rules.has(raw.id)) throw new Error(`Duplicate analysis rule ID: ${raw.id}`)
    if (!packs.has(raw.primaryPackId) || !providers.has(raw.providerId)) {
      throw new Error(`Unknown pack or provider for rule: ${raw.id}`)
    }
    const provider = providers.get(raw.providerId)!
    const nlp = raw.execution === 'nlp'
    if (provider.executionContext !== (nlp ? 'nlp-worker' : 'analysis-worker') ||
        raw.supportedDocTypes.some(doc => !provider.supportedDocTypes.includes(doc))) {
      throw new Error(`Incompatible provider for rule: ${raw.id}`)
    }
    // Static capability claims must be satisfiable by the selected Provider.
    // The runtime capability/readiness check remains a separate decision.
    if (raw.capabilitiesRequired.some(cap => !provider.capabilities.includes(cap))) {
      throw new Error(`Provider lacks declared capability for rule: ${raw.id}`)
    }
    rules.set(raw.id, raw)
  }
  const visiting = new Set<AnalysisPackId>()
  const visited = new Set<AnalysisPackId>()
  const checkDependencies = (id: AnalysisPackId): void => {
    if (visiting.has(id)) throw new Error(`Circular analysis pack dependency: ${id}`)
    if (visited.has(id)) return
    visiting.add(id)
    for (const dependency of packs.get(id)!.dependencyPackIds) {
      if (!packs.has(dependency)) throw new Error(`Missing analysis pack dependency: ${dependency}`)
      checkDependencies(dependency)
    }
    visiting.delete(id)
    visited.add(id)
  }
  for (const pack of packs.values()) checkDependencies(pack.id)
  const core = packs.get('core')!
  if (!core.defaultEnabledOnFreshInstall || core.dependencyPackIds.length !== 0) {
    throw new Error('Core analysis pack must be enabled by default and have no dependencies')
  }

  for (const pack of packs.values()) {
    const claimed = new Set(pack.declaredRuleIds)
    for (const id of claimed) {
      if (rules.get(id)?.primaryPackId !== pack.id) {
        throw new Error(`Declared rule is missing or assigned to another pack: ${id}`)
      }
    }
  }
  for (const rule of rules.values()) {
    if (!packs.get(rule.primaryPackId)!.declaredRuleIds.includes(rule.id)) {
      throw new Error(`Rule is absent from owning pack: ${rule.id}`)
    }
  }
  return Object.freeze({
    packs: Object.freeze([...packs.values()].map(p => Object.freeze({
      ...p,
      declaredRuleIds: Object.freeze([...p.declaredRuleIds]),
      capabilitiesProvided: Object.freeze([...p.capabilitiesProvided]),
      dependencyPackIds: Object.freeze([...p.dependencyPackIds])
    }))),
    rules: Object.freeze([...rules.values()].map(r => Object.freeze({
      ...r,
      capabilitiesRequired: Object.freeze([...r.capabilitiesRequired]),
      supportedDocTypes: Object.freeze([...r.supportedDocTypes])
    }))),
    providers: Object.freeze([...providers.values()].map(p => Object.freeze({
      ...p,
      capabilities: Object.freeze([...p.capabilities]),
      needsAssets: Object.freeze([...p.needsAssets]),
      supportedDocTypes: Object.freeze([...p.supportedDocTypes])
    })))
  })
}

export function resolveAnalysisRules(
  catalog: AnalysisCatalogV1,
  input: AnalysisResolutionInput
): readonly AnalysisRuleResolution[] {
  if (input.manifestVersion !== 1) throw new Error('Unsupported analysis resolution version')
  const packs = new Map(catalog.packs.map(pack => [pack.id, pack]))
  const providers = new Map(catalog.providers.map(provider => [provider.id, provider]))
  const enabled = (id: AnalysisPackId): boolean => {
    const pack = packs.get(id)
    if (!pack) return false
    return pack.required || (input.packEnabled[id] ?? pack.defaultEnabledOnFreshInstall)
  }
  const packAvailable = (id: AnalysisPackId, seen = new Set<AnalysisPackId>()): boolean => {
    if (seen.has(id) || !enabled(id)) return false
    seen.add(id)
    return packs.get(id)!.dependencyPackIds.every(dep => packAvailable(dep, new Set(seen)))
  }
  const sorted = [...catalog.rules].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  return Object.freeze(sorted.map((rule): AnalysisRuleResolution => {
    const skipped = (reason: Extract<AnalysisRuleResolution, { status: 'skipped' }>['reason']):
      AnalysisRuleResolution => Object.freeze({ status: 'skipped' as const, ruleId: rule.id, reason })
    if (!packAvailable(rule.primaryPackId)) return skipped('pack-disabled')
    if (!(input.ruleSettings[rule.id]?.enabled ?? rule.enabledByDefault)) return skipped('rule-disabled')
    if (!rule.supportedDocTypes.includes(input.activeDocumentType)) return skipped('unsupported-doctype')
    const provider = providers.get(rule.providerId)
    if (!provider) return skipped('provider-disabled')
    if (rule.execution === 'nlp') {
      if (!input.policy.nlpConsent) return skipped('consent-required')
      if (!enabled('morphology') || input.activeProviderId !== rule.providerId) {
        return skipped('provider-disabled')
      }
    }
    // Builtin rules are locally available; all other Providers must report readiness,
    // including the lazily imported textlint adapter (not only NLP Providers).
    if (provider.id !== 'builtin') {
      if (input.failedProviderIds?.has(rule.providerId)) return skipped('runtime-failed')
      if (!input.readyProviderIds.has(rule.providerId)) return skipped('provider-not-ready')
    }
    if (provider.needsAssets.some(asset => !input.assetReadyIds.has(asset))) {
      return skipped('asset-not-ready')
    }
    if (rule.capabilitiesRequired.some(cap =>
      !provider.capabilities.includes(cap) || !input.runtimeCapabilities.has(cap))) {
      return skipped('capability-missing')
    }
    return Object.freeze({ status: 'runnable' as const, ruleId: rule.id, providerId: rule.providerId })
  }))
}
