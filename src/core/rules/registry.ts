/**
 * Rule Registry — 仕様書 §14 (Rule IDはnamespace形式) / §23 (Fast/Deep 2層Engine)
 *
 * Fast Engine: 独自実装 (高速・正規表現・辞書ベース)
 * Deep Engine: textlint (別adapter) + 独自の文書構造解析ルール
 * Idle Tier:   document-wide解析
 */

import type { CoreRule } from '../types'
import type { AppConfig } from '../config/schema'

import { fullWidthSpaceRule, unnecessarySpaceRule } from './fast/whitespace'
import { punctuationRule } from './fast/punctuation'
import { bracketsRule } from './fast/brackets'
import { alnumWidthRule } from './fast/alnum-width'
import { createNgWordRule } from './fast/ng-word'
import { createTerminologyRule } from './fast/terminology'
import { redundancyRule } from './fast/redundancy'
import { doubleHonorificRule } from './fast/double-honorific'
import { ambiguityRule } from './fast/ambiguity'
import { commaCountRule } from './deep/comma-count'
import { mixedToneRule } from './fast/mixed-tone'
import { crossParagraphToneRule } from './fast/cross-paragraph-tone'
import { headingOrderRule } from './markdown/heading-order'
import {
  createCitationNumberRule,
  createCitationComparisonRule,
  createCitationExternalFactRule
} from './citation/citation-detector'
import {
  referenceUndefinedRule,
  referenceEmptyUrlRule,
  referenceMalformedUrlRule,
  referenceBrokenAnchorRule,
  referenceDuplicateIdRule,
  referenceUnusedRule,
  referenceDuplicateAnchorRule
} from './reference/markdown-reference'

export const TEXTLINT_RULE_IDS = ['style/sentence-length', 'typography/nfd', 'typography/hankaku-kana'] as const

/** textlintルールのメタ情報 (説明・オプション) — adapterと設定UIで共有 */
export const TEXTLINT_RULE_META: Record<
  string,
  { description: string; defaultSeverity: 'info' | 'warning' | 'error'; optionDefs?: CoreRule['optionDefs'] }
> = {
  'style/sentence-length': {
    description:
      '一文が長すぎる場合に検出します (textlint-rule-sentence-length)。長い文は読みやすさを損なうため、句点での分割を検討してください。上限は設定から変更できます (デフォルト: 100文字)。',
    defaultSeverity: 'warning',
    optionDefs: [{ key: 'max', type: 'number', label: '一文の最大文字数', defaultValue: 100, min: 10, max: 1000 }]
  },
  'typography/nfd': {
    description:
      'NFD正規化された文字 (濁点が分解された文字) を検出します (textlint-rule-no-nfd)。OS間のコピペで混入することがあります。',
    defaultSeverity: 'error'
  },
  'typography/hankaku-kana': {
    description: '半角カタカナを検出します (textlint-rule-no-hankaku-kana)。日本語文書では全角カタカナが標準です。',
    defaultSeverity: 'warning'
  }
}

/** 設定から全ルールのレジストリを構築する (決定論的) */
export function buildRuleRegistry(config: AppConfig): Map<string, CoreRule> {
  const rules: CoreRule[] = [
    // Fast Engine (独自)
    fullWidthSpaceRule,
    unnecessarySpaceRule,
    punctuationRule,
    bracketsRule,
    alnumWidthRule,
    createNgWordRule(() => config.ngWords),
    createTerminologyRule(() => config.terminology),
    redundancyRule,
    doubleHonorificRule,
    ambiguityRule,
    mixedToneRule,
    crossParagraphToneRule,
    // Deep Engine (独自)
    commaCountRule,
    headingOrderRule,
    createCitationNumberRule(() => config.citation),
    createCitationComparisonRule(() => config.citation),
    createCitationExternalFactRule(() => config.citation),
    referenceUndefinedRule,
    referenceEmptyUrlRule,
    referenceMalformedUrlRule,
    referenceBrokenAnchorRule,
    referenceDuplicateIdRule,
    // Idle Tier (document-wide)
    referenceUnusedRule,
    referenceDuplicateAnchorRule
  ]

  const map = new Map<string, CoreRule>()
  for (const rule of rules) {
    map.set(rule.id, rule)
  }
  return map
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
