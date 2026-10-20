import type { CoreRule } from '../../types'
import type { RuleManifest, RuleProvider } from './types'

export const TEXTLINT_RULE_IDS = ['style/sentence-length', 'typography/nfd', 'typography/hankaku-kana'] as const

/** Preserved compatibility metadata for the existing textlint adapter/config. */
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

const metadata: RuleManifest[] = TEXTLINT_RULE_IDS.map((id) => {
  const rule = TEXTLINT_RULE_META[id]!
  return {
    id,
    providerId: 'textlint',
    source: 'textlint',
    category: id.startsWith('style/') ? 'style' : 'typography',
    tier: 'deep',
    description: rule.description,
    defaultSeverity: rule.defaultSeverity,
    ...(rule.optionDefs === undefined ? {} : { optionDefs: structuredClone(rule.optionDefs) })
  }
})

/** Textlint is still executed by the deep adapter, not as a CoreRule. */
export const textlintRuleProvider: RuleProvider = {
  id: 'textlint',
  listManifests: () => metadata.map((item) => structuredClone(item)),
  createRules: () => []
}
