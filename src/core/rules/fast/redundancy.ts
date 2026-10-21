/**
 * 冗長表現ルール — 仕様書 §3.1 (冗長表現)
 *
 * wording/redundancy: 決定論的な辞書ベースで冗長表現を検出する。
 * 明確に安全なもののみ Safe Fix、それ以外は Suggestion。
 */

import type { CoreRule, RawDiagnostic } from '../../types'

interface RedundancyEntry {
  pattern: RegExp
  replacement?: string
  fixKind: 'safe' | 'suggestion' | 'none'
  message: string
}

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
    replacement: 'できる',
    fixKind: 'suggestion',
    message: '「することができる」は「できる」と簡潔にできます (動詞の名詞形+するの場合)。'
  },
  {
    pattern: /することができます/g,
    replacement: 'できます',
    fixKind: 'suggestion',
    message: '「することができます」は「できます」と簡潔にできます (動詞の名詞形+するの場合)。'
  },
  {
    pattern: /することが可能です/g,
    replacement: 'できます',
    fixKind: 'suggestion',
    message: '「することが可能です」は「できます」と簡潔にできます。'
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
    '辞書ベースで冗長な表現を検出します (例: 「〜することができる」→「〜できる」、「致します」→「します」)。表記ゆれ (行なう/出来る) は Safe Fix、意味が変わる可能性のあるものは Suggestion として提示します。',
  defaultSeverity: 'info',
  run: (ctx): RawDiagnostic[] => {
    const results: RawDiagnostic[] = []
    for (const entry of ENTRIES) {
      const re = new RegExp(entry.pattern.source, entry.pattern.flags)
      let m: RegExpExecArray | null
      while ((m = re.exec(ctx.maskedText)) !== null) {
        results.push({
          start: m.index,
          end: m.index + m[0].length,
          message: entry.message,
          fixKind: entry.fixKind,
          replacement: entry.replacement
        })
      }
    }
    return results
  }
}
