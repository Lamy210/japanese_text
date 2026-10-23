/**
 * 行・列・offset変換ユーティリティ
 * 仕様書 §12: Diagnosticは line / column (1-origin) を持つ。
 * CodeMirror・textlintのoffsetは UTF-16 code unit 基準で一致する。
 */

export interface Position {
  /** 1-origin行番号 */
  line: number
  /** 1-origin列番号 */
  column: number
}

/** 行開始offsetを事前計算した索引 (lint 1回あたりO(1)変換) */
export class LineIndex {
  private readonly lineStarts: number[]
  private readonly textLength: number
  readonly lineCount: number
  get length(): number { return this.textLength }

  constructor(text: string) {
    const starts: number[] = [0]
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10 /* \n */) {
        starts.push(i + 1)
      }
    }
    this.lineStarts = starts
    this.textLength = text.length
    this.lineCount = starts.length
  }

  /** offset → 1-origin (line, column) */
  posFromOffset(offset: number): Position {
    // 文書末尾位置 (== textLength) を許容する
    const clamped = Number.isNaN(offset) ? 0 : Math.max(0, Math.min(offset, this.textLength))
    // 二分探索で offset を含む行を特定
    let lo = 0
    let hi = this.lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1
      if (this.lineStarts[mid] <= clamped) {
        lo = mid
      } else {
        hi = mid - 1
      }
    }
    return { line: lo + 1, column: clamped - this.lineStarts[lo] + 1 }
  }

  /** 行番号 (1-origin) → 行テキスト */
  lineText(text: string, line: number): string {
    const idx = line - 1
    if (idx < 0 || idx >= this.lineStarts.length) return ''
    const start = this.lineStarts[idx]
    const end = idx + 1 < this.lineStarts.length ? this.lineStarts[idx + 1] - 1 : text.length
    return text.slice(start, end)
  }

  /** 行番号 (1-origin) → 行開始offset */
  lineStart(line: number): number {
    const idx = line - 1
    if (idx < 0) return 0
    if (idx >= this.lineStarts.length) return this.lineStarts[this.lineStarts.length - 1]
    return this.lineStarts[idx]
  }
}

/** 文書を行配列に分割 (マスク・ルールから利用) */
export function splitLines(text: string): string[] {
  if (text === '') return ['']
  return text.split('\n')
}

/** 行開始offset配列 */
export function computeLineStarts(lines: string[]): number[] {
  const starts: number[] = []
  let offset = 0
  for (const line of lines) {
    starts.push(offset)
    offset += line.length + 1
  }
  return starts
}
