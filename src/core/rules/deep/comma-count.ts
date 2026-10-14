/**
 * 読点数ルール — 仕様書 §3.1 (読点数)
 *
 * style/comma-count: 一文あたりの読点(、)の数を検査する。
 * Intl.Segmenter (sentence) で文分割し、文ごとに読点を数える (§22)。
 * Segmenterが利用不可な環境ではフォールバック分割を使用する (§45)。
 */

import type { CoreRule, RawDiagnostic } from '../../types'
import { splitSentences, isSubstantiveSentence } from '../../text/segmenter'
import { isHeadingLine } from '../shared'

export const commaCountRule: CoreRule = {
  id: 'style/comma-count',
  category: 'style',
  tier: 'deep',
  description:
    '一文に含まれる読点(、)の数が上限を超えていることを検出します。読点が多い文は複数の文への分割を検討してください。上限は設定から変更できます (デフォルト: 4個)。',
  defaultSeverity: 'warning',
  optionDefs: [{ key: 'max', type: 'number', label: '一文あたりの読点上限', defaultValue: 4, min: 1, max: 20 }],
  run: (ctx, setting): RawDiagnostic[] => {
    const max = typeof setting.options?.max === 'number' ? setting.options.max : 4
    const results: RawDiagnostic[] = []
    const sentences = splitSentences(ctx.maskedText)

    for (const sentence of sentences) {
      if (!isSubstantiveSentence(sentence.text)) continue
      // 見出し行を含む文は除外
      const lineIdx = ctx.maskedText.lastIndexOf('\n', sentence.start) + 1
      const lineEnd = ctx.maskedText.indexOf('\n', sentence.start)
      const lineText = ctx.maskedText.slice(
        lineIdx,
        lineEnd === -1 ? ctx.maskedText.length : lineEnd
      )
      if (isHeadingLine(lineText.replace(/\uFFFF/g, 'x'))) continue

      let count = 0
      let lastTenOffset = -1
      for (let i = sentence.start; i < sentence.end; i++) {
        if (ctx.maskedText[i] === '、') {
          count++
          lastTenOffset = i
        }
      }
      if (count > max && lastTenOffset >= 0) {
        results.push({
          start: sentence.start,
          end: sentence.end,
          message: `一文に含まれる読点(、)が多すぎます (${count}個 / 上限 ${max}個)。文の分割を検討してください。`
        })
      }
    }
    return results
  }
}
