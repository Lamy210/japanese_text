/**
 * AP-02 compatibility catalog. Classification is metadata only: the existing
 * RuleProvider execution path is unchanged until Profile v2 migration.
 */
import { listRuleManifests } from '../rules/registry'
import type {
  AnalysisCatalogV1, AnalysisPackId, AnalysisRuleManifestV1,
  PackManifestV1, ProviderDescriptorV1
} from './contracts'
import { compileAnalysisCatalog } from './resolver'

const LEGACY_DICTIONARY_RULES = new Set([
  'wording/common-typo', 'wording/terminology', 'wording/ng-word'
])

/** Shared Rule ownership for runtime gates and Settings; never reset per-rule flags. */
export function isLegacyDictionaryOwnedRule(ruleId: string): boolean {
  return LEGACY_DICTIONARY_RULES.has(ruleId)
}

const DESCRIPTORS: readonly ProviderDescriptorV1[] = [
  {
    id: 'builtin', implementationVersion: '1.0.0', capabilities: [],
    needsAssets: [], networkPolicy: 'never', executionContext: 'analysis-worker',
    supportedDocTypes: ['markdown', 'text']
  },
  {
    id: 'textlint', implementationVersion: '1.0.0', capabilities: [],
    needsAssets: [], networkPolicy: 'never', executionContext: 'analysis-worker',
    supportedDocTypes: ['markdown', 'text']
  }
]

const DEFAULT_PACKS: readonly Omit<PackManifestV1, 'declaredRuleIds'>[] = [
  { manifestVersion: 1, id: 'core', label: 'Core', required: true, defaultEnabledOnFreshInstall: true, capabilitiesProvided: [], dependencyPackIds: [] },
  { manifestVersion: 1, id: 'grammar', label: 'Grammar', required: false, defaultEnabledOnFreshInstall: false, capabilitiesProvided: [], dependencyPackIds: ['core'] },
  { manifestVersion: 1, id: 'dictionary', label: 'Dictionary', required: false, defaultEnabledOnFreshInstall: true, capabilitiesProvided: [], dependencyPackIds: ['core'] },
  { manifestVersion: 1, id: 'morphology', label: 'Morphology', required: false, defaultEnabledOnFreshInstall: false, capabilitiesProvided: [], dependencyPackIds: ['core'] },
  { manifestVersion: 1, id: 'technical', label: 'Technical', required: false, defaultEnabledOnFreshInstall: false, capabilitiesProvided: [], dependencyPackIds: ['core'] },
  { manifestVersion: 1, id: 'style', label: 'Style', required: false, defaultEnabledOnFreshInstall: false, capabilitiesProvided: [], dependencyPackIds: ['core'] }
]

export function createLegacyAnalysisCatalog(): AnalysisCatalogV1 {
  const rules: AnalysisRuleManifestV1[] = listRuleManifests().map(rule => ({
    metadataVersion: 1,
    id: rule.id,
    primaryPackId: LEGACY_DICTIONARY_RULES.has(rule.id) ? 'dictionary' : 'core',
    providerId: rule.providerId === 'textlint' ? 'textlint' : 'builtin',
    execution: rule.source === 'textlint' ? 'existing-deep' : `existing-${rule.tier}` as AnalysisRuleManifestV1['execution'],
    capabilitiesRequired: [],
    supportedDocTypes: ['markdown', 'text'],
    // Existing AppConfig.ruleSettings is the authoritative state.
    // When a setting is absent, never start producing new diagnostics.
    enabledByDefault: false,
    diagnosticIssueFamily: null,
    // A metadata ceiling grants no permission to auto-apply a fix.
    fixKindCeiling: 'safe'
  }))
  const packs: PackManifestV1[] = DEFAULT_PACKS.map(pack => ({
    ...pack,
    declaredRuleIds: rules.filter(rule => rule.primaryPackId === pack.id).map(rule => rule.id)
  }))
  return compileAnalysisCatalog({ packs, rules, providers: DESCRIPTORS })
}

/** Core cannot be toggled off, even if a migrated Profile requests otherwise. */
export function defaultAnalysisPackSelection(): Readonly<Record<AnalysisPackId, boolean>> {
  return Object.freeze(Object.fromEntries(DEFAULT_PACKS.map(pack =>
    [pack.id, pack.required || pack.defaultEnabledOnFreshInstall]
  )) as Record<AnalysisPackId, boolean>)
}
