/**
 * 全角英数字ルール — 仕様書 §3.1 (英数字表記)
 *
 * typography/alnum-width: 全角英数字 (ＡＢＣ１２３) を検出し、
 * 半角への変換を Safe Fix として提示する。
 */

import type { CoreRule, RawDiagnostic } from '../../types'

export const alnumWidthRule: CoreRule = {
  id: 'typography/alnum-width',
  category: 'typography',
  tier: 'fast',
  description:
    '全角英数字 (例: ＡＢＣ、１２３) を検出し、半角 (ABC, 123) への変換を Safe Fix として提示します。日本語文章では英数字は半角で統一するのが一般的です。コード・URL内は検査対象外です。',
  defaultSeverity: 'warning',
  run: (ctx): RawDiagnostic[] => {
    const results: RawDiagnostic[] = []
    const re = /[０-９Ａ-Ｚａ-ｚ]+/g
    let m: RegExpExecArray | null
    while ((m = re.exec(ctx.maskedText)) !== null) {
      const matched = m[0]
      // NFKC正規化で全角英数字は半角へ 1:1 対応する
      const converted = matched.normalize('NFKC')
      if (converted === matched) continue
      results.push({
        start: m.index,
        end: m.index + matched.length,
        message: `全角英数字「${matched}」が含まれています。半角「${converted}」に置き換えます。`,
        fixKind: 'safe',
        replacement: converted
      })
    }
    return results
  }
}
