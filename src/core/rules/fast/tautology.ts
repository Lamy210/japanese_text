/**
 * Informational style guidance for a small, curated set of potentially
 * redundant expressions. Such phrasing can be intentional emphasis, so
 * diagnostics MUST NOT offer automatic or direct substring replacements.
 */
import type { CoreRule, RawDiagnostic } from '../../types'
import { escapeRegExp } from '../shared'
import { isMarkdownBlockquoteAt, maskHonorificQuotedExamples } from './honorific-utils'

const EXAMPLES = [
  ['まず最初に', 'まず'],
  ['あらかじめ事前に', '事前に'],
  ['一番最初に', '最初に'],
  ['今現在', '現在'],
  ['各々それぞれ', 'それぞれ']
] as const

const alternative = new Map<string, string>(EXAMPLES)
const phrases = [...alternative.keys()].sort((a, b) => b.length - a.length)
const pattern = new RegExp(phrases.map(escapeRegExp).join('|'), 'gu')

export const tautologyRule: CoreRule = {
  id: 'wording/tautology',
  category: 'wording',
  tier: 'fast',
  defaultSeverity: 'info',
  description:
    '「まず最初に」など限定的な意味の重なりを検出し、簡潔化の検討を案内します。強調として適切な場合もあるため、文法の誤りと断定せず自動置換もしません。',
  run(ctx): RawDiagnostic[] {
    const text = maskHonorificQuotedExamples(ctx.maskedText)
    const results: RawDiagnostic[] = []
    for (const m of text.matchAll(pattern)) {
      if (isMarkdownBlockquoteAt(ctx, m.index)) continue
      const example = alternative.get(m[0])
      if (!example) continue
      results.push({
        start: m.index,
        end: m.index + m[0].length,
        message: `「${m[0]}」は意味が重なる可能性があります。「${example}」などの簡潔な表現を検討してください。強調の意図がある場合はそのままでも構いません。`
      })
    }
    return results
  }
}
