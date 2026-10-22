/**
 * AP-02: analysis-pack metadata, distinct from the synchronous RuleProvider API.
 * No executable plugins, network activity or setting migrations live here.
 */
import type { DocumentType } from '../types'

export const ANALYSIS_PACK_IDS = [
  'core', 'grammar', 'dictionary', 'morphology', 'technical', 'style'
] as const
export type AnalysisPackId = typeof ANALYSIS_PACK_IDS[number]

export const ANALYSIS_PROVIDER_IDS = [
  'builtin', 'textlint', 'dictionary-engine', 'lindera-ipadic', 'kuromojin-ipadic'
] as const
export type AnalysisProviderId = typeof ANALYSIS_PROVIDER_IDS[number]

export const ANALYSIS_CAPABILITIES = [
  'sentence-boundary', 'word-boundary', 'tokenize', 'pos', 'pos-detail',
  'lemma', 'reading', 'conjugation', 'unknown-word', 'normalized-form'
] as const
export type AnalysisCapability = typeof ANALYSIS_CAPABILITIES[number]

export interface PackManifestV1 {
  readonly manifestVersion: 1
  readonly id: AnalysisPackId
  readonly label: string
  readonly required: boolean
  readonly defaultEnabledOnFreshInstall: boolean
  readonly declaredRuleIds: readonly string[]
  readonly capabilitiesProvided: readonly AnalysisCapability[]
  readonly dependencyPackIds: readonly AnalysisPackId[]
}

export interface AnalysisRuleManifestV1 {
  readonly metadataVersion: 1
  readonly id: string
  readonly primaryPackId: AnalysisPackId
  readonly providerId: AnalysisProviderId
  readonly execution: 'existing-fast' | 'existing-deep' | 'existing-idle' | 'nlp'
  readonly capabilitiesRequired: readonly AnalysisCapability[]
  readonly supportedDocTypes: readonly DocumentType[]
  readonly enabledByDefault: boolean
  readonly diagnosticIssueFamily: string | null
  readonly fixKindCeiling: 'none' | 'suggestion' | 'safe'
}

export interface ProviderDescriptorV1 {
  readonly id: AnalysisProviderId
  readonly implementationVersion: string
  readonly capabilities: readonly AnalysisCapability[]
  readonly needsAssets: readonly string[]
  readonly networkPolicy: 'never' | 'explicit-download'
  readonly executionContext: 'analysis-worker' | 'nlp-worker'
  readonly supportedDocTypes: readonly DocumentType[]
}

export interface AnalysisCatalogV1 {
  readonly packs: readonly PackManifestV1[]
  readonly rules: readonly AnalysisRuleManifestV1[]
  readonly providers: readonly ProviderDescriptorV1[]
}

export interface AnalysisResolutionInput {
  readonly manifestVersion: 1
  readonly packEnabled: Readonly<Partial<Record<AnalysisPackId, boolean>>>
  readonly ruleSettings: Readonly<Record<string, { readonly enabled: boolean } | undefined>>
  readonly activeDocumentType: DocumentType
  readonly activeProviderId: AnalysisProviderId | null
  readonly runtimeCapabilities: ReadonlySet<AnalysisCapability>
  readonly assetReadyIds: ReadonlySet<string>
  readonly readyProviderIds: ReadonlySet<AnalysisProviderId>
  readonly failedProviderIds?: ReadonlySet<AnalysisProviderId>
  readonly policy: { readonly nlpConsent: boolean; readonly privateSession: boolean }
}

export type AnalysisSkipReason =
  | 'pack-disabled' | 'rule-disabled' | 'unsupported-doctype'
  | 'consent-required' | 'provider-disabled' | 'provider-not-ready'
  | 'runtime-failed' | 'asset-not-ready' | 'capability-missing'

export type AnalysisRuleResolution =
  | { readonly status: 'runnable'; readonly ruleId: string; readonly providerId: AnalysisProviderId }
  | { readonly status: 'skipped'; readonly ruleId: string; readonly reason: AnalysisSkipReason }
