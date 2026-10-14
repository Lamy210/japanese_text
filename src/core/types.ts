/**
 * Core型定義 — 仕様書 §12 Diagnosticデータ仕様 / §13 Severity / §14 Rule ID
 *
 * この層はUIフレームワーク (SolidJS) / Editor (CodeMirror) / Storage (IndexedDB) に
 * 依存させてはならない (仕様書 §55 アーキテクチャ上の境界)。
 */

/** 重大度 — 仕様書 §13: Info=改善候補 / Warning=確認推奨 / Error=ルール違反 */
export type Severity = 'info' | 'warning' | 'error'

/** 修正種別 — 仕様書 §17: Safe Fix=自動整形対象 / Suggestion=Quick Fixのみ / none=診断のみ */
export type FixKind = 'none' | 'safe' | 'suggestion'

/** 診断の発生元 — 仕様書 §12 source属性 */
export type DiagnosticSource = 'core' | 'textlint' | 'user'

/** 診断1件 — 仕様書 §12 */
export interface Diagnostic {
  /** 一意識別子（決定論的に生成: ruleId + 位置 + 出現序数） */
  id: string
  /** 発生元ルール (namespace形式, 仕様書 §14) */
  ruleId: string
  severity: Severity
  message: string
  /** 開始offset (UTF-16 code unit, 0-origin) */
  start: number
  /** 終了offset (exclusive) */
  end: number
  /** 行 (1-origin) */
  line: number
  /** 列 (1-origin) */
  column: number
  fixKind: FixKind
  /** 修正候補テキスト ([start, end) を置換する文字列) */
  replacement?: string
  /** ルール説明 (Explainability要件, 仕様書 §36) */
  documentation?: string
  source: DiagnosticSource
}

/** ルールが返す生の診断 (行・列はEngineが計算する) */
export interface RawDiagnostic {
  start: number
  end: number
  message: string
  severity?: Severity
  fixKind?: FixKind
  replacement?: string
}

export type RuleTier = 'fast' | 'deep' | 'idle'
export type RuleCategory = 'style' | 'typography' | 'wording' | 'evidence' | 'reference' | 'markdown'

/** ルール設定 — 仕様書 §3.1 Settings (ルールON/OFF, severity変更) */
export interface RuleSetting {
  enabled: boolean
  severity: Severity
  /** ルール個別オプション (例: sentence-length の max) */
  options?: Record<string, string | number | boolean>
}

/** 設定ダイアログ向けルールオプション定義 */
export interface RuleOptionDef {
  key: string
  type: 'number' | 'boolean'
  label: string
  defaultValue: number | boolean
  min?: number
  max?: number
}

/** ルール実行コンテキスト (解析対象文書の事前計算済みビュー) */
export interface RuleContext {
  /** 元テキスト (改行は \n に正規化済み) */
  text: string
  /** コード・URL・メタデータをマスク済みの同一長テキスト */
  maskedText: string
  /** マスク領域 */
  maskRegions: MaskRegion[]
  /** 元テキストの行配列 */
  lines: string[]
  /** 行開始offset (lineStarts[i] = i+1行目の開始offset) */
  lineStarts: number[]
}

export interface MaskRegion {
  start: number
  end: number
  kind: 'code' | 'url' | 'metadata'
}

export interface CoreRule {
  /** namespace形式のRule ID (仕様書 §14, 公開後は変更しない) */
  id: string
  category: RuleCategory
  tier: RuleTier
  /** ルール説明 (設定UI・Diagnostic詳細に表示) */
  description: string
  defaultSeverity: Severity
  /** 設定UIに表示するオプション */
  optionDefs?: RuleOptionDef[]
  run: (ctx: RuleContext, setting: RuleSetting) => RawDiagnostic[]
}

/** ルール実行エラー (個別ルールの例外で全体Lintを停止させない — 仕様書 §41) */
export interface RuleError {
  ruleId: string
  message: string
}

export type DocumentType = 'markdown' | 'text'
