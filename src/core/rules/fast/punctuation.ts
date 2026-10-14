/**
 * 句読点ルール — 仕様書 §3.1 (句読点), §17 (句読点形式 = Safe Fix)
 *
 * typography/punctuation:
 * - 全角カンマ(，) → 読点(、)  [Safe Fix]
 * - 全角ピリオド(．) → 句点(。)  [Safe Fix] (全角数字に挟まれた小数点は除外)
 * - 日本語文字に挟まれた半角カンマ/ピリオド → 、。 [Suggestion]
 * - 日本語文字に隣接する半角 !? → ？！ [Suggestion]
 */

import type { CoreRule, RawDiagnostic } from '../../types'
import { JP_CLASS } from '../shared'

export const punctuationRule: CoreRule = {
  id: 'typography/punctuation',
  category: 'typography',
  tier: 'fast',
  description:
    '句読点の表記を検査します。全角カンマ(，)は読点(、)、全角ピリオド(．)は句点(。)への置き換えをSafe Fixとして提示します。日本語文字に挟まれた半角カンマ・ピリオド、日本語に隣接する半角の!/?は Suggestion として提示します。',
  defaultSeverity: 'warning',
  run: (ctx): RawDiagnostic[] => {
    const results: RawDiagnostic[] = []
    const masked = ctx.maskedText

    // 全角カンマ → 読点 (Safe)
    {
      const re = /\uff0c/g
      let m: RegExpExecArray | null
      while ((m = re.exec(masked)) !== null) {
        results.push({
          start: m.index,
          end: m.index + 1,
          message: '全角カンマ(，)の代わりに読点(、)を使用してください。',
          fixKind: 'safe',
          replacement: '、'
        })
      }
    }

    // 全角ピリオド → 句点 (Safe)。ただし全角数字に挟まれた小数点(１２．３等)は除外
    {
      const re = /\uff0e/g
      let m: RegExpExecArray | null
      while ((m = re.exec(masked)) !== null) {
        const prev = masked[m.index - 1] ?? ''
        const next = masked[m.index + 1] ?? ''
        if (/[０-９]/.test(prev) && /[０-９]/.test(next)) continue
        results.push({
          start: m.index,
          end: m.index + 1,
          message: '全角ピリオド(．)の代わりに句点(。)を使用してください。',
          fixKind: 'safe',
          replacement: '。'
        })
      }
    }

    // 日本語文字に挟まれた半角カンマ → 読点 (Suggestion)
    {
      const re = new RegExp(`(${JP_CLASS}),(?=${JP_CLASS})`, 'g')
      let m: RegExpExecArray | null
      while ((m = re.exec(masked)) !== null) {
        results.push({
          start: m.index + m[1].length,
          end: m.index + m[1].length + 1,
          message: '日本語文中の半角カンマ(,)は読点(、)が適切です。',
          fixKind: 'suggestion',
          replacement: '、'
        })
      }
    }

    // 日本語文字に挟まれた半角ピリオド → 句点 (Suggestion)
    {
      const re = new RegExp(`(${JP_CLASS})\\.(?=${JP_CLASS})`, 'g')
      let m: RegExpExecArray | null
      while ((m = re.exec(masked)) !== null) {
        results.push({
          start: m.index + m[1].length,
          end: m.index + m[1].length + 1,
          message: '日本語文中の半角ピリオド(.)は句点(。)が適切です。',
          fixKind: 'suggestion',
          replacement: '。'
        })
      }
    }

    // 日本語文字に隣接する半角 !? → 全角 (Suggestion)
    {
      const re = new RegExp(`(?:${JP_CLASS}[!?]|[!?]${JP_CLASS})`, 'g')
      let m: RegExpExecArray | null
      while ((m = re.exec(masked)) !== null) {
        const markIndex = /[!?]/.test(m[0][0]) ? m.index : m.index + 1
        const mark = masked[markIndex]
        results.push({
          start: markIndex,
          end: markIndex + 1,
          message: `日本語文中の半角記号(${mark})は全角(${mark === '!' ? '！' : '？'})が適切です。`,
          fixKind: 'suggestion',
          replacement: mark === '!' ? '！' : '？'
        })
      }
    }

    return results
  }
}
