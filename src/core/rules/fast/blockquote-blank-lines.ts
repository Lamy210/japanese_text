import type { CoreRule, RawDiagnostic, RuleContext } from '../../types'

/**
 * Informational spacing guidance for a top-level Markdown blockquote group.
 * A contiguous group of quote lines is treated as one block.
 * Markdown permits adjacent paragraphs; this rule is a writing preference,
 * not a CommonMark validity check.
 */
export const blockquoteBlankLinesRule: CoreRule = {
  id: 'markdown/blockquote-blank-lines',
  category: 'markdown',
  tier: 'fast',
  defaultSeverity: 'info',
  description: '本文に隣接するMarkdown引用ブロックの前後に空行を設けるよう案内します。Markdownの構文エラーとは判定しません。',
  run(ctx: RuleContext): RawDiagnostic[] {
    const diagnostics: RawDiagnostic[] = []
    const isQuote = (line: string) => /^ {0,3}>/u.test(line)
    const isProse = (line: string) =>
      line.trim().length > 0 &&
      !/^ {0,3}(?:#{1,6}[ \t]|[-*+][ \t]|\d+[.)][ \t]|\||```|~~~)/u.test(line)
    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!
      if (!isQuote(line) || (i > 0 && isQuote(ctx.lines[i - 1]!))) continue
      const offset = ctx.lineStarts[i]!
      // Never inspect a code fence / YAML frontmatter / HTML comment.
      if (ctx.maskedText[offset + line.indexOf('>')] === '\uFFFF') continue
      let last = i
      while (last + 1 < ctx.lines.length && isQuote(ctx.lines[last + 1]!)) last++
      const before = i > 0 ? ctx.lines[i - 1]! : ''
      const after = last + 1 < ctx.lines.length ? ctx.lines[last + 1]! : ''
      if (i > 0 && isProse(before)) {
        diagnostics.push({
          start: offset + line.indexOf('>'), end: offset + line.indexOf('>') + 1,
          message: '引用ブロックの前に空行を入れると、本文との区切りが明確になります。',
          fixKind: 'none'
        })
      }
      if (last + 1 < ctx.lines.length && isProse(after)) {
        const endOffset = ctx.lineStarts[last + 1]!
        diagnostics.push({
          start: endOffset, end: endOffset + 1,
          message: '引用ブロックの後に空行を入れると、回答本文との区切りが明確になります。',
          fixKind: 'none'
        })
      }
      i = last
    }
    return diagnostics
  }
}
