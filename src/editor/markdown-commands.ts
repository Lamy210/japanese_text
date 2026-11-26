/** Pure UTF-16 edit plans; no DOM, storage or Markdown execution. */
export type MarkdownCommand = 'bold' | 'italic' | 'inline-code' | 'heading' | 'quote' | 'list' | 'table' | 'mermaid'
export interface MarkdownEdit {
  readonly from: number
  readonly to: number
  readonly insert: string
  readonly anchor: number
  readonly head: number
}

export function planMarkdownEdit(text: string, from: number, to: number, command: MarkdownCommand): MarkdownEdit | null {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > text.length) return null
  const splitsPair = (offset: number): boolean =>
    offset > 0 && offset < text.length &&
    /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset])
  if (splitsPair(from) || splitsPair(to)) return null

  const selected = text.slice(from, to)
  if (command === 'bold' || command === 'italic' || command === 'inline-code') {
    if (selected.includes('\n') || selected.includes('\r')) return null
    let mark = command === 'bold' ? '**' : command === 'italic' ? '*' : '\x60'
    if (command === 'inline-code') {
      const runs = selected.match(/\x60+/g) ?? []
      mark = '\x60'.repeat(Math.max(0, ...runs.map(run => run.length)) + 1)
    }
    const value = selected || (command === 'inline-code' ? 'code' : 'テキスト')
    const pad = command === 'inline-code' && (/^\x60|\x60$/.test(value) || (/^ .* $/.test(value) && /[^ ]/.test(value))) ? ' ' : ''
    const insert = mark + pad + value + pad + mark
    const anchor = from + mark.length + pad.length
    return { from, to, insert, anchor, head: anchor + value.length }
  }

  if (command === 'heading' || command === 'quote' || command === 'list') {
    const start = from === 0 ? 0 : text.lastIndexOf('\n', from - 1) + 1
    const last = to > from && text[to - 1] === '\n' ? to - 1 : to
    const newline = text.indexOf('\n', last)
    const end = newline === -1 ? text.length : newline
    const original = text.slice(start, end)
    const prefix = command === 'heading' ? '## ' : command === 'quote' ? '> ' : '- '
    const insert = original.split('\n').map(line => prefix + line).join('\n')
    return { from: start, to: end, insert, anchor: start, head: start + insert.length }
  }

  // Templates are inserted only at a collapsed cursor. Never overwrite selected prose.
  if (from !== to) return null
  const block = command === 'table'
    ? '| 項目 | 内容 |\n| --- | --- |\n|  |  |'
    : '\x60\x60\x60mermaid\nflowchart TD\n  A[開始] --> B[終了]\n\x60\x60\x60'
  const before = from === 0 ? '' : text.slice(0, from).endsWith('\n\n') ? '' : text[from - 1] === '\n' ? '\n' : '\n\n'
  const after = to === text.length ? '\n' : text.slice(to).startsWith('\n\n') ? '' : text[to] === '\n' ? '\n' : '\n\n'
  const insert = before + block + after
  return { from, to, insert, anchor: from + before.length, head: from + before.length + block.length }
}
