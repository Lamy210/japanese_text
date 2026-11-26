import { describe, expect, it } from 'vitest'
import { MAX_PREVIEW_LENGTH, renderMarkdownPreview } from '../../src/core/markdown/preview'

function html(source: string): string {
  const result = renderMarkdownPreview(source)
  if (result.status !== 'ready') throw new Error(result.status)
  return result.html
}

describe('Markdown preview', () => {
  it('renders Japanese headings, paragraphs and nested emphasis', () => {
    const output = html('# 日本語\n\nこれは **重要** な *文章* です。')
    expect(output).toContain('<h1>日本語</h1>')
    expect(output).toContain('<strong>重要</strong>')
    expect(output).toContain('<em>文章</em>')
  })

  it('renders lists, blockquotes, tables and inline code', () => {
    const output = html('- 項目\n- 次\n\n> 引用\n\n| 名前 | 値 |\n| --- | --- |\n| 雪 | 1 |\n\n' + '\x60コード\x60')
    for (const tag of ['ul', 'li', 'blockquote', 'table', 'th', 'td']) {
      expect(output).toContain('<' + tag + '>')
    }
    expect(output).toContain('<code>コード</code>')
  })

  it('preserves code and never emits source HTML as markup', () => {
    const output = html('\x60\x60\x60html\n<script>alert(1)</script>\n\x60\x60\x60\n\n<img src=x onerror=alert(1)>')
    expect(output).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(output).not.toContain('<script')
    expect(output).not.toContain('<img')
  })

  it('never creates navigation or resource requests from Markdown destinations', () => {
    const output = html('[危険](javascript:alert(1)) ![代替](https://example.invalid/tracking.png)\n\n<https://example.invalid>')
    expect(output).toContain('危険')
    expect(output).toContain('代替')
    expect(output).not.toMatch(/<(?:a|img|iframe|script|svg)(?:\s|>)/i)
    expect(output).not.toMatch(/\s(?:src|href|onerror)=/i)
  })

  it('does not turn encoded markup into active HTML', () => {
    const output = html('&lt;script&gt; &#x3c;img&#x3e;')
    expect(output).toContain('&lt;script&gt;')
    expect(output).not.toMatch(/<(?:script|img)/i)
  })

  it('supports CRLF, blank documents and a bounded preview', () => {
    expect(html('# 見出し\r\n\r\n本文')).toContain('<h1>見出し</h1>')
    expect(html('')).toBe('')
    expect(renderMarkdownPreview('あ'.repeat(MAX_PREVIEW_LENGTH + 1))).toEqual({ status: 'too-large' })
  })
})
