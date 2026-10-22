/**
 * AP-02: declarative analysis pack and NLP-provider metadata.
 *
 * This namespace is separate from the existing synchronous RuleProvider API.
 * No runtime plugins, assets, network calls, or persisted settings are added.
 */
import type { DocumentType, FixKind } from '../types'

export type AnalysisPackId = 'core' | 'grammar' | 'dictionary' | 'morphology' | 'technical' | 'style'
export type AnalysisCapability =
  | 'sentence-boundary' | 'word-boundary' | 'tokenize'
  | 'pos' | 'pos-detail' | 'lemma' | 'reading'
  | 'conjugation' | 'unknown-word' | 'normalized-form'
export type AnalysisProviderId =
  | 'builtin' | 'textlint' | 'dictionary-engine'
  | 'lindera-ipadic' | 'kuromojin-ipadic'

export interface PackManifestV1 {
  readonly id: AnalysisPackId
  readonly label: string
  readonly required: boolean
  readonly defaultEnabledOnFreshInstall: boolean
  readonly declaredRuleIds: readonly string[]
  readonly capabilitiesProvided: readonly AnalysisCapability[]
  readonly dependencyPackIds: readonly AnalysisPackId[]
  readonly manifestVersion: 1
}

export interface AnalysisRuleManifestV1 {
  readonly id: string
  readonly primaryPackId: AnalysisPackId
  readonly providerId: AnalysisProviderId
  readonly execution: 'existing-fast' | 'existing-deep' | 'existing-idle' | 'nlp'
  readonly capabilitiesRequired: readonly AnalysisCapability[]
  readonly supportedDocTypes: readonly DocumentType[]
  readonly enabledByDefault: boolean
  readonly diagnosticIssueFamily: string | null
  readonly fixKindCeiling: FixKind
  readonly metadataVersion: 1
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

export interface AnalysisResolutionInput {
  readonly manifestVersion: 1
  readonly packEnabled: Readonly<Record<AnalysisPackId, boolean>>
  readonly ruleSettings: Readonly<Record<string, { readonly enabled: boolean } | undefined>>
  readonly activeDocumentType: DocumentType
  readonly activeProviderId: AnalysisProviderId | null
  readonly runtimeCapabilities: ReadonlySet<AnalysisCapability>
  readonly assetReadyIds: ReadonlySet<string>
  readonly readyProviderIds: ReadonlySet<AnalysisProviderId>
  readonly failedProviderIds?: ReadonlySet<AnalysisProviderId>
  readonly policy: {
    readonly nlpConsent: boolean
    readonly privateSession: boolean
  }
}

export type AnalysisRuleResolution =
  | { readonly status: 'runnable'; readonly ruleId: string; readonly providerId: AnalysisProviderId }
  | { readonly status: 'skipped'; readonly ruleId: string; readonly reason:
    | 'pack-disabled' | 'rule-disabled' | 'unsupported-doctype'
    | 'provider-disabled' | 'provider-not-ready' | 'capability-missing'
    | 'asset-not-ready' | 'consent-required' | 'runtime-failed' }

export interface AnalysisCatalog {
  readonly packs: readonly PackManifestV1[]
  readonly rules: readonly AnalysisRuleManifestV1[]
  readonly providers: readonly ProviderDescriptorV1[]
}
