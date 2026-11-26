import { describe, expect, it } from 'vitest'
import { normalizePreviewSource, previewBlockAtOffset, resolvePreviewSourceRange } from '../../src/core/markdown/source-map'

describe('Markdown source mapping', () => {
  const blocks = [{ from: 2, to: 5 }, { from: 8, to: 12 }, { from: 15, to: 20 }]
  it('maps positions, whitespace and document edges to the preceding visible block', () => {
    expect([0, 2, 5, 7, 8, 14, 15, 30].map(offset => previewBlockAtOffset(blocks, offset))).toEqual([0, 0, 0, 0, 1, 1, 2, 2])
    expect(previewBlockAtOffset([], 0)).toBeUndefined()
    expect(previewBlockAtOffset(blocks, -1)).toBeUndefined()
  })
  it('uses the same normalized UTF-16 positions as CodeMirror', () => {
    const source = '😀\r\n本文\r末尾'
    const normalized = normalizePreviewSource(source)
    expect(normalized).toBe('😀\n本文\n末尾')
    expect(resolvePreviewSourceRange(source, normalized, [{ from: 3, to: 5 }], 0)).toEqual({ from: 3, to: 5 })
  })
  it('refuses stale text, invalid indexes and surrogate boundaries', () => {
    expect(resolvePreviewSourceRange('古い', '新しい', [{ from: 0, to: 2 }], 0)).toBeUndefined()
    expect(resolvePreviewSourceRange('😀', '😀', [{ from: 1, to: 2 }], 0)).toBeUndefined()
    expect(resolvePreviewSourceRange('a', 'a', [{ from: 0, to: 2 }], 0)).toBeUndefined()
    expect(resolvePreviewSourceRange('a', 'a', [{ from: 0, to: 1 }], -1)).toBeUndefined()
  })
})
