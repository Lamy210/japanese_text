/**
 * 括弧対応ルール — 仕様書 §3.1 (括弧対応)
 *
 * typography/brackets: 段落単位で括弧の対応を検査する (Diagnostic Only)。
 * - 閉じられていない括弧
 * - 対応する開き括弧のない閉じ括弧
 * - 種類の不一致 (例: （ を ] で閉じる)
 */

import type { CoreRule, RawDiagnostic, MaskRegion } from '../../types'

const BRACKET_PAIRS: ReadonlyArray<[string, string]> = [
  ['(', ')'],
  ['（', '）'],
  ['[', ']'],
  ['「', '」'],
  ['『', '』'],
  ['【', '】'],
  ['〈', '〉'],
  ['《', '》'],
  ['〔', '〕'],
  ['｛', '｝']
]

const OPENERS = new Set(BRACKET_PAIRS.map(([o]) => o))
const CLOSERS = new Set(BRACKET_PAIRS.map(([, c]) => c))
const CLOSER_TO_OPENER = new Map(BRACKET_PAIRS.map(([o, c]) => [c, o] as const))

interface OpenBracket {
  char: string
  offset: number
}

/** 段落 (空行で区切られた連続行ブロック) ごとに括弧対応を検査 */
export const bracketsRule: CoreRule = {
  id: 'typography/brackets',
  category: 'typography',
  tier: 'fast',
  description:
    '括弧の対応を段落単位で検査します。閉じられていない括弧、対応する開き括弧のない閉じ括弧、種類の不一致を検出します。テーブル・引用・箇条書きも同じく段落として扱います。自動修正は行いません。',
  defaultSeverity: 'warning',
  run: (ctx): RawDiagnostic[] => {
    const results: RawDiagnostic[] = []
    const masked = ctx.maskedText
    const { lineStarts, lines } = ctx

    // 段落ブロックの特定
    let blockStartLine = 0
    const checkBlock = (startLine: number, endLineExclusive: number): void => {
      const startOffset = lineStarts[startLine]
      const lastLine = lines[endLineExclusive - 1] ?? ''
      const endOffset = lineStarts[endLineExclusive - 1] + lastLine.length
      checkRange(masked, ctx.maskRegions, startOffset, endOffset, results)
    }

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === '') {
        if (i > blockStartLine) {
          checkBlock(blockStartLine, i)
        }
        blockStartLine = i + 1
      }
    }
    if (blockStartLine < lines.length) {
      checkBlock(blockStartLine, lines.length)
    }

    return results
  }
}

function checkRange(
  masked: string,
  _regions: MaskRegion[],
  start: number,
  end: number,
  results: RawDiagnostic[]
): void {
  const stack: OpenBracket[] = []

  for (let i = start; i < end && i < masked.length; i++) {
    const ch = masked[i]
    if (ch === '\uFFFF') continue
    if (OPENERS.has(ch)) {
      stack.push({ char: ch, offset: i })
    } else if (CLOSERS.has(ch)) {
      const expectedOpener = CLOSER_TO_OPENER.get(ch)
      const top = stack[stack.length - 1]
      if (top === undefined) {
        results.push({
          start: i,
          end: i + 1,
          message: `閉じ括弧「${ch}」に対応する開き括弧がありません。`
        })
      } else if (top.char === expectedOpener) {
        stack.pop()
      } else {
        results.push({
          start: top.offset,
          end: top.offset + 1,
          message: `開き括弧「${top.char}」が「${ch}」で閉じられていません。`
        })
        // 不一致でも1つ消費して続行 (連鎖エラー防止)
        stack.pop()
      }
    }
  }

  for (const unclosed of stack) {
    results.push({
      start: unclosed.offset,
      end: unclosed.offset + 1,
      message: `開き括弧「${unclosed.char}」が閉じられていません。`
    })
  }
}
