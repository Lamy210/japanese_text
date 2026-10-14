/**
 * 曖昧表現ルール — 仕様書 §3.1 (一部の曖昧表現)
 *
 * wording/ambiguity: 技術文書で信頼性を損なう曖昧表現を検出する (Diagnostic Only)。
 * 「一部の」曖昧表現のみを対象とし、誤検出を避けるため確度の高い語のみ収録。
 */

import type { CoreRule, RawDiagnostic } from '../../types'

const AMBIGUOUS_PHRASES: ReadonlyArray<{ pattern: RegExp; note: string }> = [
  { pattern: /と思われます/g, note: '断定を避けた表現です。判断根拠を示すか、断定表現を検討してください。' },
  { pattern: /かもしれません/g, note: '曖昧な推量です。確度を示す語 (多くの場合、〜等) に置き換えを検討してください。' },
  { pattern: /かもしれない/g, note: '曖昧な推量です。確度を示す語に置き換えを検討してください。' },
  { pattern: /かも知れない/g, note: '曖昧な推量です。「かもしれません」と表記するか、確度を明示してください。' },
  { pattern: /おそらく/g, note: '曖昧な推量です。根拠を示した上で判断を記述してください。' },
  { pattern: /ある程度/g, note: '程度が不明確です。具体的な数値・範囲の記述を推奨します。' },
  { pattern: /なるべく/g, note: '基準が不明確です。具体的な条件・数値の記述を推奨します。' },
  { pattern: /できるだけ/g, note: '基準が不明確です。具体的な条件・数値の記述を推奨します。' },
  { pattern: /ある意味/g, note: 'どの意味か不明確です。具体的な観点を記述することを推奨します。' },
  { pattern: /数多くの/g, note: '規模が不明確です。具体的な数値の記述を推奨します。' },
  { pattern: /大量の/g, note: '規模が不明確です。具体的な数値の記述を推奨します。' }
]

export const ambiguityRule: CoreRule = {
  id: 'wording/ambiguity',
  category: 'wording',
  tier: 'fast',
  description:
    '技術文書の信頼性を損なう曖昧表現 (と思われます、かもしれません、ある程度、なるべく等) を検出します。誤検出を避けるため、確度の高い語のみを対象としています。自動修正は行いません。',
  defaultSeverity: 'info',
  run: (ctx): RawDiagnostic[] => {
    const results: RawDiagnostic[] = []
    for (const phrase of AMBIGUOUS_PHRASES) {
      const re = new RegExp(phrase.pattern.source, phrase.pattern.flags)
      let m: RegExpExecArray | null
      while ((m = re.exec(ctx.maskedText)) !== null) {
        results.push({
          start: m.index,
          end: m.index + m[0].length,
          message: `曖昧な表現「${m[0]}」: ${phrase.note}`
        })
      }
    }
    return results
  }
}
