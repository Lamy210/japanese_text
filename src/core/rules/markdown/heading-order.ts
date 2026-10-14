/**
 * 見出し順序ルール — 仕様書 §14 (markdown/heading-order)
 *
 * Markdown見出しのレベルスキップ (例: # → ###) を検出する。
 * コードブロック内の「#」はマスク済みのため検査対象外。
 */

import type { CoreRule, RawDiagnostic } from '../../types'

export const headingOrderRule: CoreRule = {
  id: 'markdown/heading-order',
  category: 'markdown',
  tier: 'deep',
  description:
    'Markdown見出しのレベルスキップを検出します (例: h1 の直後に h3)。階層を1つずつ下げることでアウトライン構造が正しく保持されます。コードブロック内の # は対象外です。',
  defaultSeverity: 'warning',
  run: (ctx): RawDiagnostic[] => {
    const results: RawDiagnostic[] = []
    let prevLevel = 0

    for (let i = 0; i < ctx.lines.length; i++) {
      const rawLine = ctx.lines[i]
      const lineStart = ctx.lineStarts[i]
      // マスク済み (コードブロック等) の行は対象外
      if (ctx.maskedText[lineStart] === '\uFFFF') continue
      const m = /^ {0,3}(#{1,6})\s+(.*)$/.exec(rawLine)
      if (m === null) continue
      const level = m[1].length
      if (prevLevel > 0 && level > prevLevel + 1) {
        results.push({
          start: lineStart,
          end: lineStart + rawLine.length,
          message: `見出しレベルがスキップされています (h${prevLevel} → h${level})。階層は1つずつ下げてください。`
        })
      }
      prevLevel = level
    }
    return results
  }
}
