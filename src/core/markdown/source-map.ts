/** Source ranges are UTF-16 offsets in LF-normalized CodeMirror text. */
export interface PreviewSourceRange {
  readonly from: number
  readonly to: number
}

export function normalizePreviewSource(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

/** Prefer the preceding visible block in whitespace, and clamp to first/last block. */
export function previewBlockAtOffset(blocks: readonly PreviewSourceRange[], offset: number): number | undefined {
  if (blocks.length === 0 || !Number.isInteger(offset) || offset < 0) return undefined
  let low = 0
  let high = blocks.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (blocks[mid].from <= offset) low = mid + 1
    else high = mid
  }
  return Math.max(0, low - 1)
}

/** Refuse stale document text, invalid indexes, and surrogate-splitting ranges. */
export function resolvePreviewSourceRange(
  renderedText: string,
  editorText: string,
  ranges: readonly PreviewSourceRange[],
  index: number
): PreviewSourceRange | undefined {
  if (normalizePreviewSource(renderedText) !== editorText || !Number.isInteger(index) || index < 0) return undefined
  const range = ranges[index]
  if (!range || !Number.isInteger(range.from) || !Number.isInteger(range.to) ||
      range.from < 0 || range.to <= range.from || range.to > editorText.length) return undefined
  const splitsPair = (offset: number): boolean =>
    offset > 0 && offset < editorText.length &&
    /[\uD800-\uDBFF]/.test(editorText[offset - 1]) && /[\uDC00-\uDFFF]/.test(editorText[offset])
  return splitsPair(range.from) || splitsPair(range.to) ? undefined : range
}
