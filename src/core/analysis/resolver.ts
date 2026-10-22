/**
 * AP-02: side-effect-free validation and deterministic pack/rule resolution.
 * This does not change the existing Fast/Deep/Idle execution path.
 */
import type {
  AnalysisCapability, AnalysisCatalog, AnalysisPackId, AnalysisProviderId,
  AnalysisResolutionInput, AnalysisRuleManifestV1, AnalysisRuleResolution,
  PackManifestV1, ProviderDescriptorV1
} from './contracts'

const PACK_IDS: readonly AnalysisPackId[] =
  ['core', 'grammar', 'dictionary', 'morphology', 'technical', 'style']
const PROVIDER_IDS: readonly AnalysisProviderId[] =
  ['builtin', 'textlint', 'dictionary-engine', 'lindera-ipadic', 'kuromojin-ipadic']
const CAPABILITIES: readonly AnalysisCapability[] = [
  'sentence-boundary', 'word-boundary', 'tokenize', 'pos', 'pos-detail', 'lemma',
  'reading', 'conjugation', 'unknown-word', 'normalized-form'
]
const RULE_ID = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/u
const ASSET_ID = /^[a-z0-9][a-z0-9._-]*$/u

function uniqueStrings(values: readonly string[], context: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${context}`)
}

function validDocTypes(values: readonly string[], context: string): void {
  if (values.length === 0 || values.some(v => v !== 'text' && v !== 'markdown')) {
    throw new Error(`Invalid document types in ${context}`)
  }
  uniqueStrings(values, `document types in ${context}`)
}

function validCaps(values: readonly AnalysisCapability[], context: string): void {
  if (values.some(cap => !CAPABILITIES.includes(cap))) throw new Error(`Unknown capability in ${context}`)
  uniqueStrings(values, `capability in ${context}`)
}

export interface AnalysisResolver {
  /** Always sorted by rule ID and independent of input object insertion order. */
  resolve(input: AnalysisResolutionInput): readonly AnalysisRuleResolution[]
  /** Effective flags; dependencies and required packs are enabled without persisting changes. */
  effectivePacks(flags: Readonly<Record<AnalysisPackId, boolean>>): Readonly<Record<AnalysisPackId, boolean>>
}

export function createAnalysisResolver(catalog: AnalysisCatalog): AnalysisResolver {
  const packs = new Map<AnalysisPackId, PackManifestV1>()
  for (const pack of catalog.packs) {
    if (!PACK_IDS.includes(pack.id) || pack.manifestVersion !== 1 || !pack.label.trim()) {
      throw new Error('Invalid analysis pack manifest')
    }
    if (packs.has(pack.id)) throw new Error(`Duplicate analysis pack ID: ${pack.id}`)
    uniqueStrings(pack.declaredRuleIds, `declared rule in ${pack.id}`)
    uniqueStrings(pack.dependencyPackIds, `pack dependency in ${pack.id}`)
    validCaps(pack.capabilitiesProvided, pack.id)
    if (pack.declaredRuleIds.some(id => !RULE_ID.test(id))) {
      throw new Error(`Invalid declared rule in ${pack.id}`)
    }
    packs.set(pack.id, {
      ...pack,
      declaredRuleIds: [...pack.declaredRuleIds],
      dependencyPackIds: [...pack.dependencyPackIds],
      capabilitiesProvided: [...pack.capabilitiesProvided]
    })
  }
  if (!packs.get('core')?.required) throw new Error('Required core analysis pack is missing')
  for (const pack of packs.values()) {
    if (pack.dependencyPackIds.some(dep => !packs.has(dep))) {
      throw new Error(`Missing analysis pack dependency: ${pack.id}`)
    }
  }

  // Validate the entire graph (including currently disabled packs).
  const visited = new Set<AnalysisPackId>()
  const visiting = new Set<AnalysisPackId>()
  function visit(id: AnalysisPackId): void {
    if (visited.has(id)) return
    if (visiting.has(id)) throw new Error(`Cyclic analysis pack dependency: ${id}`)
    visiting.add(id)
    for (const dep of packs.get(id)!.dependencyPackIds) visit(dep)
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of packs.keys()) visit(id)

  const providers = new Map<AnalysisProviderId, ProviderDescriptorV1>()
  for (const provider of catalog.providers) {
    if (!PROVIDER_IDS.includes(provider.id) || !provider.implementationVersion.trim() ||
      !['never', 'explicit-download'].includes(provider.networkPolicy) ||
      !['analysis-worker', 'nlp-worker'].includes(provider.executionContext)) {
      throw new Error('Invalid analysis provider')
    }
    if (providers.has(provider.id)) throw new Error(`Duplicate analysis provider: ${provider.id}`)
    validDocTypes(provider.supportedDocTypes, provider.id)
    validCaps(provider.capabilities, provider.id)
    uniqueStrings(provider.needsAssets, `asset ID in ${provider.id}`)
    if (provider.needsAssets.some(asset => !ASSET_ID.test(asset))) {
      throw new Error(`Invalid asset ID in ${provider.id}`)
    }
    providers.set(provider.id, {
      ...provider,
      capabilities: [...provider.capabilities],
      needsAssets: [...provider.needsAssets],
      supportedDocTypes: [...provider.supportedDocTypes]
    })
  }

  const rules = new Map<string, AnalysisRuleManifestV1>()
  for (const rule of catalog.rules) {
    if (!RULE_ID.test(rule.id) || rule.metadataVersion !== 1 ||
      !['existing-fast', 'existing-deep', 'existing-idle', 'nlp'].includes(rule.execution) ||
      !['none', 'suggestion', 'safe'].includes(rule.fixKindCeiling)) {
      throw new Error(`Invalid analysis rule: ${rule.id}`)
    }
    if (rules.has(rule.id)) throw new Error(`Duplicate analysis rule ID: ${rule.id}`)
    if (!packs.has(rule.primaryPackId)) throw new Error(`Missing primary pack: ${rule.id}`)
    const provider = providers.get(rule.providerId)
    if (!provider) throw new Error(`Missing rule provider: ${rule.id}`)
    validCaps(rule.capabilitiesRequired, rule.id)
    validDocTypes(rule.supportedDocTypes, rule.id)
    if (rule.capabilitiesRequired.some(cap => !provider.capabilities.includes(cap))) {
      throw new Error(`Provider lacks declared capability: ${rule.id}`)
    }
    if (rule.execution === 'nlp' && rule.fixKindCeiling === 'safe') {
      throw new Error(`NLP Safe Fix is forbidden: ${rule.id}`)
    }
    if (rule.execution === 'nlp' && provider.executionContext !== 'nlp-worker') {
      throw new Error(`NLP rule must use an NLP Worker: ${rule.id}`)
    }
    if (rule.execution !== 'nlp' && provider.executionContext !== 'analysis-worker') {
      throw new Error(`Existing rule requires analysis Worker: ${rule.id}`)
    }
    rules.set(rule.id, {
      ...rule,
      capabilitiesRequired: [...rule.capabilitiesRequired],
      supportedDocTypes: [...rule.supportedDocTypes]
    })
  }

  // Reject unowned rules, unknown declarations and multiple primary owners.
  const owned = new Set<string>()
  for (const pack of packs.values()) {
    for (const id of pack.declaredRuleIds) {
      const rule = rules.get(id)
      if (!rule || rule.primaryPackId !== pack.id || owned.has(id)) {
        throw new Error(`Invalid primary rule ownership: ${id}`)
      }
      owned.add(id)
    }
  }
  if (owned.size !== rules.size) throw new Error('Not all analysis rules have an owner')
  const sortedRules = [...rules.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

  function effectivePacks(flags: Readonly<Record<AnalysisPackId, boolean>>): Readonly<Record<AnalysisPackId, boolean>> {
    const enabled = new Set<AnalysisPackId>()
    function enable(id: AnalysisPackId): void {
      if (enabled.has(id)) return
      enabled.add(id)
      for (const dep of packs.get(id)!.dependencyPackIds) enable(dep)
    }
    for (const pack of packs.values()) {
      if (pack.required || flags[pack.id] === true) enable(pack.id)
    }
    return Object.freeze(Object.fromEntries(PACK_IDS.map(id => [id, enabled.has(id)])) as Record<AnalysisPackId, boolean>)
  }

  function resolve(input: AnalysisResolutionInput): readonly AnalysisRuleResolution[] {
    if (input.manifestVersion !== 1) throw new Error('Unsupported analysis resolution version')
    if (!['markdown', 'text'].includes(input.activeDocumentType)) throw new Error('Invalid document type')
    if (input.activeProviderId !== null && !providers.has(input.activeProviderId)) {
      throw new Error('Unknown selected analysis provider')
    }
    const flags = effectivePacks(input.packEnabled)
    return sortedRules.map(rule => {
      const skip = (reason: Extract<AnalysisRuleResolution, { status: 'skipped' }>['reason']): AnalysisRuleResolution =>
        ({ status: 'skipped', ruleId: rule.id, reason })
      if (!flags[rule.primaryPackId]) return skip('pack-disabled')
      if (input.ruleSettings[rule.id]?.enabled === false) return skip('rule-disabled')
      const provider = providers.get(rule.providerId)!
      if (!rule.supportedDocTypes.includes(input.activeDocumentType) ||
        !provider.supportedDocTypes.includes(input.activeDocumentType)) return skip('unsupported-doctype')
      if (rule.execution === 'nlp') {
        if (!input.policy.nlpConsent) return skip('consent-required')
        if (!flags.morphology || input.activeProviderId !== rule.providerId) return skip('provider-disabled')
        if (input.failedProviderIds?.has(rule.providerId)) return skip('runtime-failed')
        if (!input.readyProviderIds.has(rule.providerId)) return skip('provider-not-ready')
      }
      if (provider.needsAssets.some(id => !input.assetReadyIds.has(id))) return skip('asset-not-ready')
      if (rule.capabilitiesRequired.some(cap => !input.runtimeCapabilities.has(cap))) {
        return skip('capability-missing')
      }
      return { status: 'runnable', ruleId: rule.id, providerId: rule.providerId }
    })
  }
  return Object.freeze({ resolve, effectivePacks })
}
