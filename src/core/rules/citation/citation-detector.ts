/**
 * Citation / Evidence Linter — 仕様書 §19 (heuristic detector) / §20 (判定範囲)
 *
 * LLMを使わないため「意味的に引用が必要か」は完全には判断できない。
 * そのため heuristic detector として実装する:
 * - 数値 (% 円 $ 倍 ms 秒 GB TB 件 人 市場規模 等) を含む主張
 * - 比較表現 (より高速 / 最も / 改善 / 削減 等)
 * - 外部事実の導入表現 (調査によると / 公式によると 等)
 * のいずれかを含む判定範囲 (デフォルト: 同一Paragraph) に
 * 出典 (Markdown link / reference link / autolink / 裸URL) が存在しない場合に診断する。
 *
 * 除外対象 (§19.1): version / port / HTTP status / 日付 / heading number / phase番号
 */

import type { CoreRule, RawDiagnostic, RuleContext } from '../../types'
import type { CitationPolicy } from '../../config/schema'
import { splitSentences, isSegmenterAvailable } from '../../text/segmenter'
import { isHeadingLine } from '../shared'

/** 引用とみなす範囲 (raw text上) */
interface CitationRanges {
  citations: Array<{ start: number; end: number }>
  exclusions: Array<{ start: number; end: number }>
  scopes: Array<{ start: number; end: number }>
  headingLines: Set<number>
}

let cacheKey: string | null = null
let cacheValue: CitationRanges | null = null

/** 同一lint実行内で3ルールがコンテキストを共有できるようキャッシュ (決定論的) */
function getCitationContext(ctx: RuleContext, scope: CitationPolicy['scope']): CitationRanges {
  if (cacheKey === ctx.text && cacheValue !== null) {
    // scope が変わった場合のみ scopes を再計算
    if (lastScope === scope) return cacheValue
  }
  const citations = findCitationRanges(ctx.text)
  const exclusions = findExclusionRanges(ctx)
  const scopes = computeScopes(ctx, scope)
  const headingLines = new Set<number>()
  for (let i = 0; i < ctx.lines.length; i++) {
    if (isHeadingLine(ctx.lines[i])) headingLines.add(i)
  }
  cacheKey = ctx.text
  lastScope = scope
  cacheValue = { citations, exclusions, scopes, headingLines }
  return cacheValue
}

let lastScope: CitationPolicy['scope'] | null = null

/** raw text 上の出典候補 (Markdown link / reference link / autolink / 裸URL) */
function findCitationRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  const patterns: RegExp[] = [
    /\[[^\]\n]*\]\([^)\n]*\)/g, // inline link
    /\[[^\]\n]*\]\[[^\]\n]*\]/g, // reference link (full + collapsed)
    /<https?:\/\/[^>\s]*>/g, // autolink
    /(?:https?|ftp):\/\/[^\s>"'`\u3040-\u30ff\u3400-\u9fff]+/g // 裸URL
  ]
  for (const re of patterns) {
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      ranges.push({ start: m.index, end: m.index + m[0].length })
    }
  }
  return ranges
}

/** 除外領域 (version / port / HTTP status / 日付 / phase / リスト先頭番号 / 時刻) */
function findExclusionRanges(ctx: RuleContext): Array<{ start: number; end: number }> {
  const text = ctx.maskedText
  const ranges: Array<{ start: number; end: number }> = []
  const push = (re: RegExp): void => {
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      ranges.push({ start: m.index, end: m.index + m[0].length })
    }
  }
  // 日付・時刻
  push(/\d{4}年(?:\s?\d{1,2}月(?:\s?\d{1,2}日)?)?/g)
  push(/\d{1,2}月\d{1,2}日/g)
  push(/\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/g)
  push(/\d{1,2}:\d{2}(?::\d{2})?/g)
  push(/\d{1,2}時\d{1,2}分/g)
  // バージョン
  push(/[vV]\d+(?:\.\d+)+/g)
  push(/(?:ver|Ver|VER|version|Version|VERSION|バージョン)\s*[.。]?\s*\d+(?:\.\d+)*/g)
  // ポート (ASCII語直後の :数字。URLはマスク済みのため現れない)
  push(/(?<=[A-Za-z0-9]):\d{2,5}(?=[\s/、。」）)]|$)/g)
  push(/(?:ポート|port|Port|PORT)\s*(?:番|:|：)?\s*\d+/g)
  // HTTPステータス
  push(/(?:HTTP|http)\s*[\/]?\s*\d{3}/g)
  push(/(?:ステータスコード|ステータス|status code|Status Code)\s*[:：]?\s*\d{3}/g)
  // フェーズ・序数
  push(/(?:フェーズ|フェイズ|Phase|phase|PHASE)\s*[:：]?\s*\d+/g)
  push(/第\d+/g)
  // リスト先頭の番号
  for (let i = 0; i < ctx.lines.length; i++) {
    const m = /^(\s*\d{1,3}[.)、\]])\s/.exec(ctx.lines[i])
    if (m !== null) {
      const start = ctx.lineStarts[i] + (m[0].length - m[1].length)
      ranges.push({ start, end: start + m[1].length })
    }
  }
  return ranges
}

/** 判定範囲 (§20: sentence / paragraph / section) */
function computeScopes(
  ctx: RuleContext,
  scope: CitationPolicy['scope']
): Array<{ start: number; end: number }> {
  const text = ctx.maskedText
  const { lines, lineStarts } = ctx

  if (scope === 'section') {
    // 見出し行 → 次の見出し行までを1セクションとする
    const sections: Array<{ start: number; end: number }> = []
    let sectionStart = 0
    for (let i = 0; i < lines.length; i++) {
      if (isHeadingLine(ctx.lines[i]) && i > 0) {
        sections.push({ start: sectionStart, end: lineStarts[i] - 1 })
        sectionStart = lineStarts[i]
      }
    }
    sections.push({ start: sectionStart, end: text.length })
    return sections
  }

  if (scope === 'sentence') {
    if (isSegmenterAvailable()) {
      const sentences = splitSentences(text)
      if (sentences.length > 0) return sentences.map((s) => ({ start: s.start, end: s.end }))
    }
    // Segmenter不在時は段落へフォールバック (§45: 対象をdisableして継続動作)
  }

  // paragraph (デフォルト): 空行で区切られた連続行ブロック
  const paragraphs: Array<{ start: number; end: number }> = []
  let blockStartLine = 0
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '') {
      if (i > blockStartLine) {
        const start = lineStarts[blockStartLine]
        const end = lineStarts[i - 1] + lines[i - 1].length
        if (end > start) paragraphs.push({ start, end })
      }
      blockStartLine = i + 1
    }
  }
  if (blockStartLine < lines.length) {
    const start = lineStarts[blockStartLine]
    const end = lineStarts[lines.length - 1] + lines[lines.length - 1].length
    if (end > start) paragraphs.push({ start, end })
  }
  if (paragraphs.length === 0) paragraphs.push({ start: 0, end: text.length })
  return paragraphs
}

function overlaps(
  a: Array<{ start: number; end: number }>,
  start: number,
  end: number
): boolean {
  for (const r of a) {
    if (r.start < end && start < r.end) return true
  }
  return false
}

/** パターンマッチ群を判定範囲ごとに検査し、出典なしの範囲を報告 */
function detectNeedsCitation(
  ctx: RuleContext,
  scope: CitationPolicy['scope'],
  pattern: RegExp,
  message: string
): RawDiagnostic[] {
  const cc = getCitationContext(ctx, scope)
  const results: RawDiagnostic[] = []

  for (const s of cc.scopes) {
    // 見出しだけの範囲・純コード範囲は対象外
    const re = new RegExp(pattern.source, pattern.flags)
    re.lastIndex = s.start
    let first: { start: number; end: number } | null = null
    let m: RegExpExecArray | null
    while ((m = re.exec(ctx.maskedText)) !== null && m.index < s.end) {
      const start = m.index
      const end = m.index + m[0].length
      // 除外領域 (日付・バージョン等) と重なる場合はスキップ
      if (overlaps(cc.exclusions, start, end)) continue
      // 見出し行内は対象外
      const lineIdx = lineIndexForOffset(ctx, start)
      if (cc.headingLines.has(lineIdx)) continue
      if (first === null) first = { start, end }
    }
    if (first === null) continue
    // 出典が判定範囲内に存在するか (raw text上の引用範囲と重なるか)
    if (overlaps(cc.citations, s.start, Math.min(s.end + 1, ctx.text.length))) continue
    results.push({
      start: first.start,
      end: first.end,
      message
    })
  }
  return results
}

function lineIndexForOffset(ctx: RuleContext, offset: number): number {
  let lo = 0
  let hi = ctx.lineStarts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1
    if (ctx.lineStarts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return lo
}

const NUMBER_PATTERN =
  /(?:\d+(?:\.\d+)?\s?%|\d+(?:\.\d+)?パーセント|[¥￥$]\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:円|USD|ドル)|\d+(?:\.\d+)?\s?倍|\d+(?:\.\d+)?\s?(?:ms|µs|sec|seconds?|秒)|\d+(?:\.\d+)?\s?(?:KB|MB|GB|TB|PB|KiB|MiB|GiB|TiB)\b|\d[\d,]*\s?(?:件|人|社|台|回)|市場規模)/g

const COMPARISON_PATTERN =
  /より高速|より安全|より効率的|より簡単|より優れた|最も|最大|最小|最速|最適|高速化|改善|削減|増加|減少/g

const EXTERNAL_FACT_PATTERN =
  /調査によると|公式によると|公表されている|推奨されている|統計では|レポートによると|調査結果では|公式ドキュメントによると|アンケートによると|報告によると|発表によると|によれば/g

export function createCitationNumberRule(policy: () => CitationPolicy): CoreRule {
  return {
    id: 'evidence/citation-number',
    category: 'evidence',
    tier: 'deep',
    description:
      '数値・統計を含む主張 (%、金額、倍率、ms、GB、件数、市場規模等) に対して、判定範囲内の出典 (リンク) の有無を検査します。バージョン・ポート番号・HTTPステータス・日付は除外します。ヒューリスティック検出のため、判定範囲は設定で変更できます (文/段落/セクション)。',
    defaultSeverity: 'info',
    run: (ctx) =>
      detectNeedsCitation(
        ctx,
        policy().scope,
        NUMBER_PATTERN,
        '数値・統計を含む主張には出典 (リンク・参考文献) の明記を推奨します。'
      )
  }
}

export function createCitationComparisonRule(policy: () => CitationPolicy): CoreRule {
  return {
    id: 'evidence/citation-comparison',
    category: 'evidence',
    tier: 'deep',
    description:
      '比較・性能を表す主張 (より高速、最も、改善、削減等) に対して、判定範囲内の出典 (計測条件・リンク) の有無を検査します。',
    defaultSeverity: 'info',
    run: (ctx) =>
      detectNeedsCitation(
        ctx,
        policy().scope,
        COMPARISON_PATTERN,
        '比較・性能を表す主張には根拠 (計測条件・出典リンク) の明記を推奨します。'
      )
  }
}

export function createCitationExternalFactRule(policy: () => CitationPolicy): CoreRule {
  return {
    id: 'evidence/citation-external-fact',
    category: 'evidence',
    tier: 'deep',
    description:
      '外部情報への言及 (「調査によると」「公式によると」「統計では」等) に対して、判定範囲内の出典リンクの有無を検査します。',
    defaultSeverity: 'info',
    run: (ctx) =>
      detectNeedsCitation(
        ctx,
        policy().scope,
        EXTERNAL_FACT_PATTERN,
        '外部情報への言及には出典リンクの明記を推奨します。'
      )
  }
}
