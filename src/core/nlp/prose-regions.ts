/**
 * AP-09 conservative prose extraction from the ORIGINAL document.
 *
 * This is a narrow interim scanner, not a full CommonMark/Lezer AST parser.
 * Uncertain constructs are skipped rather than allowing an NLP rule to
 * span code, URL destinations, formatting syntax, quotes or table markup.
 * Every region remains an exact, contiguous UTF-16 slice of the source.
 */
import type { DocumentType } from '../types'
import { maskDocument } from '../text/mask'
import type { MaskRegion } from '../types'
import type { ProseRegion } from './types'

const HARD_MARKUP = new Set(['*', '_', '~', '`', '[', ']', '(', ')', '\\'])

function hasUnpairedSurrogate(text: string): boolean {
  for (const scalar of text) {
    const cp = scalar.codePointAt(0)!
    if (cp >= 0xD800 && cp <= 0xDFFF) return true
  }
  return false
}

function isUncertainMarkdownLine(line: string): boolean {
  if (/^\s*$/.test(line)) return true
  if (/^\s*>/u.test(line) || /^\s*(?:[-+*]|\d{1,9}[.)])\s+>/u.test(line)) return true
  if (/^ {0,3}(?:[-*_][ \t]*){3,}$/u.test(line)) return true
  // Table cell extraction requires a Markdown AST. Skip table-like lines
  // (including their header/delimiter rows) instead of merging columns.
  if (line.includes('|')) return true
  // Raw HTML and ambiguous markup must not be assumed to be prose.
  // HTML comments are already masked by maskDocument. Their trailing
  // visible prose is still eligible if there is no other HTML markup.
  const withoutComments = line.replace(/<!--[\s\S]*?-->/gu, '')
  if (/<\/?[A-Za-z!][^>]*>/u.test(withoutComments) ||
      /<\/?[A-Za-z!][^>]*$/u.test(withoutComments)) return true
  return hasUnpairedSurrogate(line)
}

interface LinePlan {
  readonly start: number
  readonly end: number
  readonly kind: ProseRegion['kind']
}

function planLine(line: string, documentType: DocumentType): LinePlan | null {
  if (documentType === 'text') {
    if (/^\s*$/u.test(line) || hasUnpairedSurrogate(line)) return null
    return { start: 0, end: line.length, kind: 'paragraph' }
  }
  if (isUncertainMarkdownLine(line)) return null

  let start = 0
  let end = line.length
  let kind: ProseRegion['kind'] = 'paragraph'
  const heading = /^ {0,3}#{1,6}[ \t]+/u.exec(line)
  const list = /^[ \t]*(?:[-+*]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/u.exec(line)
  if (heading !== null) {
    start = heading[0].length
    kind = 'heading'
    const closingHashes = /[ \t]+#+[ \t]*$/u.exec(line)
    if (closingHashes !== null) end = closingHashes.index
  } else if (list !== null) {
    start = list[0].length
    kind = 'list'
  } else if (/^\s{0,3}(?:#{1,6}|!\[|\[\^)/u.test(line) && !line.includes('](')) {
    // An unsupported structural/definition-like line: skip rather than
    // inventing an NLP position across Markdown syntax.
    return null
  }
  if (start >= end) return null
  return { start, end, kind }
}

/**
 * Extract contiguous prose only. No text rewriting, Unicode normalization,
 * web requests, persistence, or implicit NLP execution occurs.
 */
export function extractProseRegions(
  source: string,
  documentType: DocumentType = 'markdown'
): readonly ProseRegion[] {
  if (source.length === 0) return Object.freeze([])
  const masked: readonly MaskRegion[] = documentType === 'markdown'
    ? maskDocument(source).regions : []
  const regions: ProseRegion[] = []
  let maskIndex = 0
  let lineStart = 0

  while (lineStart < source.length) {
    const newline = source.indexOf('\n', lineStart)
    const lineEnd = newline === -1 ? source.length : newline
    // Keep offsets in the ORIGINAL source even when CRLF is present.
    const contentEnd = lineEnd > lineStart && source[lineEnd - 1] === '\r'
      ? lineEnd - 1 : lineEnd
    const line = source.slice(lineStart, contentEnd)
    // The existing masker is authoritative for paired inline backtick runs.
    // If any backtick is not protected, the construct is ambiguous and the
    // entire line is excluded rather than parsing potentially executable code.
    let unmaskedBacktick = false
    if (documentType === 'markdown' && line.includes('`')) {
      let probe = maskIndex
      for (let tick = line.indexOf('`'); tick >= 0; tick = line.indexOf('`', tick + 1)) {
        const absolute = lineStart + tick
        while (probe < masked.length && masked[probe]!.end <= absolute) probe++
        if (probe >= masked.length || masked[probe]!.start > absolute) {
          unmaskedBacktick = true
          break
        }
      }
    }
    const plan = unmaskedBacktick ? null : planLine(line, documentType)
    if (plan !== null) {
      const linkLabels = documentType === 'markdown'
        ? [...line.matchAll(/!?\[([^\]\[\r\n]+)\]\(/gu)]
          .map(match => {
            const labelStart = (match.index ?? 0) + match[0].indexOf('[') + 1
            return { start: labelStart, end: labelStart + match[1].length }
          })
        : []
      let labelIndex = 0
      const start = lineStart + plan.start
      const end = lineStart + plan.end
      let runStart = -1
      let runKind: ProseRegion['kind'] = plan.kind
      const flush = (position: number): void => {
        if (runStart < 0) return
        let a = runStart
        let b = position
        while (a < b && /\s/u.test(source[a]!)) a++
        while (b > a && /\s/u.test(source[b - 1]!)) b--
        if (a < b) {
          const text = source.slice(a, b)
          regions.push(Object.freeze({
            id: `prose:${a}-${b}`,
            sourceStartUtf16: a,
            sourceEndUtf16: b,
            kind: runKind,
            text
          }))
        }
        runStart = -1
      }

      for (let pos = start; pos < end; pos++) {
        while (maskIndex < masked.length && masked[maskIndex]!.end <= pos) maskIndex++
        const isMasked = maskIndex < masked.length &&
          masked[maskIndex]!.start <= pos && pos < masked[maskIndex]!.end
        const local = pos - lineStart
        const ch = source[pos]!
        while (labelIndex < linkLabels.length && linkLabels[labelIndex]!.end <= local) labelIndex++
        const label = linkLabels[labelIndex]
        const kind = label !== undefined && label.start <= local && local < label.end
          ? 'link-label' : plan.kind
        const isMarkup = documentType === 'markdown' &&
          (HARD_MARKUP.has(ch) || (ch === '!' && line[local + 1] === '['))
        if (isMasked || isMarkup) {
          flush(pos)
        } else {
          if (runStart >= 0 && kind !== runKind) flush(pos)
          if (runStart < 0) {
            runStart = pos
            runKind = kind
          }
        }
      }
      flush(end)
    }

    if (newline === -1) break
    lineStart = newline + 1
  }
  return Object.freeze(regions)
}
