/**
 * Worker通信プロトコル — 仕様書 §24 (Document Revision必須)
 *
 * Main Thread ↔ Analysis Worker 間のすべての通信はrevisionを必須とする。
 * 100, 101 の結果が後から返ってきてもUIへ適用しない (最新revisionのみ表示)。
 */

import type { AppConfig } from '../core/config/schema'
import type { Diagnostic, DocumentType, RuleError, RuleTier } from '../core/types'

export type LintTier = RuleTier

export interface LintRequest {
  type: 'lint'
  revision: number
  text: string
  config: AppConfig
  docType: DocumentType
  tiers: LintTier[]
}

export interface LintTierResult {
  type: 'result'
  revision: number
  tier: LintTier
  diagnostics: Diagnostic[]
  ruleErrors: RuleError[]
  durationMs: number
}

export interface LintErrorMessage {
  type: 'error'
  revision: number
  message: string
}

export interface WorkerReadyMessage {
  type: 'ready'
  segmenterAvailable: boolean
}

export type WorkerRequest = LintRequest
export type WorkerResponse = LintTierResult | LintErrorMessage | WorkerReadyMessage
