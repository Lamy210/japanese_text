/**
 * Ruleテストヘルパー — 仕様書 §48 Unit Test
 * 各Ruleについて positive / negative / exception / boundary / Unicode ケースを持つ。
 */

import type { AppConfig } from '../src/core/config/schema'
import { createDefaultConfig } from '../src/core/config/validate'
import { buildRuleRegistry } from '../src/core/rules/registry'
import { runOwnRules, buildRuleContext } from '../src/core/engine/engine'
import { LineIndex } from '../src/core/text/positions'
import type { Diagnostic, RuleTier } from '../src/core/types'

export function testConfig(overrides?: Partial<AppConfig>): AppConfig {
  const config = createDefaultConfig()
  // テストでは全ルールを明示的に有効化 (ルール単位の検証のため)
  const registry = buildRuleRegistry(config)
  for (const id of registry.keys()) {
    config.rules[id] = {
      enabled: true,
      severity: config.rules[id]?.severity ?? 'warning',
      options: config.rules[id]?.options
    }
  }
  return { ...config, ...overrides }
}

/** 単一ルールを特定テキストに対して実行する */
export function runSingleRule(ruleId: string, text: string, config: AppConfig): Diagnostic[] {
  const registry = buildRuleRegistry(config)
  const rule = registry.get(ruleId)
  if (rule === undefined) {
    throw new Error(`rule not found: ${ruleId}`)
  }
  const setting = config.rules[ruleId] ?? { enabled: true, severity: rule.defaultSeverity }
  const ctx = buildRuleContext(text)
  const raws = rule.run(ctx, setting)
  const lineIndex = new LineIndex(text)
  const source = ruleId === 'wording/ng-word' || ruleId === 'wording/terminology' ? 'user' : 'core'
  return raws.map((raw) => {
    const pos = lineIndex.posFromOffset(raw.start)
    return {
      id: `${ruleId}@${raw.start}-${raw.end}`,
      ruleId,
      severity: raw.severity ?? setting.severity,
      message: raw.message,
      start: raw.start,
      end: raw.end,
      line: pos.line,
      column: pos.column,
      fixKind: raw.fixKind ?? 'none',
      replacement: raw.replacement,
      documentation: rule.description,
      source
    }
  })
}

/** 指定tierの全ルールを実行する (engine経由) */
export function runTier(text: string, config: AppConfig, tier: RuleTier) {
  return runOwnRules(text, config, tier, 'markdown')
}

export function ruleIds(result: { diagnostics: Diagnostic[] }): string[] {
  return result.diagnostics.map((d) => d.ruleId)
}
