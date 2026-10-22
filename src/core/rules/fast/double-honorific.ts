/**
 * Bounded, opt-in honorific expression linting (no morphology model).
 *
 * Only explicit dictionaries are matched. Never auto-format these findings:
 * honorific choices may require human judgment in context.
 *
 * Reference: Agency for Cultural Affairs, 敬語の指針, 二重敬語:
 * https://www.bunka.go.jp/seisaku/kokugo_nihongo/kokugo_shisaku/keigo/chapter4/detail.html
 */
import type { CoreRule, RawDiagnostic } from '../../types'
import { escapeRegExp } from '../shared'
import { isMarkdownBlockquoteAt, maskHonorificQuotedExamples } from './honorific-utils'

const EXAMPLES = [
  ['お読みになられました', 'お読みになりました'],
  ['お読みになられます', 'お読みになります'],
  ['お読みになられる', 'お読みになる'],
  ['ご覧になられました', 'ご覧になりました'],
  ['ご覧になられます', 'ご覧になります'],
  ['ご覧になられる', 'ご覧になる'],
  ['おっしゃられました', 'おっしゃいました'],
  ['おっしゃられます', 'おっしゃいます'],
  ['おっしゃられる', 'おっしゃる']
] as const

const replacementByPhrase = new Map<string, string>(EXAMPLES)
const orderedPhrases = [...replacementByPhrase.keys()].sort((a, b) => b.length - a.length || a.localeCompare(b))
const pattern = new RegExp(orderedPhrases.map(escapeRegExp).join('|'), 'g')

export const doubleHonorificRule: CoreRule = {
  id: 'wording/double-honorific',
  category: 'wording',
  tier: 'fast',
  description:
    '特定の二重敬語（例:「お読みになられる」）を検出します。文化庁の敬語指針に基づく限定的な辞書判定であり、文脈による適否は判断しません。修正候補は提案のみで自動整形しません。',
  defaultSeverity: 'info',
  run: (ctx): RawDiagnostic[] => {
    const results: RawDiagnostic[] = []
    const text = maskHonorificQuotedExamples(ctx.maskedText)
    const regex = new RegExp(pattern.source, pattern.flags)
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      if (isMarkdownBlockquoteAt(ctx, match.index)) continue
      const replacement = replacementByPhrase.get(match[0])
      if (replacement === undefined) continue
      results.push({
        start: match.index,
        end: match.index + match[0].length,
        message: `「${match[0]}」は二重敬語の可能性があります。「${replacement}」などへの言い換えをご検討ください。`,
        fixKind: 'suggestion',
        replacement
      })
    }
    return results
  }
}
