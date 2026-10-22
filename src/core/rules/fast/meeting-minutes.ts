import type { CoreRule, RawDiagnostic, RuleContext } from '../../types'

/**
 * Only explicit meeting-minutes documents are checked. The presence and
 * correctness of attendees / decisions cannot be inferred from prose alone.
 */
export const meetingMinutesSectionsRule: CoreRule = {
  id: 'style/meeting-minutes-sections',
  category: 'style',
  tier: 'fast',
  defaultSeverity: 'info',
  description: '冒頭に「議事録」と明記した文書について、参加者と決定事項の記載欄を確認します。内容の事実関係は判定しません。',
  run(ctx: RuleContext): RawDiagnostic[] {
    const first = ctx.lines.findIndex(line => line.trim().length > 0)
    if (first === -1) return []
    const heading = ctx.lines[first]!.trim()
    // Require a document title rather than any mention of the word.
    if (!/^(?:#{1,6}[ \t]+)?議事録(?:[ \t　：:].*)?$/u.test(heading)) return []
    const start = ctx.lineStarts[first]! + ctx.lines[first]!.indexOf('議事録')
    const visibleLines = ctx.lines.map((line, i) => {
      const offset = ctx.lineStarts[i]!
      const maskedLine = ctx.maskedText.slice(offset, offset + line.length)
      return maskedLine.includes('\uFFFF') ? maskedLine.replace(/\uFFFF/gu, '') : maskedLine
    })
    const body = visibleLines.slice(first + 1).join('\n')
    const checks: Array<[RegExp, string]> = [
      [/(?:参加者|出席者|出席メンバー)[ \t　]*[：:]/u, '参加者'],
      [/(?:決定事項|決議事項|決まったこと)[ \t　]*[：:]/u, '決定事項']
    ]
    return checks.flatMap(([pattern, label]): RawDiagnostic[] =>
      pattern.test(body) ? [] : [{
        start, end: start + '議事録'.length,
        message: `議事録に「${label}」の項目が見当たりません。未決定・欠席・該当なしの場合も、その旨を明示してください。`,
        fixKind: 'none'
      }]
    )
  }
}
