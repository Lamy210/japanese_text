/** Deterministic, side-effect-free Pack / Provider / Rule resolution (AP-02). */
import type { RuleManifest } from '../rules/providers/types'
import type {
  AnalysisCapability, AnalysisCatalog, AnalysisPackId, AnalysisRuleManifestV1,
  ResolutionInput, RuleResolution
} from './contracts'
import { DEFAULT_PACK_MANIFESTS, DEFAULT_PROVIDER_DESCRIPTORS, DEFAULT_RULE_PACK_OWNERSHIP } from './packs'

const RULE_ID = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/
const PROVIDER_ID = /^[a-z][a-z0-9-]*$/
const VALID_CAPABILITIES: ReadonlySet<string> = new Set<AnalysisCapability>([
  'sentence-boundary', 'word-boundary', 'tokenize', 'pos', 'pos-detail',
  'lemma', 'reading', 'conjugation', 'unknown-word', 'normalized-form'
])
const PACK_IDS: ReadonlySet<string> = new Set(['core', 'grammar', 'dictionary', 'morphology', 'technical', 'style'])
const DOC_TYPES: ReadonlySet<string> = new Set(['markdown', 'text'])

function unique<T>(values: readonly T[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error('Duplicate ' + label)
}

/** Refuse broken metadata at registration time, not after enabling a specific Pack. */
export function validateAnalysisCatalog(catalog: AnalysisCatalog): void {
  const packIds = catalog.packs.map(p => p.id)
  unique(packIds, 'pack ID')
  if (packIds.length !== PACK_IDS.size || packIds.some(id => !PACK_IDS.has(id))) {
    throw new Error('Pack catalog must declare the six known Pack IDs')
  }
  const core = catalog.packs.find(p => p.id === 'core')!
  if (!core.required || !core.defaultEnabledOnFreshInstall || core.dependencyPackIds.length !== 0) {
    throw new Error('Core Pack must always be required with no dependencies')
  }
  const packsById = new Map(catalog.packs.map(p => [p.id, p]))
  for (const pack of catalog.packs) {
    if (pack.manifestVersion !== 1 || !pack.label.trim()) throw new Error('Invalid Pack manifest: ' + pack.id)
    unique(pack.dependencyPackIds, 'dependencies of ' + pack.id)
    for (const dep of pack.dependencyPackIds) {
      if (!packsById.has(dep)) throw new Error('Missing Pack dependency: ' + pack.id + ' -> ' + dep)
    }
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: AnalysisPackId): void => {
    if (visiting.has(id)) throw new Error('Pack dependency cycle: ' + id)
    if (visited.has(id)) return
    visiting.add(id)
    for (const dep of packsById.get(id)!.dependencyPackIds) visit(dep)
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of packIds) visit(id)

  const providerIds = catalog.providers.map(p => p.id)
  unique(providerIds, 'provider ID')
  const providerMap = new Map(catalog.providers.map(p => [p.id, p]))
  for (const provider of catalog.providers) {
    if (!PROVIDER_ID.test(provider.id) || !provider.implementationVersion.trim() ||
        provider.supportedDocTypes.length === 0 || provider.supportedDocTypes.some(t => !DOC_TYPES.has(t)) ||
        provider.capabilities.some(c => !VALID_CAPABILITIES.has(c)) ||
        !['never', 'explicit-download'].includes(provider.networkPolicy) ||
        !['analysis-worker', 'nlp-worker'].includes(provider.executionContext)) {
      throw new Error('Invalid provider descriptor: ' + provider.id)
    }
    unique(provider.capabilities, 'capabilities of ' + provider.id)
    unique(provider.needsAssets, 'assets of ' + provider.id)
  }
  unique(catalog.rules.map(r => r.id), 'rule ID')
  for (const rule of catalog.rules) {
    const provider = providerMap.get(rule.providerId)
    if (rule.metadataVersion !== 1 || !RULE_ID.test(rule.id) || !packsById.has(rule.primaryPackId) || !provider ||
        rule.supportedDocTypes.length === 0 || rule.supportedDocTypes.some(t => !provider.supportedDocTypes.includes(t)) ||
        rule.capabilitiesRequired.some(c => !VALID_CAPABILITIES.has(c)) ||
        (rule.execution === 'nlp' && provider.executionContext !== 'nlp-worker') ||
        (rule.execution !== 'nlp' && provider.executionContext !== 'analysis-worker') ||
        (rule.execution !== 'nlp' && rule.execution !== 'existing-' + rule.tier)) {
      throw new Error('Invalid analysis rule manifest: ' + rule.id)
    }
    unique(rule.capabilitiesRequired, 'capabilities required by ' + rule.id)
    unique(rule.supportedDocTypes, 'document types of ' + rule.id)
    for (const capability of rule.capabilitiesRequired) {
      if (!provider.capabilities.includes(capability)) {
        throw new Error('Provider lacks declared capability ' + capability + ': ' + rule.id)
      }
    }
  }
}

/** Adds Pack ownership to existing manifests without changing the existing RuleProvider API. */
export function createDefaultAnalysisCatalog(manifests: readonly RuleManifest[]): AnalysisCatalog {
  const known = new Set(manifests.map(m => m.id))
  const configured = Object.keys(DEFAULT_RULE_PACK_OWNERSHIP)
  if (known.size !== manifests.length || configured.length !== known.size ||
      configured.some(id => !known.has(id))) throw new Error('Existing rule/Pack ownership drift')
  const rules: AnalysisRuleManifestV1[] = manifests.map(m => {
    const primaryPackId = DEFAULT_RULE_PACK_OWNERSHIP[m.id]
    if (!primaryPackId) throw new Error('Unowned Rule: ' + m.id)
    return {
      ...structuredClone(m), metadataVersion: 1, primaryPackId,
      execution: ('existing-' + m.tier) as AnalysisRuleManifestV1['execution'],
      capabilitiesRequired: [], supportedDocTypes: ['markdown', 'text']
    }
  })
  const catalog: AnalysisCatalog = {
    packs: structuredClone(DEFAULT_PACK_MANIFESTS),
    providers: structuredClone(DEFAULT_PROVIDER_DESCRIPTORS), rules
  }
  validateAnalysisCatalog(catalog)
  return catalog
}

/** Pack toggles never mutate RuleProfile.ruleSettings, or claim missing analysis was clean. */
export function resolveAnalysisRules(catalog: AnalysisCatalog, input: ResolutionInput): RuleResolution[] {
  if (input.manifestVersion !== 1) throw new Error('Unsupported analysis resolution version')
  validateAnalysisCatalog(catalog)
  if (!DOC_TYPES.has(input.activeDocumentType)) throw new Error('Unknown document type')
  const packs = new Map(catalog.packs.map(p => [p.id, p]))
  for (const id of Object.keys(input.packEnabled ?? {})) {
    if (!packs.has(id as AnalysisPackId)) throw new Error('Unknown Pack setting: ' + id)
  }
  const enabled = new Map(catalog.packs.map(p => [p.id, p.required || (input.packEnabled?.[p.id] ?? p.defaultEnabledOnFreshInstall)]))
  const packActive = (id: AnalysisPackId): boolean => {
    const pack = packs.get(id)!
    return enabled.get(id) === true && pack.dependencyPackIds.every(dep => packActive(dep))
  }
  const providers = new Map(catalog.providers.map(p => [p.id, p]))
  return [...catalog.rules].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(rule => {
    const skipped = (reason: Extract<RuleResolution, { status: 'skipped' }>['reason']): RuleResolution =>
      ({ ruleId: rule.id, status: 'skipped', reason })
    if (!packActive(rule.primaryPackId)) return skipped('pack-disabled')
    if (input.ruleSettings[rule.id]?.enabled !== true) return skipped('rule-disabled')
    if (!rule.supportedDocTypes.includes(input.activeDocumentType)) return skipped('unsupported-doctype')
    if (rule.execution === 'nlp' && !input.nlpConsent) return skipped('consent-required')
    if (rule.execution === 'nlp' && !packActive('morphology')) return skipped('provider-disabled')
    if (rule.execution === 'nlp' && input.activeProviderId !== rule.providerId) return skipped('provider-disabled')
    if (!input.readyProviderIds.has(rule.providerId)) return skipped('provider-not-ready')
    const provider = providers.get(rule.providerId)!
    if (provider.needsAssets.some(asset => !input.assetReadyIds.has(asset))) return skipped('asset-not-ready')
    if (rule.capabilitiesRequired.some(cap => !input.runtimeCapabilities.has(cap))) return skipped('capability-missing')
    return { ruleId: rule.id, status: 'runnable' as const, providerId: rule.providerId }
  })
}
