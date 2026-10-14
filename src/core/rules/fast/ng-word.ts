/**
 * NGワードルール — 仕様書 §15
 *
 * wording/ng-word: ユーザー定義のNGワードを検出する。
 * 属性: word / severity / message / replacement / caseSensitive / wholeWord / isRegex (Advanced)
 * 不正な正規表現は例外を投げずにスキップする (§41: 個別ルールの例外で全体Lintを停止しない)。
 */

import type { CoreRule, RawDiagnostic, RuleContext, RuleSetting } from '../../types'
import type { NgWordEntry } from '../../config/schema'
import { escapeRegExp } from '../shared'

function buildNgWordRegex(entry: NgWordEntry): RegExp | null {
  if (entry.word.length === 0) return null
  let source: string
  if (entry.isRegex) {
    source = entry.word
  } else {
    source = escapeRegExp(entry.word)
  }
  if (entry.wholeWord) {
    // ASCII単語境界 (日本語には単語境界の概念がないためASCII文字のみ対象)
    source = `(?<![A-Za-z0-9_])${source}(?![A-Za-z0-9_])`
  }
  const flags = `g${entry.caseSensitive ? '' : 'i'}`
  try {
    return new RegExp(source, flags)
  } catch {
    // 不正な正規表現 → このエントリをスキップ (Config ErrorとしてUIで表示する想定)
    return null
  }
}

export function createNgWordRule(entries: () => NgWordEntry[]): CoreRule {
  return {
    id: 'wording/ng-word',
    category: 'wording',
    tier: 'fast',
    description:
      'ユーザーが登録したNGワード (禁止表現) を検出します。severity・メッセージ・置き換え語をエントリごとに設定できます。Advanced mode では正規表現を利用できます (不正な正規表現はスキップされます)。',
    defaultSeverity: 'error',
    run: (ctx: RuleContext, setting: RuleSetting): RawDiagnostic[] => {
      const results: RawDiagnostic[] = []
      for (const entry of entries()) {
        if (entry.word.length === 0) continue
        const re = buildNgWordRegex(entry)
        if (re === null) continue
        let m: RegExpExecArray | null
        while ((m = re.exec(ctx.maskedText)) !== null) {
          if (m[0].length === 0) {
            re.lastIndex++
            continue
          }
          // 置換結果が現在のテキストと同一なら不要 (冪等性担保)
          if (entry.replacement !== undefined && ctx.maskedText.slice(m.index, m.index + entry.replacement.length) === entry.replacement && entry.replacement.length === m[0].length) {
            continue
          }
          results.push({
            start: m.index,
            end: m.index + m[0].length,
            message:
              entry.message && entry.message.length > 0
                ? entry.message
                : `NGワード「${entry.word}」が含まれています。`,
            severity: entry.severity,
            fixKind: entry.replacement !== undefined && entry.replacement.length >= 0 ? 'safe' : 'none',
            replacement: entry.replacement
          })
        }
      }
      // rule自体のseverityはエントリ側が優先 (エントリにseverity必須 — §15)
      void setting
      return results
    }
  }
}
