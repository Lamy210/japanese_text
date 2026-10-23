/**
 * AP-03c: derive an execution-only AppConfig from Profile Pack choices.
 *
 * Do not change the persisted rule settings, severity, options or original
 * config object: a disabled Pack is a temporary runtime gate. Existing
 * manifest ownership is authoritative. No NLP adapter is started here.
 */
import type { AppConfig } from '../config/schema'
import { createLegacyAnalysisCatalog } from './packs'

const ruleOwnership = new Map(
  createLegacyAnalysisCatalog().rules.map(rule => [rule.id, rule.primaryPackId])
)

export function configForEnabledAnalysisPacks(config: AppConfig): AppConfig {
  let effectiveRules: AppConfig['rules'] | undefined

  for (const [ruleId, packId] of ruleOwnership) {
    // core is mandatory even if an invalid caller bypasses normal config validation.
    if (packId === 'core' || config.analysis.packs[packId]) continue
    const setting = config.rules[ruleId]
    if (setting === undefined || !setting.enabled) continue
    effectiveRules ??= { ...config.rules }
    effectiveRules[ruleId] = { ...setting, enabled: false }
  }

  return effectiveRules === undefined ? config : { ...config, rules: effectiveRules }
}
