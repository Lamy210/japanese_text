import { isUtf16CodePointBoundary } from '../text/positions'

/**
 * textlint's reporting range and optional FixCommand.range can differ.
 * Never fabricate a clickable range from an invalid third-party offset.
 * All coordinates are UTF-16 indices, matching the editor's document model.
 */
export interface TextlintMessageSpanInput {
  readonly range?: readonly number[] | null
  readonly index?: number
  readonly fix?: { readonly range?: readonly number[] | null; readonly text?: unknown } | null
}

export type TextlintMessageSpan =
  | { readonly start: number; readonly end: number; readonly fixKind: 'none'; readonly invalidFix: boolean; readonly replacement?: undefined }
  | { readonly start: number; readonly end: number; readonly fixKind: 'suggestion'; readonly invalidFix: false; readonly replacement: string }

function validRange(range: readonly number[] | null | undefined, text: string): range is readonly [number, number] {
  if (!Array.isArray(range) || range.length !== 2) return false
  const [start, end] = range
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) &&
    start >= 0 && end >= start && end <= text.length &&
    isUtf16CodePointBoundary(text, start) && isUtf16CodePointBoundary(text, end)
}

/**
 * Return null for invalid report coordinates (reported as a rule error).
 * When only a fix is invalid, retain the informational diagnostic but
 * downgrade it to non-actionable instead of risking an incorrect edit.
 */
export function normalizeTextlintMessageSpan(
  message: TextlintMessageSpanInput,
  text: string
): TextlintMessageSpan | null {
  const documentLength = text.length
  const index = message.index
  const range = message.range === undefined || message.range === null
    ? typeof index === 'number' && Number.isSafeInteger(index) &&
      index >= 0 && index <= documentLength
      ? [index, Math.min(documentLength, index + 1)]
      : null
    : message.range
  if (!validRange(range, text)) return null

  const fix = message.fix
  if (fix === undefined || fix === null) {
    return { start: range[0], end: range[1], fixKind: 'none', invalidFix: false }
  }
  if (typeof fix.text !== 'string' || !validRange(fix.range, text)) {
    return { start: range[0], end: range[1], fixKind: 'none', invalidFix: true }
  }
  // TextlintFixCommand.range is the actual replacement target. The report
  // range can cover an entire sentence while the fix changes one word.
  return { start: fix.range[0], end: fix.range[1], fixKind: 'suggestion', replacement: fix.text, invalidFix: false }
}
