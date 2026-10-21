/**
 * Japanese Writing Toolkit — bounded nominalized-action guidance.
 *
 * "確認を実施する" may be more concise as "確認する", but applying a
 * mechanical replacement to "情報の確認を実施する" would create an
 * ungrammatical sentence. Emit explanatory diagnostics, never a replacement.
 */
import type { CoreRule, RawDiagnostic, RuleContext } from '../../types'

const ACTION_NOUNS = '確認|検討|調査|検証|分析|評価|測定|点検'
const ACTION_VERBS = '実施しました|実施します|実施する|実施した|行いました|行います|行った|行う'
const ENDINGS: Readonly<Record<string, string>> = {
  実施しました: 'しました',
  実施します: 'します',
  実施する: 'する',
  実施した: 'した',
  行いました: 'しました',
  行います: 'します',
  行った: 'した',
  行う: 'する'
}

// A kana suffix can be a continuation ("実施したい", "行ったら") rather
// than the completed form. Only explicitly recognized endings are reported.
const ACTION_PHRASE = new RegExp(
  `(${ACTION_NOUNS})を(${ACTION_VERBS})(?![ぁ-んァ-ン])`,
  'gu'
)

// Quoted examples/dialogue are not the author's current prose. Maintain the
// original UTF-16 length, including surrogate pairs, for accurate highlights.
function maskJapaneseQuotations(text: string): string {
  return text.replace(/「[^」]*(?:」|$)|『[^』]*(?:』|$)/gu, (quote) => '\uFFFF'.repeat(quote.length))
}

export const nominalizedActionRule: CoreRule = {
  id: 'wording/nominalized-action',
  category: 'wording',
  tier: 'fast',
  defaultSeverity: 'info',
  description:
    '「確認を実施する」「検討を行う」などの名詞＋動詞の回りくどい表現を限定的に検出し、簡潔な表現の検討を促します。助詞のつながりや意味を変えるおそれがあるため、自動置換は行いません。',
  run(ctx: RuleContext): RawDiagnostic[] {
    const results: RawDiagnostic[] = []
    const text = maskJapaneseQuotations(ctx.maskedText)
    const re = new RegExp(ACTION_PHRASE.source, ACTION_PHRASE.flags)
    for (const m of text.matchAll(re)) {
      const example = `${m[1]}${ENDINGS[m[2]!]}`
      results.push({
        start: m.index,
        end: m.index + m[0].length,
        message:
          `「${m[0]}」は「${example}」などの簡潔な表現を検討できます。ただし周辺の助詞や意味に合わせて文章全体を見直してください。`
      })
    }
    return results
  }
}
