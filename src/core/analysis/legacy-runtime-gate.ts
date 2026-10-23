/**
 * AP-03c, step 1: bridge persisted Pack settings to the existing synchronous
 * builtin rule path. Catalog registration is shared with AP-02; no new rule
 * IDs, document content cache, network request, or NLP runtime is introduced.
 *
 * The legacy catalog currently assigns all builtin rules to required Core
 * except three Dictionary rules. Grammar/Style/Technical and Morphology are
 * not yet runtime-owned packs; their persisted switches stay metadata-only.
 */
import type { AppConfig } from '../config/schema'
import type { DocumentType } from '../types'
import { createLegacyAnalysisCatalog } from './packs'
import { resolveAnalysisRules } from './resolver'

const catalog = createLegacyAnalysisCatalog()

/**
 * Captures one request's effective builtin eligibility. A missing per-rule
 * flag is disabled, matching runOwnRules' established behavior.
 *
 * Textlint readiness is resolved by the separate async adapter, not inferred
 * by this synchronous helper. Only builtin IDs are returned.
 */
export function runnableLegacyBuiltinRuleIds(
  config: AppConfig,
  docType: DocumentType
): ReadonlySet<string> {
  const result = resolveAnalysisRules(catalog, {
    manifestVersion: 1,
    packEnabled: config.analysis.packs,
    ruleSettings: config.rules,
    activeDocumentType: docType,
    activeProviderId: null,
    runtimeCapabilities: new Set(),
    assetReadyIds: new Set(),
    readyProviderIds: new Set(),
    policy: { nlpConsent: false, privateSession: config.privacy.privacyMode }
  })
  return new Set(result.flatMap(rule =>
    rule.status === 'runnable' && rule.providerId === 'builtin' ? [rule.ruleId] : []
  ))
}
