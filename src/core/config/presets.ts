/**
 * Built-in Preset — 仕様書 §31
 *
 * - General Japanese    : 一般文章
 * - Technical Writing   : README・仕様書・設計書向け
 * - Strict Technical    : CI利用を想定した厳格設定
 * - Minimal             : 明確な問題だけ検出
 * - Custom              : ユーザー設定
 */

import type { RuleSetting, Severity } from '../types'
import type { AppConfig, PresetId } from './schema'

type RuleSpec = string | [ruleId: string, severity: Severity] | [ruleId: string, severity: Severity, options: Record<string, string | number | boolean>]

function spec(setting: RuleSpec): RuleSetting {
  if (typeof setting === 'string') {
    return { enabled: true, severity: 'warning' }
  }
  const [, severity, options] = setting
  return options === undefined ? { enabled: true, severity } : { enabled: true, severity, options }
}

function rules(...specs: RuleSpec[]): Record<string, RuleSetting> {
  const out: Record<string, RuleSetting> = {}
  for (const s of specs) {
    out[typeof s === 'string' ? s : s[0]] = spec(s)
  }
  return out
}

export interface PresetDefinition {
  id: PresetId
  label: string
  description: string
  rules: Record<string, RuleSetting>
  citation: AppConfig['citation']
}

export const BUILTIN_PRESETS: PresetDefinition[] = [
  {
    id: 'general',
    label: 'General Japanese',
    description: '一般日本語文章向けの標準設定。読みやすさを優先し、出典ルールは情報レベルです。',
    rules: rules(
      'typography/full-width-space',
      'typography/unnecessary-space',
      'typography/punctuation',
      ['typography/brackets', 'warning'],
      'typography/alnum-width',
      ['wording/terminology', 'warning'],
      ['wording/redundancy', 'info'],
      ['wording/nominalized-action', 'info'],
      ['wording/repeated-phrase', 'info'],
      ['wording/double-honorific', 'info'],
      ['wording/ambiguity', 'info'],
      ['style/sentence-length', 'warning', { max: 100 }],
      ['style/comma-count', 'warning', { max: 4 }],
      ['style/mixed-tone', 'warning'],
      ['style/cross-paragraph-tone', 'info'],
      ['style/consecutive-conjunction', 'info'],
      ['style/additive-conjunction-density', 'info'],
      ['typography/nfd', 'error'],
      ['typography/hankaku-kana', 'warning'],
      ['evidence/citation-number', 'info'],
      ['evidence/citation-comparison', 'info'],
      ['evidence/citation-external-fact', 'info'],
      ['reference/undefined', 'error'],
      ['reference/empty-url', 'error'],
      ['reference/malformed-url', 'error'],
      ['reference/broken-anchor', 'warning'],
      ['reference/duplicate-id', 'warning'],
      ['reference/unused', 'info'],
      ['reference/duplicate-anchor', 'warning'],
      ['markdown/heading-order', 'warning']
    ),
    citation: { scope: 'paragraph', detectNumbers: true, detectComparison: true, detectExternalFact: true }
  },
  {
    id: 'technical',
    label: 'Technical Writing',
    description:
      'README・技術仕様書・設計書向け。一文は短く、出典の明記を推奨します。根拠のない性能主張は警告になります。',
    rules: rules(
      'typography/full-width-space',
      'typography/unnecessary-space',
      'typography/punctuation',
      ['typography/brackets', 'warning'],
      'typography/alnum-width',
      ['wording/terminology', 'warning'],
      ['wording/redundancy', 'warning'],
      ['wording/nominalized-action', 'info'],
      ['wording/repeated-phrase', 'info'],
      ['wording/double-honorific', 'info'],
      ['wording/ambiguity', 'warning'],
      ['style/sentence-length', 'warning', { max: 80 }],
      ['style/comma-count', 'warning', { max: 3 }],
      ['style/mixed-tone', 'warning'],
      ['style/cross-paragraph-tone', 'info'],
      ['style/consecutive-conjunction', 'info'],
      ['style/additive-conjunction-density', 'info'],
      ['typography/nfd', 'error'],
      ['typography/hankaku-kana', 'error'],
      ['evidence/citation-number', 'warning'],
      ['evidence/citation-comparison', 'warning'],
      ['evidence/citation-external-fact', 'warning'],
      ['reference/undefined', 'error'],
      ['reference/empty-url', 'error'],
      ['reference/malformed-url', 'error'],
      ['reference/broken-anchor', 'warning'],
      ['reference/duplicate-id', 'warning'],
      ['reference/unused', 'info'],
      ['reference/duplicate-anchor', 'warning'],
      ['markdown/heading-order', 'warning']
    ),
    citation: { scope: 'paragraph', detectNumbers: true, detectComparison: true, detectExternalFact: true }
  },
  {
    id: 'strict',
    label: 'Strict Technical',
    description:
      'CI利用を想定した厳格設定。将来のCLI/CI版ではerrorがexit code非0の対象になります (§13)。',
    rules: rules(
      ['typography/full-width-space', 'error'],
      ['typography/unnecessary-space', 'error'],
      ['typography/punctuation', 'error'],
      ['typography/brackets', 'error'],
      ['typography/alnum-width', 'error'],
      ['wording/terminology', 'error'],
      ['wording/redundancy', 'warning'],
      ['wording/nominalized-action', 'info'],
      ['wording/repeated-phrase', 'warning'],
      ['wording/double-honorific', 'warning'],
      ['wording/ambiguity', 'warning'],
      ['style/sentence-length', 'error', { max: 60 }],
      ['style/comma-count', 'warning', { max: 3 }],
      ['style/mixed-tone', 'error'],
      ['style/cross-paragraph-tone', 'warning'],
      ['style/consecutive-conjunction', 'warning'],
      ['style/additive-conjunction-density', 'info'],
      ['typography/nfd', 'error'],
      ['typography/hankaku-kana', 'error'],
      ['evidence/citation-number', 'warning'],
      ['evidence/citation-comparison', 'warning'],
      ['evidence/citation-external-fact', 'warning'],
      ['reference/undefined', 'error'],
      ['reference/empty-url', 'error'],
      ['reference/malformed-url', 'error'],
      ['reference/broken-anchor', 'error'],
      ['reference/duplicate-id', 'error'],
      ['reference/unused', 'warning'],
      ['reference/duplicate-anchor', 'error'],
      ['markdown/heading-order', 'error']
    ),
    citation: { scope: 'paragraph', detectNumbers: true, detectComparison: true, detectExternalFact: true }
  },
  {
    id: 'minimal',
    label: 'Minimal',
    description: '明確な問題 (壊れた参照・表記の誤り・空白) だけを検出します。ヒューリスティック系ルールは無効です。',
    rules: rules(
      'typography/full-width-space',
      'typography/unnecessary-space',
      'typography/punctuation',
      'typography/alnum-width',
      ['wording/terminology', 'warning'],
      ['typography/nfd', 'error'],
      ['typography/hankaku-kana', 'warning'],
      ['reference/undefined', 'error'],
      ['reference/empty-url', 'error'],
      ['reference/malformed-url', 'error'],
      ['reference/broken-anchor', 'warning'],
      ['reference/duplicate-id', 'warning'],
      ['markdown/heading-order', 'warning']
    ),
    citation: { scope: 'paragraph', detectNumbers: false, detectComparison: false, detectExternalFact: false }
  }
]

export function getPreset(id: PresetId): PresetDefinition | undefined {
  return BUILTIN_PRESETS.find((p) => p.id === id)
}

export const PRESET_LABELS: Record<PresetId, string> = {
  general: 'General Japanese',
  technical: 'Technical Writing',
  strict: 'Strict Technical',
  minimal: 'Minimal',
  custom: 'Custom'
}
