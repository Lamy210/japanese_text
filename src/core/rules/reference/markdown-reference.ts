/**
 * Reference Linter — 仕様書 §21
 *
 * Markdown reference について以下を検出する:
 * - reference/undefined     : 参照IDが定義されていない (error)
 * - reference/empty-url     : 空URL (error)
 * - reference/malformed-url : 不正URL構文 (error)
 * - reference/broken-anchor : 文書内アンカー参照の不整合 (warning)
 * - reference/duplicate-id  : 重複reference定義 (warning)
 * - reference/unused        : 未使用reference (info, idle tier)
 * - reference/duplicate-anchor : 重複アンカー (warning, idle tier)
 *
 * HTTPのオンライン死活確認はCORS制約により対象外 (§5)。
 */

import type { CoreRule, RawDiagnostic, RuleContext } from '../../types'
import { Slugger } from '../../text/slug'

interface Definition {
  id: string
  url: string
  lineStart: number
  lineEnd: number
}

interface HeadingInfo {
  text: string
  line: number
  lineStart: number
  lineEnd: number
}

interface RefAnalysis {
  definitions: Definition[]
  defById: Map<string, Definition>
  usedIds: Set<string>
  headings: HeadingInfo[]
  /** 全アンカー (dedup込み) の有効集合 */
  validAnchors: Set<string>
  /** base slug が重複した見出し */
  duplicateAnchorHeadings: HeadingInfo[]
}

let cacheKey: string | null = null
let cacheValue: RefAnalysis | null = null

function getAnalysis(ctx: RuleContext): RefAnalysis {
  if (cacheKey === ctx.text && cacheValue !== null) return cacheValue

  // A metadata region can represent an actual reference-definition line,
  // but frontmatter and HTML comments are not live Markdown definitions.
  // maskDocument intentionally preserves reference-definition lines as metadata.
  // Explicit comment spans also cover multiline comments whose definition-like
  // lines were masked before the HTML comment pass.
  const comments = [...ctx.text.matchAll(/<!--[\s\S]*?-->/g)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length
  }))
  const overlaps = (start: number, end: number, region: { start: number; end: number }) =>
    region.start < end && start < region.end
  const isNonProse = (start: number, end: number, allowDefinitionLine = false): boolean => {
    if (comments.some((comment) => overlaps(start, end, comment))) return true
    return ctx.maskRegions.some((region) => {
      if (region.kind === 'url' || !overlaps(start, end, region)) return false
      if (allowDefinitionLine && region.kind === 'metadata' && region.start === start && region.end === end) {
        return false
      }
      return true
    })
  }

  // ---- 定義行・見出しの解析 ----
  const definitions: Definition[] = []
  const headings: HeadingInfo[] = []
  for (let i = 0; i < ctx.lines.length; i++) {
    const rawLine = ctx.lines[i]
    const lineStart = ctx.lineStarts[i]
    const lineEnd = lineStart + rawLine.length
    const defMatch = /^ {0,3}\[([^\]\n]+)\]:\s*(.*)$/.exec(rawLine)
    if (defMatch !== null && !isNonProse(lineStart, lineEnd, true)) {
      const id = defMatch[1].trim()
      const rest = defMatch[2]
      definitions.push({
        id,
        url: rest,
        lineStart,
        lineEnd,
        // urlの正規化はextractUrlで行う
      })
    }

    const headMatch = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(rawLine)
    if (headMatch !== null && !isNonProse(lineStart, lineEnd)) {
      headings.push({ text: headMatch[1], line: i, lineStart, lineEnd })
    }
  }

  // ---- 見出しスラグ (GitHub風・dedup付き) ----
  const slugger = new Slugger()
  const validAnchors = new Set<string>()
  const baseCount = new Map<string, number>()
  const duplicateAnchorHeadings: HeadingInfo[] = []
  for (const h of headings) {
    const base = slugger.base(h.text)
    const prev = baseCount.get(base) ?? 0
    baseCount.set(base, prev + 1)
    if (prev > 0) duplicateAnchorHeadings.push(h)
    validAnchors.add(slugger.slug(h.text))
  }

  // ---- 参照使用の解析 ([text][id] / [text][]) ----
  const usedIds = new Set<string>()
  const usageRe = /(!?)\[([^\]\n]*)\]\[([^\]\n]*)\]/g
  let m: RegExpExecArray | null
  while ((m = usageRe.exec(ctx.text)) !== null) {
    if (isNonProse(m.index, m.index + m[0].length)) continue
    const id = m[3].trim() !== '' ? m[3].trim() : m[2].trim()
    if (id !== '') usedIds.add(id)
  }

  const defById = new Map<string, Definition>()
  for (const def of definitions) {
    if (!defById.has(def.id)) defById.set(def.id, def)
  }

  const analysis: RefAnalysis = {
    definitions,
    defById,
    usedIds,
    headings,
    validAnchors,
    duplicateAnchorHeadings
  }
  cacheKey = ctx.text
  cacheValue = analysis
  return analysis
}

/** 定義行のrestから (url, malformed?) を抽出 */
function extractDefUrl(rest: string): { url: string; empty: boolean; malformed: boolean } {
  const trimmed = rest.trim()
  if (trimmed === '') return { url: '', empty: true, malformed: false }
  if (trimmed.startsWith('<')) {
    const close = trimmed.indexOf('>')
    if (close < 0) return { url: trimmed, empty: false, malformed: true }
    const url = trimmed.slice(1, close)
    const after = trimmed.slice(close + 1).trim()
    if (url === '') return { url: '', empty: true, malformed: false }
    if (after !== '' && !/^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\([^)\n]*\))\s*$/.test(after)) {
      return { url, empty: false, malformed: true }
    }
    return { url, empty: false, malformed: false }
  }
  // 角括弧なし: 最初の空白までがURL
  const sp = trimmed.search(/[\s]/)
  const url = sp < 0 ? trimmed : trimmed.slice(0, sp)
  const after = sp < 0 ? '' : trimmed.slice(sp).trim()
  if (url === '') return { url: '', empty: true, malformed: false }
  if (after !== '' && !/^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\([^)\n]*\))\s*$/.test(after)) {
    return { url, empty: false, malformed: true }
  }
  return { url, empty: false, malformed: false }
}

/**
 * Determine whether a reference-style citation resolves to a structurally
 * usable destination under the same definition rules as reference lint.
 * The URL's existence/authority is intentionally not verified.
 */
export function hasUsableReferenceDefinition(ctx: RuleContext, id: string): boolean {
  const definition = getAnalysis(ctx).defById.get(id)
  if (definition === undefined) return false
  const result = extractDefUrl(definition.url)
  return !result.empty && !result.malformed
}

/** inline link [text](url) の検索 (コード内はスキップ) */
interface InlineLink {
  start: number
  end: number
  url: string
  empty: boolean
  malformed: boolean
}

function findInlineLinks(ctx: RuleContext): InlineLink[] {
  const text = ctx.text
  // コード内・メタデータ(定義行等)内のインラインリンクは対象外
  const isMaskedAt = (offset: number): boolean => {
    for (const r of ctx.maskRegions) {
      if (r.kind !== 'url' && offset >= r.start && offset < r.end) return true
    }
    return false
  }
  const links: InlineLink[] = []
  let idx = 0
  while (idx < text.length) {
    const open = text.indexOf('](', idx)
    if (open < 0) break
    if (isMaskedAt(open)) {
      idx = open + 2
      continue
    }
    // 対応する ')' を探す (ネスト考慮)
    let depth = 1
    let k = open + 2
    while (k < text.length && depth > 0) {
      const ch = text[k]
      if (ch === '(') depth++
      else if (ch === ')') depth--
      else if (ch === '\n' && text[k - 1] === '\n') break
      if (depth === 0) break
      k++
    }
    if (k < text.length && text[k] === ')') {
      const inner = text.slice(open + 2, k)
      let url: string
      let empty = false
      let malformed = false
      if (inner.startsWith('<')) {
        const close = inner.indexOf('>')
        if (close < 0) {
          url = inner
          malformed = true
        } else {
          url = inner.slice(1, close)
          if (url === '') empty = true
        }
      } else {
        const sp = inner.search(/\s/)
        url = sp < 0 ? inner : inner.slice(0, sp)
        if (url === '') empty = true
      }
      links.push({ start: open, end: k + 1, url, empty, malformed })
      idx = k + 1
    } else {
      idx = open + 2
    }
  }
  return links
}

// ----------------------------------------------------------------
// ルール定義
// ----------------------------------------------------------------

export const referenceUndefinedRule: CoreRule = {
  id: 'reference/undefined',
  category: 'reference',
  tier: 'deep',
  description:
    '参照IDが定義されていない参照リンク ([text][id]) を検出します。レンダリング時にリンクが機能しないため、errorとして報告します。ショートカット参照 ([text] 単体) は通常の括弧と区別できないため検査対象外です。',
  defaultSeverity: 'error',
  run: (ctx): RawDiagnostic[] => {
    const analysis = getAnalysis(ctx)
    const results: RawDiagnostic[] = []
    // コード内・メタデータ内の参照使用は対象外
    const isMaskedAt = (offset: number): boolean => {
      for (const r of ctx.maskRegions) {
        if (r.kind !== 'url' && offset >= r.start && offset < r.end) return true
      }
      return false
    }
    const re = /(!?)\[([^\]\n]*)\]\[([^\]\n]*)\]/g
    let m: RegExpExecArray | null
    while ((m = re.exec(ctx.text)) !== null) {
      if (isMaskedAt(m.index)) continue
      const id = m[3].trim() !== '' ? m[3].trim() : m[2].trim()
      if (id === '') continue
      if (!analysis.defById.has(id)) {
        results.push({
          start: m.index,
          end: m.index + m[0].length,
          message: `参照ID「${id}」が定義されていません。`
        })
      }
    }
    return results
  }
}

export const referenceEmptyUrlRule: CoreRule = {
  id: 'reference/empty-url',
  category: 'reference',
  tier: 'deep',
  description:
    '空URLの参照定義 ([id]: のURLが空) および空URLのインラインリンク ([text]()) を検出します。',
  defaultSeverity: 'error',
  run: (ctx): RawDiagnostic[] => {
    const analysis = getAnalysis(ctx)
    const results: RawDiagnostic[] = []
    for (const def of analysis.definitions) {
      const extracted = extractDefUrl(def.url)
      if (extracted.empty) {
        results.push({
          start: def.lineStart,
          end: def.lineEnd,
          message: `参照定義「${def.id}」のURLが空です。`
        })
      }
    }
    for (const link of findInlineLinks(ctx)) {
      if (link.empty) {
        results.push({
          start: link.start,
          end: link.end,
          message: 'インラインリンクのURLが空です。'
        })
      }
    }
    return results
  }
}

export const referenceMalformedUrlRule: CoreRule = {
  id: 'reference/malformed-url',
  category: 'reference',
  tier: 'deep',
  description:
    '不正なURL構文 (閉じられていない <、URL直後の引用符なしタイトル等) を検出します。HTTPのオンライン死活確認はCORS制約により対象外です。',
  defaultSeverity: 'error',
  run: (ctx): RawDiagnostic[] => {
    const analysis = getAnalysis(ctx)
    const results: RawDiagnostic[] = []
    for (const def of analysis.definitions) {
      const extracted = extractDefUrl(def.url)
      if (extracted.malformed) {
        results.push({
          start: def.lineStart,
          end: def.lineEnd,
          message: `参照定義「${def.id}」のURL構文が不正です。`
        })
      }
    }
    for (const link of findInlineLinks(ctx)) {
      if (link.malformed) {
        results.push({
          start: link.start,
          end: link.end,
          message: 'インラインリンクのURL構文が不正です。'
        })
      }
    }
    return results
  }
}

export const referenceBrokenAnchorRule: CoreRule = {
  id: 'reference/broken-anchor',
  category: 'reference',
  tier: 'deep',
  description:
    '文書内アンカー参照 ([text](#anchor) および [id]: #anchor) が文書内の見出しスラグ (GitHub風) に対応しない場合に検出します。',
  defaultSeverity: 'warning',
  run: (ctx): RawDiagnostic[] => {
    const analysis = getAnalysis(ctx)
    const results: RawDiagnostic[] = []
    const checkAnchor = (anchor: string, start: number, end: number, label: string): void => {
      if (!anchor.startsWith('#')) return
      const target = anchor.slice(1)
      if (target === '' || !analysis.validAnchors.has(target)) {
        results.push({
          start,
          end,
          message: `${label}のアンカー「#${target}」は文書内の見出しに対応していません。`
        })
      }
    }
    for (const link of findInlineLinks(ctx)) {
      checkAnchor(link.url, link.start, link.end, 'インラインリンク')
    }
    for (const def of analysis.definitions) {
      const extracted = extractDefUrl(def.url)
      if (!extracted.empty && !extracted.malformed) {
        checkAnchor(extracted.url, def.lineStart, def.lineEnd, `参照定義「${def.id}」`)
      }
    }
    return results
  }
}

export const referenceDuplicateIdRule: CoreRule = {
  id: 'reference/duplicate-id',
  category: 'reference',
  tier: 'deep',
  description: '同じ参照IDが複数回定義されている場合に検出します (最初の定義のみ有効)。',
  defaultSeverity: 'warning',
  run: (ctx): RawDiagnostic[] => {
    const analysis = getAnalysis(ctx)
    const results: RawDiagnostic[] = []
    const seen = new Set<string>()
    for (const def of analysis.definitions) {
      if (seen.has(def.id)) {
        results.push({
          start: def.lineStart,
          end: def.lineEnd,
          message: `参照ID「${def.id}」が重複して定義されています (最初の定義のみ有効)。`
        })
      }
      seen.add(def.id)
    }
    return results
  }
}

export const referenceUnusedRule: CoreRule = {
  id: 'reference/unused',
  category: 'reference',
  tier: 'idle',
  description:
    '文書内で一度も使用されていない参照定義を検出します (document-wide解析)。未使用定義は削除を検討してください。',
  defaultSeverity: 'info',
  run: (ctx): RawDiagnostic[] => {
    const analysis = getAnalysis(ctx)
    const results: RawDiagnostic[] = []
    for (const def of analysis.definitions) {
      if (!analysis.usedIds.has(def.id)) {
        results.push({
          start: def.lineStart,
          end: def.lineEnd,
          message: `参照定義「${def.id}」は文書内で使用されていません。`
        })
      }
    }
    return results
  }
}

export const referenceDuplicateAnchorRule: CoreRule = {
  id: 'reference/duplicate-anchor',
  category: 'reference',
  tier: 'idle',
  description:
    '同じ見出しテキスト (同一アンカーを生成する) が複数存在する場合に検出します (GitHubは -1, -2 を付与します)。',
  defaultSeverity: 'warning',
  run: (ctx): RawDiagnostic[] => {
    const analysis = getAnalysis(ctx)
    return analysis.duplicateAnchorHeadings.map((h) => ({
      start: h.lineStart,
      end: h.lineEnd,
      message: `見出し「${h.text}」が重複しており、アンカーが衝突する可能性があります。`
    }))
  }
}
