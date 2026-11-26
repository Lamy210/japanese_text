import { describe, expect, it } from 'vitest'
import { planMarkdownEdit } from '../../src/editor/markdown-commands'

describe('Markdown toolbar edit plans', () => {
  it('wraps Japanese selection and preserves the inner selection', () => {
    expect(planMarkdownEdit('前文章後', 1, 3, 'bold')).toEqual({
      from: 1, to: 3, insert: '**文章**', anchor: 3, head: 5
    })
  })
  it('selects a placeholder when no text is selected', () => {
    expect(planMarkdownEdit('', 0, 0, 'italic')).toEqual({
      from: 0, to: 0, insert: '*テキスト*', anchor: 1, head: 5
    })
  })
  it('uses longer backtick delimiters for inline code', () => {
    expect(planMarkdownEdit('a\x60b', 0, 3, 'inline-code')?.insert).toBe('\x60\x60a\x60b\x60\x60')
    expect(planMarkdownEdit('\x60', 0, 1, 'inline-code')?.insert).toBe('\x60\x60 \x60 \x60\x60')
  })
  it('prefixes whole selected lines without including the next line', () => {
    expect(planMarkdownEdit('一行\n二行\n三行', 1, 6, 'list')).toEqual({
      from: 0, to: 5, insert: '- 一行\n- 二行', anchor: 0, head: 9
    })
  })
  it('inserts templates without replacing text and separates surrounding paragraphs', () => {
    expect(planMarkdownEdit('前後', 1, 1, 'table')?.insert).toBe('\n\n| 項目 | 内容 |\n| --- | --- |\n|  |  |\n\n')
    expect(planMarkdownEdit('前後', 0, 2, 'mermaid')).toBeNull()
    expect(planMarkdownEdit('', 0, 0, 'mermaid')?.insert).toContain('flowchart TD')
  })
  it('rejects multiline inline formatting and invalid UTF-16 boundaries', () => {
    expect(planMarkdownEdit('a\nb', 0, 3, 'bold')).toBeNull()
    expect(planMarkdownEdit('😀', 1, 1, 'italic')).toBeNull()
    expect(planMarkdownEdit('文', -1, 0, 'heading')).toBeNull()
  })
})
