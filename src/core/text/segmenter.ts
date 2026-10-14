/**
 * Intl.Segmenter ラッパー — 仕様書 §22 日本語解析 / §44 ブラウザサポート
 *
 * Intl.Segmenter は形態素解析の代替にはならない (品詞・読み・活用・係り受けは不可)。
 * v1では文分割 (granularity: "sentence") のみに利用する。
 * 利用不可な環境ではフォールバック分割 (。？！改行) を使用し、App全体は継続動作する (§45)。
 */

export interface SentenceSpan {
  start: number
  end: number
  text: string
}

let cachedSegmenter: Intl.Segmenter | null | undefined

export function isSegmenterAvailable(): boolean {
  if (cachedSegmenter === undefined) {
    try {
      cachedSegmenter =
        typeof Intl !== 'undefined' && 'Segmenter' in Intl
          ? new Intl.Segmenter('ja', { granularity: 'sentence' })
          : null
    } catch {
      cachedSegmenter = null
    }
  }
  return cachedSegmenter !== null
}

const FALLBACK_TERMINATORS = new Set(['。', '？', '！', '?', '!'])

/** フォールバック: 。？！?! と改行で分割 (Intl.Segmenter不在環境向け) */
function splitSentencesFallback(text: string): SentenceSpan[] {
  const spans: SentenceSpan[] = []
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (FALLBACK_TERMINATORS.has(ch) || ch === '\n') {
      const end = ch === '\n' ? i : i + 1
      if (end > start) {
        spans.push({ start, end, text: text.slice(start, end) })
      }
      start = end
    }
  }
  if (start < text.length) {
    spans.push({ start, end: text.length, text: text.slice(start) })
  }
  return spans
}

/**
 * 文分割。Intl.Segmenter (ja, sentence) を使用し、
 * 利用不可の場合はフォールバックに切り替わる (決定論的な挙動を保証)。
 */
export function splitSentences(text: string): SentenceSpan[] {
  const segmenter = cachedSegmenter
  if (segmenter === null || segmenter === undefined) {
    return splitSentencesFallback(text)
  }
  const spans: SentenceSpan[] = []
  try {
    for (const seg of segmenter.segment(text)) {
      const segText = seg.segment
      if (segText.length === 0) continue
      spans.push({ start: seg.index, end: seg.index + segText.length, text: segText })
    }
  } catch {
    return splitSentencesFallback(text)
  }
  // Intl.Segmenterは末尾に空セグメントを出さないが、保険として空を除去
  return spans.filter((s) => s.text.trim().length > 0 || spans.length === 1)
}

/** 文をまたぐ改行・空白を除いた「実質的な文」かどうか (読点数カウント用の前処理) */
export function isSubstantiveSentence(text: string): boolean {
  // 見出し行・リスト記号・空行は文として扱わない
  if (/^\s*#{1,6}\s/.test(text)) return false
  if (/^\s*([-*+]|\d+\.)\s*$/.test(text)) return false
  // 日本語文字を1つでも含むか
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(text)
}
