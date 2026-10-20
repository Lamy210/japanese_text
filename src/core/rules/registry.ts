/**
 * Rule registry: provider aggregation + rule execution metadata.
 *
 * The textlint provider advertises manifests only; textlint execution still
 * belongs to the existing asynchronous deep adapter. No external plugin loading.
 */
import type { CoreRule } from '../types'
import type { AppConfig } from '../config/schema'
import { builtinRuleProvider } from './providers/builtin'
import { textlintRuleProvider } from './providers/textlint'
import type { RuleManifest, RuleProvider } from './providers/types'

export { TEXTLINT_RULE_IDS, TEXTLINT_RULE_META } from './providers/textlint'
export type { RuleManifest, RuleProvider } from './providers/types'

export const DEFAULT_RULE_PROVIDERS: readonly RuleProvider[] = Object.freeze([
  builtinRuleProvider,
  textlintRuleProvider
])

const RULE_ID = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/

function collectManifests(providers: readonly RuleProvider[]): Map<string, RuleManifest> {
  const providerIds = new Set<string>()
  const manifests = new Map<string, RuleManifest>()

  for (const provider of providers) {
    if (provider.id.length === 0) throw new Error('Provider ID must not be empty')
    if (providerIds.has(provider.id)) throw new Error(`Duplicate provider ID: ${provider.id}`)
    providerIds.add(provider.id)

    for (const raw of provider.listManifests()) {
      if (!RULE_ID.test(raw.id)) throw new Error(`Invalid rule ID: ${raw.id}`)
      if (raw.providerId !== provider.id) {
        throw new Error(`Manifest provider mismatch: ${raw.id} belongs to ${raw.providerId}`)
      }
      if (manifests.has(raw.id)) throw new Error(`Duplicate rule ID: ${raw.id}`)
      manifests.set(raw.id, structuredClone(raw))
    }
  }
  return manifests
}

/** Immutable default provider collection; cache validated metadata outside the lint hot path. */
const DEFAULT_MANIFESTS = collectManifests(DEFAULT_RULE_PROVIDERS)

/** Stable, self-contained metadata list for settings and future integrations. */
export function listRuleManifests(
  providers: readonly RuleProvider[] = DEFAULT_RULE_PROVIDERS
): RuleManifest[] {
  return [...collectManifests(providers).values()]
    .sort((a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id))
}

/** Deterministic native rule aggregation. Does not execute textlint adapter rules. */
export function buildRuleRegistry(
  config: AppConfig,
  providers: readonly RuleProvider[] = DEFAULT_RULE_PROVIDERS
): Map<string, CoreRule> {
  const manifests = providers === DEFAULT_RULE_PROVIDERS ? DEFAULT_MANIFESTS : collectManifests(providers)
  const rules = new Map<string, CoreRule>()
  for (const provider of providers) {
    for (const rule of provider.createRules(config)) {
      const manifest = manifests.get(rule.id)
      if (manifest === undefined || manifest.providerId !== provider.id || manifest.source === 'textlint') {
        throw new Error(`Runtime rule has no matching manifest: ${rule.id}`)
      }
      if (rules.has(rule.id)) throw new Error(`Duplicate runtime rule ID: ${rule.id}`)
      if (
        rule.category !== manifest.category ||
        rule.tier !== manifest.tier ||
        rule.description !== manifest.description ||
        rule.defaultSeverity !== manifest.defaultSeverity
      ) {
        throw new Error(`Runtime rule/manifest mismatch: ${rule.id}`)
      }
      rules.set(rule.id, rule)
    }
  }
  for (const manifest of manifests.values()) {
    if (manifest.source !== 'textlint' && !rules.has(manifest.id)) {
      throw new Error(`Manifest has no matching runtime rule: ${manifest.id}`)
    }
  }
  return rules
}

/** 設定UI表示順 (カテゴリ → ruleId) */
export const RULE_CATEGORY_LABELS: Record<string, string> = {
  style: '文体・構成',
  typography: 'タイポグラフィ',
  wording: '用語・表現',
  evidence: '出典・根拠',
  reference: '参照・リンク',
  markdown: 'Markdown構造'
}
