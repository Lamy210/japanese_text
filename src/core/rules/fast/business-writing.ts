import type { CoreRule, RawDiagnostic, RuleContext } from '../../types'

/**
 * Markdown 引用記号の直後に空白がない場合だけ指摘する。
 * 引用内容の完全性や質問との対応はテキストだけでは判定しない。
 */
export const blockquoteSpacingRule: CoreRule = {
  id: 'markdown/blockquote-spacing',
  category: 'markdown',
  tier: 'fast',
  defaultSeverity: 'info',
  description: 'Markdown引用行で「>」の後に半角スペースがない場合に案内します。引用の完全性・回答との対応は判定しません。',
  run(ctx: RuleContext): RawDiagnostic[] {
    const diagnostics: RawDiagnostic[] = []
    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!
      // A single Markdown quote prefix, allowing up to three leading spaces.
      const match = /^( {0,3})>([^>\s])/.exec(line)
      if (!match) continue
      const start = ctx.lineStarts[i]! + match[1]!.length + 1
      // Masked code fences, indented code and HTML comments must be ignored.
      if (ctx.maskedText[start] !== line[start - ctx.lineStarts[i]!]) continue
      diagnostics.push({
        start,
        end: start + match[2]!.length,
        message: 'Markdown引用の「>」の後には半角スペースを入れてください。引用の前後の空行と、質問文が省略されていないかも確認してください。',
        fixKind: 'none'
      })
    }
    return diagnostics
  }
}

/**
 * クッション言葉は依頼が実在する場合にも使われるため、削除は提案しない。
 * 文頭にある固定表現だけを、送信前の確認事項として表示する。
 */
export const unnecessaryCushionRule: CoreRule = {
  id: 'wording/request-cushion-review',
  category: 'wording',
  tier: 'fast',
  defaultSeverity: 'info',
  description: '「お手数をおかけしますが」などの定型句について、実際の依頼内容に合うか確認を促します。自動削除はしません。',
  run(ctx: RuleContext): RawDiagnostic[] {
    const diagnostics: RawDiagnostic[] = []
    const pattern = /(?:^|[。！？\n])[ \t　]*(お手数をおかけしますが[、，]?)/gu
    for (const match of ctx.maskedText.matchAll(pattern)) {
      const phrase = match[1]!
      const start = match.index + match[0].lastIndexOf(phrase)
      diagnostics.push({
        start,
        end: start + phrase.length,
        message: '実際に相手へ作業を依頼する文脈か確認してください。依頼がなければこのクッション言葉は不要な場合があります。',
        fixKind: 'none'
      })
    }
    return diagnostics
  }
}
