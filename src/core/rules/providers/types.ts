import type { AppConfig } from '../../config/schema'
import type { CoreRule, RuleCategory, RuleOptionDef, RuleTier, Severity, DiagnosticSource } from '../../types'

/** Metadata is separate from executable rules and does not claim that a fix is safe. */
export interface RuleManifest {
  id: string
  providerId: string
  category: RuleCategory
  tier: RuleTier
  source: DiagnosticSource
  description: string
  defaultSeverity: Severity
  optionDefs?: RuleOptionDef[]
}

/** Local provider only: untrusted executable plugins are not supported. */
export interface RuleProvider {
  readonly id: string
  listManifests(): readonly RuleManifest[]
  createRules(config: AppConfig): readonly CoreRule[]
}
