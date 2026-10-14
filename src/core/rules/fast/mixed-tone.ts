/**
 * 文体統一ルール — 仕様書 §3.1 (文体) / §22 (v1では形態素解析を使わない) / §25 (Tier 3: 文体統一)
 *
 * style/mixed-tone: ですます調とである調の混在を段落単位で検出する。
 * 形態素解析を使わないため、明示的な文末表現のみを対象とした決定論的な辞書判定を行う
 * (kuromojin依存の textlint-rule-no-mix-dearu-desumasu は辞書ダウンロードが必要なため不採用 — §36 Privacy / §45 Offline)。
 *
 * ですます調: です / ます / ました / ません / でした / でしょう / ましょう / ください
 * である調  : である / だ / だった / だろう / ではない / だが
 *
 * 段落内で両者が混在する場合、少数派の文体の出現箇所を報告する。
 */

import type { CoreRule, RawDiagnostic } from '../../types'
import { JP_CLASS } from '../shared'

const DESUMASU_ENDINGS =
  /(です|ます|ました|ません|でした|でしょう|ましょう|ください|ませんでした|ましょうか|ですよね?|ますよね?)(?=[。！？、\n]|$)/g

const DEARU_ENDINGS =
  /(である|だった|だろう|ではない|だが|だ)(?=[。！？、\n]|$)/g

/** 前の文字が日本語であることにより誤検出を防ぐ (例: 「ツールだ」→OK、「Toolだ」→OK扱い) */
function collectEndings(
  masked: string,
  pattern: RegExp,
  start: number,
  end: number
): Array<{ start: number; end: number; text: string }> {
  const re = new RegExp(pattern.source, pattern.flags)
  const results: Array<{ start: number; end: number; text: string }> = []
  let m: RegExpExecArray | null
  while ((m = re.exec(masked)) !== null) {
    if (m.index < start || m.index >= end) continue
    const prev = masked[m.index - 1] ?? ''
    // 直前が日本語文字 (または文頭) の場合のみ文末表記として扱う
    if (prev !== '' && !new RegExp(`[${JP_CLASS.slice(1, -1)}]`).test(prev) && !/[、。！？\s「『（(]/.test(prev)) {
      continue
    }
    results.push({ start: m.index, end: m.index + m[0].length, text: m[0] })
  }
  return results
}

export const mixedToneRule: CoreRule = {
  id: 'style/mixed-tone',
  category: 'style',
  tier: 'idle',
  description:
    'ですます調とである調の混在を段落単位で検出します (文体統一)。形態素解析を使わない決定論的な判定のため、明示的な文末表現 (です/ます系 と である/だ系) のみを対象とします。混在時は少数派の文体を報告します。',
  defaultSeverity: 'warning',
  run: (ctx): RawDiagnostic[] => {
    const results: RawDiagnostic[] = []
    const masked = ctx.maskedText
    const { lines, lineStarts } = ctx

    // 段落 (空行区切りの連続行ブロック) ごとに判定
    let blockStartLine = 0
    const checkBlock = (startLine: number, endLineExclusive: number): void => {
      const start = lineStarts[startLine]
      const lastLine = lines[endLineExclusive - 1] ?? ''
      const end = lineStarts[endLineExclusive - 1] + lastLine.length
      if (end <= start) return

      const desumasu = collectEndings(masked, DESUMASU_ENDINGS, start, end)
      const dearu = collectEndings(masked, DEARU_ENDINGS, start, end)
      if (desumasu.length === 0 || dearu.length === 0) return

      // 少数派の文体を報告 (同数の場合はである調を報告)
      const reportDesumasu = desumasu.length < dearu.length
      const minority = reportDesumasu ? desumasu : dearu
      const minorityLabel = reportDesumasu ? 'ですます調' : 'である調'
      const majorityLabel = reportDesumasu ? 'である調' : 'ですます調'
      for (const occurrence of minority) {
        results.push({
          start: occurrence.start,
          end: occurrence.end,
          message: `文体の混在: この段落では${majorityLabel}が主流ですが「${occurrence.text}」は${minorityLabel}です。文体を統一してください。`
        })
      }
    }

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === '') {
        if (i > blockStartLine) checkBlock(blockStartLine, i)
        blockStartLine = i + 1
      }
    }
    if (blockStartLine < lines.length) checkBlock(blockStartLine, lines.length)

    return results
  }
}
