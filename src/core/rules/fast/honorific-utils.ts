/**
 * Shared guards for conservative honorific rules.
 * Preserve UTF-16 offsets by masking quotes with one replacement code unit
 * per original code unit. Quoted examples are not attributed to the author.
 */
import type { RuleContext } from '../../types'

export function maskHonorificQuotedExamples(maskedText: string): string {
  return maskedText.replace(/「[^」]*(?:」|$)|『[^』]*(?:』|$)/gu, quote =>
    '\uFFFF'.repeat(quote.length)
  )
}

/** Binary search of line starts prevents quadratic scans on many findings. */
export function isMarkdownBlockquoteAt(ctx: RuleContext, offset: number): boolean {
  let lo = 0
  let hi = ctx.lineStarts.length - 1
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (ctx.lineStarts[mid]! <= offset) lo = mid
    else hi = mid - 1
  }
  return /^ {0,3}>/u.test(ctx.lines[lo] ?? '')
}
