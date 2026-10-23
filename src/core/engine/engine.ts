/**
 * Rule Engine — 仕様書 §23 (Fast/Deep 2層) / §24 (Revision) / §41 (個別Rule例外で全体停止しない)
 *
 * Fast Engine : 独自ルール (高速・正規表現・辞書ベース)
 * Deep Engine : 独自の文書構造解析ルール + textlint (別adapter)
 * Idle Tier   : document-wide解析
 */

import type { Diagnostic, DocumentType, RawDiagnostic, RuleContext, RuleError, RuleTier, Severity } from '../types'
import type { AppConfig } from '../config/schema'
import { buildRuleRegistry } from '../rules/registry'
import { runnableLegacyBuiltinRuleIds } from '../analysis/legacy-runtime-gate'
import { maskDocument } from '../text/mask'
import { splitLines, computeLineStarts, LineIndex } from '../text/positions'

export interface EngineResult {
  diagnostics: Diagnostic[]
  ruleErrors: RuleError[]
  durationMs: number
}

/** 解析の事前計算 (マスク・行索引) — 全tierで共有 */
export function buildRuleContext(text: string): RuleContext {
  const masked = maskDocument(text)
  const lines = splitLines(text)
  return {
    text,
    maskedText: masked.masked,
    maskRegions: masked.regions,
    lines,
    lineStarts: computeLineStarts(lines)
  }
}

/**
 * One request-scoped snapshot shared across Fast/Deep/Idle own-rule tiers.
 * Never reuse across revisions or different config objects: user rules and
 * terminology are created from that exact config instance.
 */
export interface PreparedOwnRuleExecution {
  readonly text: string
  readonly config: AppConfig
  readonly context: RuleContext
  readonly lineIndex: LineIndex
  readonly registry: ReturnType<typeof buildRuleRegistry>
}

export function prepareOwnRuleExecution(text: string, config: AppConfig): PreparedOwnRuleExecution {
  return {
    text,
    config,
    context: buildRuleContext(text),
    lineIndex: new LineIndex(text),
    registry: buildRuleRegistry(config)
  }
}

/** RawDiagnostic → Diagnostic 正規化 (行・列・決定論的IDの付与) */
export function normalizeDiagnostics(
  raws: RawDiagnostic[],
  ruleId: string,
  source: Diagnostic['source'],
  lineIndex: LineIndex,
  severityOverride?: Severity,
  documentation?: string
): Diagnostic[] {
  const seen = new Map<string, number>()
  return raws.map((raw) => {
    const start = Math.max(0, Math.min(raw.start, Number.MAX_SAFE_INTEGER))
    const end = Math.max(start, raw.end)
    const pos = lineIndex.posFromOffset(start)
    const baseId = `${ruleId}@${start}-${end}`
    const occurrence = seen.get(baseId) ?? 0
    seen.set(baseId, occurrence + 1)
    return {
      id: occurrence === 0 ? baseId : `${baseId}#${occurrence}`,
      ruleId,
      severity: raw.severity ?? severityOverride ?? 'warning',
      message: raw.message,
      start,
      end,
      line: pos.line,
      column: pos.column,
      fixKind: raw.fixKind ?? 'none',
      replacement: raw.replacement,
      documentation,
      source
    }
  })
}

/** 決定論的ソート (§36 Determinism: 同一入力・同一設定 → 同一結果) */
export function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.sort((a, b) => a.start - b.start || a.end - b.end || a.ruleId.localeCompare(b.ruleId))
}

/** 指定tierの独自ルールを実行する */
export function runOwnRules(
  text: string,
  config: AppConfig,
  tier: RuleTier,
  docType: DocumentType,
  prepared?: PreparedOwnRuleExecution
): EngineResult {
  if (prepared !== undefined && (prepared.text !== text || prepared.config !== config)) {
    throw new Error('Prepared analysis does not match the current text and config')
  }
  const started = now()
  const diagnostics: Diagnostic[] = []
  const ruleErrors: RuleError[] = []
  const execution = prepared ?? prepareOwnRuleExecution(text, config)
  const registry = execution.registry
  const ctx = execution.context
  const lineIndex = execution.lineIndex
  const runnable = runnableLegacyBuiltinRuleIds(config, docType)

  for (const rule of registry.values()) {
    if (rule.tier !== tier) continue
    const setting = config.rules[rule.id]
    if (setting === undefined || !setting.enabled || !runnable.has(rule.id)) continue
    try {
      const raws = rule.run(ctx, setting)
      const normalized = normalizeDiagnostics(
        raws,
        rule.id,
        rule.id === 'wording/ng-word' || rule.id === 'wording/terminology' ? 'user' : 'core',
        lineIndex,
        setting.severity,
        rule.description
      )
      diagnostics.push(...normalized)
    } catch (error) {
      // 個別Ruleの例外で全体Lintを停止しない (§41)
      ruleErrors.push({
        ruleId: rule.id,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return {
    diagnostics: sortDiagnostics(diagnostics),
    ruleErrors,
    durationMs: now() - started
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}
