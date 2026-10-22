/**
 * Bounded honorific request linting, not a general grammar parser.
 * Honorific requests depend on subject and communicative intent:
 * always offer explanatory hints rather than string replacement.
 *
 * Reference: Agency for Cultural Affairs, 敬語の指針 (依頼の言い方)
 * https://www.bunka.go.jp/seisaku/kokugo_nihongo/kokugo_shisaku/keigo/chapter3/detail.html
 */
import type { CoreRule, RawDiagnostic } from '../../types'
import { escapeRegExp } from '../shared'
import { isMarkdownBlockquoteAt, maskHonorificQuotedExamples } from './honorific-utils'

const EXAMPLES = [
  ['ご確認してください', 'ご確認ください'],
  ['ご連絡してください', 'ご連絡ください'],
  ['ご検討してください', 'ご検討ください'],
  ['ご回答してください', 'ご回答ください'],
  ['ご提出してください', 'ご提出ください'],
  ['ご参照してください', 'ご参照ください']
] as const

const alternatives = new Map<string, string>(EXAMPLES)
const phrases = [...alternatives.keys()].sort((a, b) => b.length - a.length)
const pattern = new RegExp(`(?:${phrases.map(escapeRegExp).join('|')})(?![ぁ-んァ-ン])`, 'gu')

export const honorificRequestRule: CoreRule = {
  id: 'wording/honorific-request',
  category: 'wording',
  tier: 'fast',
  defaultSeverity: 'info',
  description:
    '「ご確認してください」など依頼時の敬語表現について、限定した語形だけを見直し候補として案内します。文脈で適切な依頼表現は変わるため自動置換はしません。',
  run(ctx): RawDiagnostic[] {
    const text = maskHonorificQuotedExamples(ctx.maskedText)
    const results: RawDiagnostic[] = []
    for (const match of text.matchAll(pattern)) {
      if (isMarkdownBlockquoteAt(ctx, match.index)) continue
      const suggestion = alternatives.get(match[0])
      if (!suggestion) continue
      results.push({
        start: match.index,
        end: match.index + match[0].length,
        message: `「${match[0]}」は、依頼先の行為を表す場合「${suggestion}」などの表現を検討できます。誰の行為か、依頼の丁寧さに合わせて確認してください。`
      })
    }
    return results
  }
}
