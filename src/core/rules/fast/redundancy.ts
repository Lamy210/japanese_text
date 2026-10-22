/**
 * 冗長表現ルール — 仕様書 §3.1 (冗長表現)
 *
 * wording/redundancy: 決定論的な辞書ベースで冗長表現を検出する。
 * 明確に安全なもののみ Safe Fix。変更が文脈に依存する場合は診断のみ（Quick Fixなし）。
 */

import type { CoreRule, RawDiagnostic } from '../../types'
import { isMarkdownBlockquoteAt, maskHonorificQuotedExamples } from './honorific-utils'

type RedundancyEntry = {
  pattern: RegExp
  message: string
} & (
  | { fixKind: 'safe' | 'suggestion'; replacement: string }
  | { fixKind: 'none'; replacement?: never }
)

const ENTRIES: RedundancyEntry[] = [
  {
    pattern: /行なう/g,
    replacement: '行う',
    fixKind: 'safe',
    message: '「行なう」は「行う」の表記ゆれです。'
  },
  {
    pattern: /行ないます/g,
    replacement: '行います',
    fixKind: 'safe',
    message: '「行ないます」は「行います」の表記ゆれです。'
  },
  {
    pattern: /することができる/g,
    fixKind: 'none',
    message: '「することができる」は簡潔にできる場合があります。ただし「をする」などの目的語・動詞のつながりで必要な助詞が変わるため、文章全体を見直してください（直接の置換候補は出しません）。'
  },
  {
    pattern: /することができます/g,
    fixKind: 'none',
    message: '「することができます」は簡潔にできる場合があります。ただし「をする」などの目的語・動詞のつながりで必要な助詞が変わるため、文章全体を見直してください（直接の置換候補は出しません）。'
  },
  {
    pattern: /することが可能です/g,
    fixKind: 'none',
    message: '「することが可能です」は簡潔にできる場合があります。ただし目的語・動詞のつながりや意味に合わせて文章全体を見直してください（直接の置換候補は出しません）。'
  },
  {
    pattern: /致します/g,
    replacement: 'します',
    fixKind: 'suggestion',
    message: '「致します」は「します」で十分です (過剰な謙譲表現)。'
  },
  {
    pattern: /させていただきます/g,
    fixKind: 'none',
    message: '「させていただきます」は文脈によって冗長になる場合があります。動詞の活用・敬意・意味に合わせて文全体を見直してください（直接の置換候補は提示しません）。'
  },
  {
    pattern: /することが出来る/g,
    replacement: 'することができる',
    fixKind: 'safe',
    message: '「出来る」はひらがなの「できる」が一般的です。'
  },
  {
    pattern: /出来ます/g,
    replacement: 'できます',
    fixKind: 'safe',
    message: '「出来ます」はひらがなの「できます」が一般的です。'
  },
  {
    pattern: /色々/g,
    fixKind: 'none',
    message: '技術文書では「色々」の具体化や言い換えを検討できます。「さまざま」を使う場合も、後続の助詞・品詞を確認してください（直接の置換候補は提示しません）。'
  }
]

export const redundancyRule: CoreRule = {
  id: 'wording/redundancy',
  category: 'wording',
  tier: 'fast',
  description:
    '辞書ベースで冗長な表現を検出します。表記ゆれ（行なう/出来る）はSafe Fix、目的語や活用に依存する短縮は診断のみに限定します。日本語の引用例とMarkdown引用は対象外です。',
  defaultSeverity: 'info',
  run: (ctx): RawDiagnostic[] => {
    const results: RawDiagnostic[] = []
    const masked = maskHonorificQuotedExamples(ctx.maskedText)
    // A future dictionary expansion must not create multiple cards on
    // the exact same span. Keep overlapping but semantically distinct spans.
    const seenSpans = new Set<string>()
    for (const entry of ENTRIES) {
      const re = new RegExp(entry.pattern.source, entry.pattern.flags)
      let m: RegExpExecArray | null
      while ((m = re.exec(masked)) !== null) {
        if (isMarkdownBlockquoteAt(ctx, m.index)) continue
        const end = m.index + m[0].length
        const span = `${m.index}:${end}`
        if (seenSpans.has(span)) continue
        seenSpans.add(span)
        results.push({
          start: m.index,
          end,
          message: entry.message,
          fixKind: entry.fixKind,
          replacement: entry.replacement
        })
      }
    }
    return results.sort((a, b) => a.start - b.start || a.end - b.end)
  }
}
