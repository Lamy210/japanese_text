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
      return maskedLine.includes('\uFFFF') ? '' : maskedLine
    })
    const bodyLines = visibleLines.slice(first + 1).map(line => line.trim().replace(/^(?:#{1,6}|[-*+]|\d+[.)])[ \t]+/u, ''))
    const hasSection = (pattern: RegExp) => bodyLines.some(line => pattern.test(line))
    const checks: Array<[RegExp, string]> = [
      [/^(?:参加者|出席者|出席メンバー)[ \t　]*[：:]/u, '参加者'],
      [/^(?:決定事項|決議事項|決まったこと)[ \t　]*[：:]/u, '決定事項']
    ]
    const diagnostics: RawDiagnostic[] = checks.flatMap(([pattern, label]) =>
      hasSection(pattern) ? [] : [{
        start, end: start + '議事録'.length,
        message: `議事録に「${label}」の項目が見当たりません。未決定・欠席・該当なしの場合も、その旨を明示してください。`,
        fixKind: 'none' as const
      }]
    )
    if (hasSection(/^(?:対応事項|アクションアイテム|ToDo|TODO)[ \t　]*[：:]/u) &&
        !hasSection(/^(?:担当者|担当|オーナー)[ \t　]*[：:]/u)) {
      diagnostics.push({ start, end: start + '議事録'.length,
        message: '対応事項が記載されています。担当者の欄も明示して、対応漏れを防いでください。', fixKind: 'none' })
    }
    if (hasSection(/^(?:対応事項|アクションアイテム|ToDo|TODO)[ \t　]*[：:]/u) &&
        !hasSection(/^(?:期限|対応期限|締切|締め切り|期日)[ \t　]*[：:]/u)) {
      diagnostics.push({
        start, end: start + '議事録'.length,
        message: '対応事項が記載されています。対応期限や期日の欄を明示してください。期限未定の場合もその旨を記載してください。',
        fixKind: 'none'
      })
    }
    // Only an explicit undecided decision label triggers this guidance.
    const undecidedDecision = bodyLines.some(line =>
      /^(?:決定事項|決議事項|決まったこと)[ \t　]*[：:][ \t　]*(?:保留|未決|未定|継続審議)(?:[。． \t　]|$)/u.test(line)
    )
    if (undecidedDecision &&
        !hasSection(/^(?:未決事項|保留事項|継続審議事項)[ \t　]*[：:]/u)) {
      diagnostics.push({
        start, end: start + '議事録'.length,
        message: '決定事項が保留・未決と記載されています。未決事項の欄を設け、次回の確認対象を明示してください。',
        fixKind: 'none'
      })
    }
    // A concrete follow-up can be stated directly in the pending-item field;
    // do not require a duplicate separate section for that already-stated action.
    const hasInlineFollowup = bodyLines.some(line =>
      /^(?:未決事項|保留事項|未解決事項)[ \t　]*[：:][ \t　]*(?:次回確認|次回判断|次回対応|次回検討|フォローアップ)(?:[。． \t　]|$)/u.test(line)
    )
    if (hasSection(/^(?:未決事項|保留事項|未解決事項)[ \t　]*[：:]/u) &&
        !hasInlineFollowup &&
        !hasSection(/^(?:次回確認|次回アクション|確認予定|フォローアップ)[ \t　]*[：:]/u)) {
      diagnostics.push({
        start, end: start + '議事録'.length,
        message: '未決事項があります。次回確認またはフォローアップの欄を設けることを検討してください。',
        fixKind: 'none'
      })
    }
    return diagnostics
  }
}
