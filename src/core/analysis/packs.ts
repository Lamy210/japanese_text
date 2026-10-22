/**
 * AP-02: explicit ownership of every existing Rule ID, without renaming it.
 * This mapping is metadata only; the current rule registry remains authoritative.
 */
import { listRuleManifests } from '../rules/registry'
import type { AnalysisCatalog, AnalysisPackId, AnalysisRuleManifestV1, PackManifestV1, ProviderDescriptorV1 } from './contracts'

const PRIMARY_PACK: Readonly<Record<string, AnalysisPackId>> = Object.freeze({
  'typography/full-width-space': 'core',
  'typography/unnecessary-space': 'core',
  'typography/punctuation': 'core',
  'typography/brackets': 'core',
  'typography/alnum-width': 'core',
  'typography/nfd': 'core',
  'typography/hankaku-kana': 'core',
  'wording/ng-word': 'dictionary',
  'wording/terminology': 'dictionary',
  'wording/common-typo': 'dictionary',
  'wording/redundancy': 'style',
  'wording/nominalized-action': 'style',
  'wording/request-cushion-review': 'style',
  'wording/repeated-phrase': 'style',
  'wording/double-honorific': 'grammar',
  'wording/honorific-request': 'grammar',
  'wording/doubled-object-particle': 'grammar',
  'wording/tautology': 'style',
  'wording/ambiguity': 'style',
  'style/honorific-consistency': 'grammar',
  'style/meeting-minutes-sections': 'style',
  'style/business-document-structure': 'style',
  'style/mixed-tone': 'style',
  'style/cross-paragraph-tone': 'style',
  'style/consecutive-conjunction': 'style',
  'style/additive-conjunction-density': 'style',
  'style/mixed-conjunction-density': 'style',
  'style/comma-count': 'style',
  'style/paragraph-density': 'style',
  'style/sentence-length': 'style',
  'markdown/blockquote-spacing': 'core',
  'markdown/blockquote-blank-lines': 'core',
  'markdown/heading-order': 'core',
  'evidence/citation-number': 'core',
  'evidence/citation-comparison': 'core',
  'evidence/citation-external-fact': 'core',
  'reference/undefined': 'core',
  'reference/empty-url': 'core',
  'reference/malformed-url': 'core',
  'reference/broken-anchor': 'core',
  'reference/duplicate-id': 'core',
  'reference/unused': 'core',
  'reference/duplicate-anchor': 'core'
})

const PROVIDERS: readonly ProviderDescriptorV1[] = Object.freeze([
  Object.freeze({
    id: 'builtin', implementationVersion: 'legacy',
    capabilities: [], needsAssets: [], networkPolicy: 'never',
    executionContext: 'analysis-worker', supportedDocTypes: ['text', 'markdown']
  }),
  Object.freeze({
    id: 'textlint', implementationVersion: 'legacy',
    capabilities: [], needsAssets: [], networkPolicy: 'never',
    executionContext: 'analysis-worker', supportedDocTypes: ['text', 'markdown']
  })
])

const PACK_DEFS = [
  { id: 'core', label: 'Core', required: true, defaultEnabledOnFreshInstall: true, dependencyPackIds: [] },
  { id: 'grammar', label: 'Grammar', required: false, defaultEnabledOnFreshInstall: true, dependencyPackIds: ['core'] },
  { id: 'dictionary', label: 'Dictionary', required: false, defaultEnabledOnFreshInstall: true, dependencyPackIds: ['core'] },
  { id: 'morphology', label: 'Morphology', required: false, defaultEnabledOnFreshInstall: false, dependencyPackIds: ['core'] },
  { id: 'technical', label: 'Technical', required: false, defaultEnabledOnFreshInstall: false, dependencyPackIds: ['core'] },
  { id: 'style', label: 'Style', required: false, defaultEnabledOnFreshInstall: true, dependencyPackIds: ['core'] }
] as const

/**
 * Fail at registration if a new legacy rule lacks explicit Pack ownership.
 * This makes review mandatory before future migrations to Profile v2.
 */
export function buildLegacyAnalysisCatalog(): AnalysisCatalog {
  const legacy = listRuleManifests()
  const actual = new Set(legacy.map(x => x.id))
  const missing = legacy.filter(x => PRIMARY_PACK[x.id] === undefined).map(x => x.id)
  const obsolete = Object.keys(PRIMARY_PACK).filter(id => !actual.has(id))
  if (missing.length || obsolete.length) {
    throw new Error(`Stale legacy analysis pack ownership: missing=[${missing.join(',')}] obsolete=[${obsolete.join(',')}]`)
  }
  const rules: AnalysisRuleManifestV1[] = legacy.map(rule => ({
    id: rule.id,
    primaryPackId: PRIMARY_PACK[rule.id]!,
    providerId: rule.providerId === 'textlint' ? 'textlint' : 'builtin',
    execution: rule.tier === 'fast' ? 'existing-fast' : rule.tier === 'deep' ? 'existing-deep' : 'existing-idle',
    capabilitiesRequired: [],
    supportedDocTypes: ['text', 'markdown'],
    enabledByDefault: false, // The actual existing preset, not this metadata, controls enablement.
    diagnosticIssueFamily: null,
    fixKindCeiling: 'safe', // Existing Formatter still gates actual Safe Fix applicability.
    metadataVersion: 1
  }))
  const packs: PackManifestV1[] = PACK_DEFS.map(def => ({
    ...def,
    dependencyPackIds: [...def.dependencyPackIds],
    declaredRuleIds: rules.filter(rule => rule.primaryPackId === def.id).map(rule => rule.id),
    capabilitiesProvided: [],
    manifestVersion: 1
  }))
  return { packs, rules, providers: PROVIDERS }
}
