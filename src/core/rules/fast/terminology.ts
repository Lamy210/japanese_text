/**
 * 用語統一ルール — 仕様書 §16 Terminology / 表記ゆれ・推奨表現・用語統一
 *
 * wording/terminology: 同一概念に対する表記の統一を検査する。
 * Rejected表記が検出された場合は Preferred表記を Safe Fix として提示する。
 */

import type { CoreRule, RawDiagnostic, RuleContext } from '../../types'
import type { TermEntry } from '../../config/schema'
import { escapeRegExp } from '../shared'

/**
 * A user term may be an entire identifier or Katakana product name.
 * Do not apply a Safe Fix to a matching fragment inside a longer token.
 * Deliberately conservative: prefer a missed suggestion to corrupting a name.
 */
const ASCII_TOKEN = /[A-Za-z0-9_]/u
const KATAKANA_TOKEN = /[\\u30A0-\\u30FF\\u31F0-\\u31FFーA-Za-z0-9_]/u
const KATAKANA = /[\\u30A0-\\u30FF\\u31F0-\\u31FFー]/u

function isPartOfLongerToken(text: string, start: number, match: string): boolean {
  const left = start > 0 ? text[start - 1]! : ''
  const right = text[start + match.length] ?? ''
  const first = match[0] ?? ''
  const last = match[match.length - 1] ?? ''
  if (ASCII_TOKEN.test(first) && ASCII_TOKEN.test(left)) return true
  if (ASCII_TOKEN.test(last) && ASCII_TOKEN.test(right)) return true
  if (KATAKANA.test(first) && KATAKANA_TOKEN.test(left)) return true
  if (KATAKANA.test(last) && KATAKANA_TOKEN.test(right)) return true
  return false
}

export function createTerminologyRule(entries: () => TermEntry[]): CoreRule {
  return {
    id: 'wording/terminology',
    category: 'wording',
    tier: 'fast',
    description:
      '同一概念に対する表記ゆれを検出し、Preferred表記への統一を Safe Fix として提示します (例: Github/github → GitHub、ユーザ → ユーザー)。デフォルトの用語集は設定から編集できます。コード・URL内は検査対象外です。',
    defaultSeverity: 'warning',
    run: (ctx: RuleContext): RawDiagnostic[] => {
      const results: RawDiagnostic[] = []
      for (const entry of entries()) {
        if (entry.preferred.length === 0) continue
        for (const rejected of entry.rejected) {
          if (rejected.length === 0 || rejected === entry.preferred) continue
          const caseSensitive = entry.caseSensitive ?? true
          const re = new RegExp(escapeRegExp(rejected), `g${caseSensitive ? '' : 'i'}`)
          let m: RegExpExecArray | null
          while ((m = re.exec(ctx.maskedText)) !== null) {
            if (isPartOfLongerToken(ctx.maskedText, m.index, m[0])) continue
            // すでにPreferred表記になっている位置はスキップ
            // (例: rejected=ユーザ は preferred=ユーザー の一部に誤一致する)
            if (ctx.maskedText.slice(m.index, m.index + entry.preferred.length) === entry.preferred) {
              continue
            }
            // 置換結果が現在のテキストと同一なら不要 (冪等性担保)
            if (
              ctx.maskedText.slice(m.index, m.index + m[0].length) === entry.preferred &&
              entry.preferred.length === m[0].length
            ) {
              continue
            }
            results.push({
              start: m.index,
              end: m.index + m[0].length,
              message: `表記ゆれ: 「${m[0]}」は「${entry.preferred}」が推奨表記です。`,
              fixKind: 'safe',
              replacement: entry.preferred
            })
          }
        }
      }
      return results
    }
  }
}
