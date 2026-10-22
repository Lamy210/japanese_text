/** Analysis Packs are metadata. Existing RuleProvider/CoreRule and three lint tiers stay unchanged. */
import type { DocumentType, RuleSetting } from '../types'
import type { RuleManifest } from '../rules/providers/types'

export type AnalysisPackId = 'core' | 'grammar' | 'dictionary' | 'morphology' | 'technical' | 'style'
export type AnalysisCapability =
  | 'sentence-boundary' | 'word-boundary' | 'tokenize' | 'pos' | 'pos-detail'
  | 'lemma' | 'reading' | 'conjugation' | 'unknown-word' | 'normalized-form'

export interface PackManifestV1 {
  readonly manifestVersion: 1
  readonly id: AnalysisPackId
  readonly label: string
  readonly required: boolean
  readonly defaultEnabledOnFreshInstall: boolean
  readonly dependencyPackIds: readonly AnalysisPackId[]
}

export interface ProviderDescriptorV1 {
  readonly id: string
  readonly implementationVersion: string
  readonly capabilities: readonly AnalysisCapability[]
  readonly needsAssets: readonly string[]
  readonly networkPolicy: 'never' | 'explicit-download'
  readonly executionContext: 'analysis-worker' | 'nlp-worker'
  readonly supportedDocTypes: readonly DocumentType[]
}

export type RuleExecution = 'existing-fast' | 'existing-deep' | 'existing-idle' | 'nlp'

export interface AnalysisRuleManifestV1 extends RuleManifest {
  readonly metadataVersion: 1
  readonly primaryPackId: AnalysisPackId
  readonly execution: RuleExecution
  readonly capabilitiesRequired: readonly AnalysisCapability[]
  readonly supportedDocTypes: readonly DocumentType[]
}

/** Ready providers are supplied by the actual runtime, not inferred from manifest presence. */
export interface ResolutionInput {
  readonly manifestVersion: 1
  readonly packEnabled?: Readonly<Partial<Record<AnalysisPackId, boolean>>>
  readonly ruleSettings: Readonly<Record<string, Pick<RuleSetting, 'enabled'> | undefined>>
  readonly activeDocumentType: DocumentType
  readonly activeProviderId: string | null
  readonly readyProviderIds: ReadonlySet<string>
  readonly runtimeCapabilities: ReadonlySet<AnalysisCapability>
  readonly assetReadyIds: ReadonlySet<string>
  readonly nlpConsent: boolean
}

export type RuleSkipReason =
  | 'pack-disabled' | 'rule-disabled' | 'unsupported-doctype' | 'consent-required'
  | 'provider-disabled' | 'provider-not-ready' | 'asset-not-ready' | 'capability-missing'

export type RuleResolution =
  | { readonly ruleId: string; readonly status: 'runnable'; readonly providerId: string }
  | { readonly ruleId: string; readonly status: 'skipped'; readonly reason: RuleSkipReason }

export interface AnalysisCatalog {
  readonly packs: readonly PackManifestV1[]
  readonly providers: readonly ProviderDescriptorV1[]
  readonly rules: readonly AnalysisRuleManifestV1[]
}
