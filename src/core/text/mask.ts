/**
 * 文書マスキング — 仕様書 §48/49 (Golden Test必須ケース: Markdown code / URL / inline code / quote / table)
 *
 * prose向きルールが誤検出しないよう、以下をマスク(同長の U+FFFF に置換)する:
 * - YAML frontmatter
 * - Fenced code block (``` / ~~~)
 * - HTMLコメント
 * - 参照定義行 ([id]: url "title") — メタデータ行
 * - Inline code (`code`)
 * - リンク先 (](url) / ](<url>)) および autolink (<https://...>)
 * - 裸URL (https://...)
 *
 * マスクは UTF-16 code unit 長を厳密に保存する (surrogate pair対応)。
 */

import type { MaskRegion } from '../types'

const MASK_CHAR = '\uFFFF'

export interface MaskedDocument {
  original: string
  masked: string
  regions: MaskRegion[]
  isMasked: (offset: number, end?: number) => boolean
}

function regionsOverlap(a: MaskRegion, b: MaskRegion): boolean {
  return a.start < b.end && b.start < a.end
}

export function maskDocument(text: string): MaskedDocument {
  const regions: MaskRegion[] = []

  const addRegion = (start: number, end: number, kind: MaskRegion['kind']): void => {
    if (end <= start) return
    const region: MaskRegion = { start, end, kind }
    // 既存領域と重複するものは追加しない (先に適用した優先)
    for (const r of regions) {
      if (regionsOverlap(r, region)) return
    }
    regions.push(region)
  }

  const isMaskedRange = (start: number, end: number): boolean => {
    for (const r of regions) {
      if (r.start < end && start < r.end) return true
    }
    return false
  }

  const lines = text.split('\n')

  // ------------------------------------------------------------------
  // 1. YAML frontmatter (文書先頭の --- ... ---)
  // ------------------------------------------------------------------
  if (lines.length > 0 && /^---\s*$/.test(lines[0])) {
    let endLine = -1
    for (let i = 1; i < lines.length; i++) {
      if (/^(---|\.\.\.)\s*$/.test(lines[i])) {
        endLine = i
        break
      }
    }
    if (endLine > 0) {
      let offset = 0
      let end = 0
      for (let i = 0; i <= endLine; i++) {
        end = offset + lines[i].length
        offset = end + 1
      }
      addRegion(0, end, 'metadata')
    }
  }

  // ------------------------------------------------------------------
  // 2. Fenced code block (``` or ~~~, 3文字以上)
  // ------------------------------------------------------------------
  {
    let offset = 0
    let inFence: { char: string; length: number } | null = null
    let fenceStart = 0
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
      if (inFence === null) {
        if (fenceMatch) {
          inFence = { char: fenceMatch[1][0], length: fenceMatch[1].length }
          fenceStart = offset
        }
      } else if (fenceMatch && fenceMatch[1][0] === inFence.char && fenceMatch[1].length >= inFence.length) {
        addRegion(fenceStart, offset + line.length, 'code')
        inFence = null
      }
      offset += line.length + 1
    }
    // 閉じていないfence: EOFまでをコード扱い
    if (inFence !== null) {
      addRegion(fenceStart, text.length, 'code')
    }
  }

  // ------------------------------------------------------------------
  // 3. 行ベース: 参照定義 [id]: url "title" (メタデータ行)
  // ------------------------------------------------------------------
  {
    let offset = 0
    for (const line of lines) {
      if (!isMaskedRange(offset, offset + line.length)) {
        if (/^ {0,3}\[[^\]\n]+\]:\s*\S/.test(line) || /^ {0,3}\[[^\]\n]+\]:\s*$/.test(line)) {
          addRegion(offset, offset + line.length, 'metadata')
        }
      }
      offset += line.length + 1
    }
  }

  // ------------------------------------------------------------------
  // 4. インライン: HTMLコメント
  // ------------------------------------------------------------------
  {
    const re = /<!--[\s\S]*?-->/g
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      if (!isMaskedRange(m.index, m.index + m[0].length)) {
        addRegion(m.index, m.index + m[0].length, 'metadata')
      }
    }
  }

  // ------------------------------------------------------------------
  // 5. インラインコード (backtick run。CommonMark的に開閉同長runで挟まれた範囲)
  // ------------------------------------------------------------------
  {
    let i = 0
    while (i < text.length) {
      if (text[i] === '`' && !isMaskedRange(i, i + 1)) {
        let runLen = 0
        const runStart = i
        while (i < text.length && text[i] === '`') {
          runLen++
          i++
        }
        // 同長のクロージングrunを探す
        let j = i
        let found = -1
        while (j < text.length) {
          if (text[j] === '`') {
            let closeLen = 0
            const closeStart = j
            while (j < text.length && text[j] === '`') {
              closeLen++
              j++
            }
            if (closeLen === runLen) {
              found = closeStart + closeLen
              break
            }
          } else {
            j++
          }
        }
        if (found >= 0) {
          addRegion(runStart, found, 'code')
          i = found
        }
      } else {
        i++
      }
    }
  }

  // ------------------------------------------------------------------
  // 6. リンク先 ](url) / ](<url>) — url部分のみマスク
  // ------------------------------------------------------------------
  {
    let idx = 0
    while (idx < text.length) {
      const open = text.indexOf('](', idx)
      if (open < 0) break
      const destStart = open + 1 // '(' の位置
      if (isMaskedRange(open, open + 2)) {
        idx = open + 2
        continue
      }
      // ネストした括弧を数えながら対応する ')' を探す
      let depth = 1
      let k = destStart + 1
      while (k < text.length && depth > 0) {
        const ch = text[k]
        if (ch === '(') depth++
        else if (ch === ')') depth--
        else if (ch === '\n' && text[k - 1] === '\n') break // 空行で中断
        if (depth === 0) break
        k++
      }
      if (k < text.length && text[k] === ')') {
        // url "title" からurl部分のみ (括弧自体はマスクしない — 括弧対応検査のため)
        let urlEnd = k
        for (let c = destStart + 1; c < k; c++) {
          const ch = text[c]
          if (ch === ' ' || ch === '\t' || ch === '\n') {
            urlEnd = c
            break
          }
        }
        addRegion(destStart + 1, urlEnd, 'url')
        idx = k + 1
      } else {
        idx = open + 2
      }
    }
  }

  // ------------------------------------------------------------------
  // 7. Autolink <https://...> および裸URL
  // ------------------------------------------------------------------
  {
    // autolink
    const autoRe = /<(?:https?|ftp):\/\/[^>\s]*>/g
    let m: RegExpExecArray | null
    while ((m = autoRe.exec(text)) !== null) {
      if (!isMaskedRange(m.index, m.index + m[0].length)) {
        addRegion(m.index, m.index + m[0].length, 'url')
      }
    }
    // 裸URL
    const urlRe = /(?:https?|ftp):\/\/[^\s<>"'\uFFFF]+/g
    while ((m = urlRe.exec(text)) !== null) {
      if (isMaskedRange(m.index, m.index + 1)) continue
      let end = m.index + m[0].length
      let url = m[0]
      // 末尾の句読点等を除去 (括弧は対応が取れる場合のみ残す)
      while (end > m.index + 1) {
        const last = url[url.length - 1]
        if ('.,;:!?、。」』】』)'.includes(last)) {
          if (last === ')') {
            const opens = (url.match(/\(/g) ?? []).length
            const closes = (url.match(/\)/g) ?? []).length
            if (closes > opens) {
              url = url.slice(0, -1)
              end--
              continue
            }
          } else {
            url = url.slice(0, -1)
            end--
            continue
          }
        }
        break
      }
      addRegion(m.index, end, 'url')
    }
  }

  // マスク文字列を構築 (領域のみ U+FFFF 置換、長さは保存)
  regions.sort((a, b) => a.start - b.start)
  let masked = ''
  let cursor = 0
  for (const r of regions) {
    masked += text.slice(cursor, r.start)
    masked += MASK_CHAR.repeat(r.end - r.start)
    cursor = r.end
  }
  masked += text.slice(cursor)

  return {
    original: text,
    masked,
    regions,
    isMasked: (offset: number, end?: number) => {
      const e = end ?? offset + 1
      return isMaskedRange(offset, e)
    }
  }
}

/**
 * マスク済みテキスト上の正規表現マッチについて、マスク領域と重複するかを判定する。
 * ルール側で「コード内・URL内は検査対象外」にするために使う。
 */
export function matchTouchesMasked(
  regions: MaskRegion[],
  start: number,
  end: number
): boolean {
  for (const r of regions) {
    if (r.start < end && start < r.end) return true
  }
  return false
}
