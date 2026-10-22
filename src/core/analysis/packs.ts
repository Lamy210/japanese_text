import type { AnalysisPackId, PackManifestV1, ProviderDescriptorV1 } from './contracts'

/** Metadata defaults preserve existing v1 rules until AP-03 writes pack settings. */
export const DEFAULT_PACK_MANIFESTS: readonly PackManifestV1[] = [
  { manifestVersion: 1, id: 'core', label: '基本校正', required: true, defaultEnabledOnFreshInstall: true, dependencyPackIds: [] },
  { manifestVersion: 1, id: 'grammar', label: '日本語文法', required: false, defaultEnabledOnFreshInstall: true, dependencyPackIds: ['core'] },
  { manifestVersion: 1, id: 'dictionary', label: '辞書・用語', required: false, defaultEnabledOnFreshInstall: true, dependencyPackIds: ['core'] },
  { manifestVersion: 1, id: 'morphology', label: '形態素解析', required: false, defaultEnabledOnFreshInstall: false, dependencyPackIds: ['core'] },
  { manifestVersion: 1, id: 'technical', label: '技術文書', required: false, defaultEnabledOnFreshInstall: true, dependencyPackIds: ['core'] },
  { manifestVersion: 1, id: 'style', label: '文章構成・スタイル', required: false, defaultEnabledOnFreshInstall: true, dependencyPackIds: ['core'] }
]

/** Descriptor presence never means that an external tokenizer or dictionary is installed. */
export const DEFAULT_PROVIDER_DESCRIPTORS: readonly ProviderDescriptorV1[] = [
  { id: 'builtin', implementationVersion: '1', capabilities: [], needsAssets: [], networkPolicy: 'never', executionContext: 'analysis-worker', supportedDocTypes: ['markdown', 'text'] },
  { id: 'textlint', implementationVersion: '1', capabilities: [], needsAssets: [], networkPolicy: 'never', executionContext: 'analysis-worker', supportedDocTypes: ['markdown', 'text'] }
]

/** Exactly one primary Pack per v1 rule. No renames, wrappers, or rule duplication. */
export const DEFAULT_RULE_PACK_OWNERSHIP: Readonly<Record<string, AnalysisPackId>> = {
  'typography/full-width-space': 'core',
  'typography/unnecessary-space': 'core',
  'typography/punctuation': 'core',
  'typography/brackets': 'core',
  'typography/alnum-width': 'core',
  'typography/nfd': 'core',
  'typography/hankaku-kana': 'core',
  'markdown/blockquote-spacing': 'core',
  'markdown/blockquote-blank-lines': 'core',
  'markdown/heading-order': 'core',
  'reference/undefined': 'core',
  'reference/empty-url': 'core',
  'reference/malformed-url': 'core',
  'reference/broken-anchor': 'core',
  'reference/duplicate-id': 'core',
  'reference/unused': 'core',
  'reference/duplicate-anchor': 'core',
  'wording/ng-word': 'dictionary',
  'wording/terminology': 'dictionary',
  'wording/common-typo': 'dictionary',
  'wording/double-honorific': 'grammar',
  'wording/honorific-request': 'grammar',
  'wording/doubled-object-particle': 'grammar',
  'style/honorific-consistency': 'grammar',
  'style/mixed-tone': 'grammar',
  'style/cross-paragraph-tone': 'grammar',
  'evidence/citation-number': 'technical',
  'evidence/citation-comparison': 'technical',
  'evidence/citation-external-fact': 'technical',
  'wording/redundancy': 'style',
  'wording/nominalized-action': 'style',
  'wording/request-cushion-review': 'style',
  'wording/repeated-phrase': 'style',
  'wording/tautology': 'style',
  'wording/ambiguity': 'style',
  'style/meeting-minutes-sections': 'style',
  'style/business-document-structure': 'style',
  'style/consecutive-conjunction': 'style',
  'style/additive-conjunction-density': 'style',
  'style/mixed-conjunction-density': 'style',
  'style/comma-count': 'style',
  'style/paragraph-density': 'style',
  'style/sentence-length': 'style'
}
