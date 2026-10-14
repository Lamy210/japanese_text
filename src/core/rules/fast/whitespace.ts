/**
 * 空白関連ルール — 仕様書 §3.1 (不要スペース / 全角スペース), §17 (Safe Fix対象)
 *
 * - typography/full-width-space: 全角スペース(U+3000) → 半角スペース (Safe Fix)
 * - typography/unnecessary-space: 不要な半角スペースの削除 (Safe Fix)
 */

import type { CoreRule, RawDiagnostic } from '../../types'
import { JP, JP_CLASS } from '../shared'

/** 全角スペース検出 — マスク済みテキスト上で U+3000 を探す (コード・URL内は自動的に除外)
 *
 * 日本語文字に挟まれた全角スペースは typography/unnecessary-space が「削除」として処理するため、
 * このルールでは対象外とする (Formatの冪等性 §50 を担保するための協調動作)。 */
export const fullWidthSpaceRule: CoreRule = {
  id: 'typography/full-width-space',
  category: 'typography',
  tier: 'fast',
  description:
    '文章中の全角スペース(U+3000)を検出します。半角スペースへの置き換えをSafe Fixとして提示します。日本語文字に挟まれた全角スペースは「不要スペース」ルールによる削除が優先されます。コードブロック・インラインコード・URL内は検査対象外です。',
  defaultSeverity: 'warning',
  run: (ctx): RawDiagnostic[] => {
    const results: RawDiagnostic[] = []
    const re = /\u3000/g
    const cjkNeighbor = new RegExp(`[${JP}]`)
    let m: RegExpExecArray | null
    while ((m = re.exec(ctx.maskedText)) !== null) {
      const prev = ctx.maskedText[m.index - 1] ?? ''
      const next = ctx.maskedText[m.index + 1] ?? ''
      // 両隣が日本語文字の場合は unnecessary-space が削除として処理する
      if (prev !== '' && next !== '' && cjkNeighbor.test(prev) && cjkNeighbor.test(next)) continue
      results.push({
        start: m.index,
        end: m.index + 1,
        message: '全角スペースが含まれています。半角スペースに置き換えます。',
        fixKind: 'safe',
        replacement: ' '
      })
    }
    return results
  }
}

/**
 * 不要スペース検出:
 * - 日本語文字に挟まれたスペース
 * - 句読点・閉じ括弧の前のスペース
 * - 開き括弧の直後のスペース
 * - 行末の単一スペース (Markdownのhard breakを示す2連続スペースは保持)
 */
export const unnecessarySpaceRule: CoreRule = {
  id: 'typography/unnecessary-space',
  category: 'typography',
  tier: 'fast',
  description:
    '不要なスペースを検出します。(1) 日本語文字に挟まれたスペース、(2) 句読点・閉じ括弧の直前のスペース、(3) 開き括弧の直後のスペース、(4) 行末の単一スペース。いずれも Safe Fix として削除を提示します。行末の2連続スペースはMarkdownの改行(hard break)のため検査対象外です。',
  defaultSeverity: 'warning',
  run: (ctx): RawDiagnostic[] => {
    const results: RawDiagnostic[] = []
    const masked = ctx.maskedText

    // 1) 日本語文字 + スペース(半角/全角/タブ) + 日本語文字 → スペース削除
    //    lookahead使用で連続する誤挿入スペースも取りこぼさない
    const reBetween = new RegExp(`(${JP_CLASS})([\\t \\u3000]+)(?=${JP_CLASS})`, 'g')
    let m: RegExpExecArray | null
    while ((m = reBetween.exec(masked)) !== null) {
      const spaceStart = m.index + m[1].length
      results.push({
        start: spaceStart,
        end: spaceStart + m[2].length,
        message: '日本語文字の間のスペースは不要です。',
        fixKind: 'safe',
        replacement: ''
      })
    }

    // 2) 閉じ句読点・閉じ括弧の前のスペース
    const reBefore = /[ \t\u3000]+(?=[、。，．；：！？」』）】〕》〉〟…‥])/g
    while ((m = reBefore.exec(masked)) !== null) {
      results.push({
        start: m.index,
        end: m.index + m[0].length,
        message: '句読点・閉じ括弧の前のスペースは不要です。',
        fixKind: 'safe',
        replacement: ''
      })
    }

    // 3) 開き括弧の直後のスペース
    const reAfter = /(?<=[「『（【〔《〈])[ \t\u3000]+/g
    while ((m = reAfter.exec(masked)) !== null) {
      results.push({
        start: m.index,
        end: m.index + m[0].length,
        message: '開き括弧の直後のスペースは不要です。',
        fixKind: 'safe',
        replacement: ''
      })
    }

    // 4) 行末の単一スペース / 単一タブ (2連続スペース = hard break は保持)
    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]
      const lineStart = ctx.lineStarts[i]
      const trailing = /[ \t]$/.exec(line)
      if (trailing === null) continue
      // 行末がちょうどスペース2つなら hard break として保持
      if (/  $/.test(line)) continue
      // マスク領域内ならスキップ
      if (ctx.maskedText[lineStart + line.length - 1] === '\uFFFF') continue
      results.push({
        start: lineStart + line.length - 1,
        end: lineStart + line.length,
        message: '行末のスペースは不要です。',
        fixKind: 'safe',
        replacement: ''
      })
    }

    return results
  }
}
