/**
 * 設定スキーマ — 仕様書 §15 NGワード / §16 Terminology / §20 Citation / §27-28 保存 / §31 Preset / §32 Config Versioning
 *
 * 設定はSchema Versionを持ち、Import前にvalidation・migrationを通す (§30)。
 * 不正configによってApp全体を起動不能にしてはならない。
 */

import type { Severity } from '../types'

export const CONFIG_SCHEMA_VERSION = 1

export type PresetId = 'general' | 'technical' | 'strict' | 'minimal' | 'custom'
export type ThemeMode = 'light' | 'dark' | 'system'
export type CitationScope = 'sentence' | 'paragraph' | 'section'

/** NGワード1ルール — 仕様書 §15 */
export interface NgWordEntry {
  id: string
  word: string
  severity: Severity
  message?: string
  replacement?: string
  caseSensitive?: boolean
  wholeWord?: boolean
  /** Advanced mode: 正規表現 (ReDoS対策は将来検討 — §15) */
  isRegex?: boolean
}

/** 用語統一1ルール — 仕様書 §16 */
export interface TermEntry {
  id: string
  preferred: string
  rejected: string[]
  caseSensitive?: boolean
}

/** 引用判定ポリシー — 仕様書 §19/20 */
export interface CitationPolicy {
  scope: CitationScope
  detectNumbers: boolean
  detectComparison: boolean
  detectExternalFact: boolean
}

export interface FormatterPolicy {
  /** Format Document の有効/無効 */
  enabled: boolean
}

export interface EditorPreferences {
  fontSize: number
  showLineNumbers: boolean
}

export interface PrivacyPolicy {
  /** 自動保存 (ONでIndexedDBへ本文保存) — §28 */
  autoSave: boolean
  /** プライバシーモード (本文をIndexedDBへ保存しない、設定のみ保存) — §28 */
  privacyMode: boolean
}

export interface AppConfig {
  schemaVersion: number
  preset: PresetId
  /** ruleId → 設定 (仕様書 §3.1: ルールON/OFF, severity変更) */
  rules: Record<string, import('../types').RuleSetting>
  ngWords: NgWordEntry[]
  terminology: TermEntry[]
  citation: CitationPolicy
  formatter: FormatterPolicy
  editor: EditorPreferences
  privacy: PrivacyPolicy
  theme: ThemeMode
}

/** 新規エントリ用ID生成 (決定論的・一意) */
export function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export const DEFAULT_CITATION: CitationPolicy = {
  scope: 'paragraph',
  detectNumbers: true,
  detectComparison: true,
  detectExternalFact: true
}

export const DEFAULT_EDITOR: EditorPreferences = {
  fontSize: 15,
  showLineNumbers: true
}

export const DEFAULT_PRIVACY: PrivacyPolicy = {
  autoSave: true,
  privacyMode: false
}

/** 内蔵デフォルト用語集 (Technical Writing 向けの標準的な表記統一) */
export const DEFAULT_TERMINOLOGY: TermEntry[] = [
  {
    id: 'term-github',
    preferred: 'GitHub',
    rejected: ['Github', 'github', 'GITHUB'],
    caseSensitive: true
  },
  {
    id: 'term-javascript',
    preferred: 'JavaScript',
    rejected: ['Javascript', 'javascript'],
    caseSensitive: true
  },
  {
    id: 'term-typescript',
    preferred: 'TypeScript',
    rejected: ['Typescript', 'typescript'],
    caseSensitive: true
  },
  {
    id: 'term-nodejs',
    preferred: 'Node.js',
    rejected: ['NodeJS', 'node.js', 'Node Js'],
    caseSensitive: true
  },
  {
    id: 'term-docker',
    preferred: 'Docker',
    rejected: ['docker'],
    caseSensitive: true
  },
  {
    id: 'term-user',
    preferred: 'ユーザー',
    rejected: ['ユーザ'],
    caseSensitive: false
  },
  {
    id: 'term-server',
    preferred: 'サーバー',
    rejected: ['サーバ'],
    caseSensitive: false
  },
  {
    id: 'term-browser',
    preferred: 'ブラウザー',
    rejected: ['ブラウザ'],
    caseSensitive: false
  },
  {
    id: 'term-computer',
    preferred: 'コンピューター',
    rejected: ['コンピュータ'],
    caseSensitive: false
  }
]
