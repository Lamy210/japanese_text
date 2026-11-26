import { markdownLanguage } from '@codemirror/lang-markdown'

type Node = ReturnType<typeof markdownLanguage.parser.parse>['topNode']

export const MAX_PREVIEW_LENGTH = 200_000
const MAX_RENDER_DEPTH = 64
export const MAX_OUTLINE_HEADINGS = 300

export interface MarkdownHeading {
  readonly level: number
  readonly label: string
  readonly index: number
}

export type MarkdownPreviewResult =
  | { status: 'ready'; html: string; headings: MarkdownHeading[]; headingCount: number }
  | { status: 'too-large' | 'failed' }

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]!)
}

/**
 * Use the editor's Markdown grammar, not user-provided HTML.
 * Every source fragment is escaped; element names are fixed below.
 * No href, src, style or event attributes are generated.
 */
export function renderMarkdownPreview(source: string): MarkdownPreviewResult {
  if (source.length > MAX_PREVIEW_LENGTH) return { status: 'too-large' }
  try {
    const text = source.replace(/\r\n?/g, '\n')
    const headings: MarkdownHeading[] = []
    let headingCount = 0
    const raw = (node: Node) => text.slice(node.from, node.to)
    const children = (node: Node): Node[] => {
      const result: Node[] = []
      for (let child = node.firstChild; child; child = child.nextSibling) result.push(child)
      return result
    }
    const marks = new Set(['HeaderMark', 'QuoteMark', 'ListMark', 'EmphasisMark',
      'CodeMark', 'LinkMark', 'StrikethroughMark', 'SubscriptMark', 'SuperscriptMark',
      'TableDelimiter'])
    const inline = (node: Node, depth: number, from = node.from, to = node.to): string => {
      let output = ''
      let cursor = from
      for (const child of children(node)) {
        if (child.from < from || child.to > to) continue
        output += escapeHtml(text.slice(cursor, child.from))
        if (!marks.has(child.name)) output += render(child, depth + 1)
        cursor = child.to
      }
      return output + escapeHtml(text.slice(cursor, to))
    }
    const blocks = (node: Node, depth: number): string => children(node)
      .filter(child => !marks.has(child.name))
      .map(child => render(child, depth + 1)).join('')
    const render = (node: Node, depth: number): string => {
      if (depth > MAX_RENDER_DEPTH) throw new Error('Markdown nesting limit')
      const content = () => inline(node, depth)
      const blockContent = () => blocks(node, depth)
      const heading = /^(?:ATX|Setext)Heading([1-6])$/.exec(node.name)
      if (heading) {
        const tag = 'h' + heading[1]
        const index = headingCount++
        if (headings.length < MAX_OUTLINE_HEADINGS) {
          // Strip only heading delimiters; keep inline source notation as a plain-text label.
          let label = ''
          let cursor = node.from
          for (const child of children(node)) {
            if (child.name !== 'HeaderMark') continue
            label += text.slice(cursor, child.from)
            cursor = child.to
          }
          label += text.slice(cursor, node.to)
          headings.push({ level: Number(heading[1]), label: label.trim().replace(/\s+/g, ' ') || '（空の見出し）', index })
        }
        return '<' + tag + '>' + content().trim() + '</' + tag + '>'
      }
      switch (node.name) {
        case 'Document': return blockContent()
        case 'Paragraph': return '<p>' + content() + '</p>'
        case 'StrongEmphasis': return '<strong>' + content() + '</strong>'
        case 'Emphasis': return '<em>' + content() + '</em>'
        case 'Strikethrough': return '<del>' + content() + '</del>'
        case 'Subscript': return '<sub>' + content() + '</sub>'
        case 'Superscript': return '<sup>' + content() + '</sup>'
        case 'Blockquote': return '<blockquote>' + blockContent() + '</blockquote>'
        case 'HorizontalRule': return '<hr>'
        case 'BulletList': return '<ul>' + blockContent() + '</ul>'
        case 'OrderedList': {
          const marker = children(node).find(child => child.name === 'ListItem')?.firstChild
          const start = marker?.name === 'ListMark' ? /^\d{1,9}/.exec(raw(marker))?.[0] : undefined
          return '<ol' + (start ? ' start="' + Number(start) + '"' : '') + '>' + blockContent() + '</ol>'
        }
        case 'ListItem': return '<li>' + blockContent() + '</li>'
        case 'Task': return '<p>' + content() + '</p>'
        case 'TaskMarker': return /\[[xX]\]/.test(raw(node)) ? '☑' : '☐'
        case 'Table': return '<table>' + blockContent() + '</table>'
        case 'TableHeader': return '<thead><tr>' + children(node).filter(child => child.name === 'TableCell')
          .map(child => '<th>' + inline(child, depth + 1) + '</th>').join('') + '</tr></thead>'
        case 'TableRow': return '<tr>' + children(node).filter(child => child.name === 'TableCell')
          .map(child => '<td>' + inline(child, depth + 1) + '</td>').join('') + '</tr>'
        case 'CodeBlock':
        case 'FencedCode': {
          const code = children(node).filter(child => child.name === 'CodeText').map(raw).join('\n')
          const info = children(node).find(child => child.name === 'CodeInfo')
          const language = info ? raw(info).trim().split(/\s+/)[0]?.toLowerCase() : undefined
          // Language label is display-only; never becomes an attribute or renderer selection.
          if (language === 'mermaid') {
            return '<figure class="md-code-figure"><figcaption>Mermaid（ソース表示・図の描画は未対応）</figcaption><pre><code>' + escapeHtml(code) + '</code></pre></figure>'
          }
          if (language && /^[a-z0-9_+#.-]{1,32}$/.test(language)) {
            return '<figure class="md-code-figure"><figcaption>' + escapeHtml(language) + '</figcaption><pre><code>' + escapeHtml(code) + '</code></pre></figure>'
          }
          return '<pre><code>' + escapeHtml(code) + '</code></pre>'
        }
        case 'InlineCode': {
          const marker = children(node).find(child => child.name === 'CodeMark')
          const length = marker ? marker.to - marker.from : 0
          let code = raw(node).slice(length, raw(node).length - length).replace(/\n/g, ' ')
          if (code.startsWith(' ') && code.endsWith(' ') && /[^ ]/.test(code)) code = code.slice(1, -1)
          return '<code>' + escapeHtml(code) + '</code>'
        }
        case 'Link':
        case 'Image': {
          const delimiters = children(node).filter(child => child.name === 'LinkMark')
          const opening = delimiters[0]
          const closing = delimiters[1]
          const label = opening && closing
            ? inline(node, depth, opening.to, closing.from) : escapeHtml(raw(node))
          if (node.name === 'Image') return '<span class="md-image-placeholder">[画像: ' + label + ']</span>'
          return '<span class="md-link-label">' + label + '</span>'
        }
        case 'Autolink': return '<span class="md-link-label">' + escapeHtml(raw(node).slice(1, -1)) + '</span>'
        case 'URL': return '<span class="md-link-label">' + escapeHtml(raw(node)) + '</span>'
        case 'HardBreak': return '<br>'
        case 'Escape': return escapeHtml(raw(node).slice(1))
        case 'Entity': {
          // Only complete, recognized entities; HTML decoding is never used on arbitrary input.
          const entity = raw(node)
          const known: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': '\u00a0' }
          if (Object.hasOwn(known, entity)) return escapeHtml(known[entity])
          const match = /^&#(x[0-9a-f]+|\d+);$/i.exec(entity)
          if (match) {
            const value = match[1].toLowerCase().startsWith('x') ? parseInt(match[1].slice(1), 16) : Number(match[1])
            if (value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff)) {
              return escapeHtml(String.fromCodePoint(value))
            }
          }
          return escapeHtml(entity)
        }
        case 'LinkReference':
        case 'CommentBlock':
        case 'Comment': return ''
        case 'HTMLBlock': return '<pre class="md-raw-html">' + escapeHtml(raw(node)) + '</pre>'
        default: return escapeHtml(raw(node))
      }
    }
    const html = render(markdownLanguage.parser.parse(text).topNode, 0)
    return { status: 'ready', html, headings, headingCount }
  } catch {
    return { status: 'failed' }
  }
}
