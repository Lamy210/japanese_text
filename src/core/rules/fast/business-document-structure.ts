import type { CoreRule, RawDiagnostic, RuleContext } from '../../types'

type Requirement = { label: string; pattern: RegExp }
type DocumentProfile = { title: string; requirements: Requirement[] }

/**
 * Opt-in by an explicit document title. These are structural prompts,
 * not a claim that a document's facts or rhetorical ordering are correct.
 */
const PROFILES: DocumentProfile[] = [
  {
    title: '問い合わせ回答',
    requirements: [
      { label: '回答・結論', pattern: /^(?:#{1,6}[ \t]+)?(?:回答|結論)[ \t　]*[：:]/u },
      { label: '質問・問い合わせ内容', pattern: /^(?:#{1,6}[ \t]+)?(?:質問|問い合わせ内容|お問い合わせ内容)[ \t　]*[：:]/u }
    ]
  },
  {
    title: '相談メモ',
    requirements: [
      { label: '相談内容', pattern: /^(?:#{1,6}[ \t]+)?(?:相談内容|相談事項)[ \t　]*[：:]/u },
      { label: '前提条件・背景', pattern: /^(?:#{1,6}[ \t]+)?(?:前提条件|前提|背景)[ \t　]*[：:]/u }
    ]
  },
  {
    title: '社内連絡',
    requirements: [
      { label: '要件・結論', pattern: /^(?:#{1,6}[ \t]+)?(?:要件|結論|連絡事項)[ \t　]*[：:]/u }
    ]
  }
]

export const businessDocumentStructureRule: CoreRule = {
  id: 'style/business-document-structure',
  category: 'style',
  tier: 'fast',
  defaultSeverity: 'info',
  description: '冒頭の「問い合わせ回答」「相談メモ」「社内連絡」という明示タイトルに応じ、本文の項目見出しを確認します。順序・意味の正しさは判定しません。',
  run(ctx: RuleContext): RawDiagnostic[] {
    const first = ctx.lines.findIndex(line => line.trim().length > 0)
    if (first < 0) return []
    const firstLine = ctx.lines[first]!
    const match = /^(?:[ \t]{0,3}#{1,6}[ \t]+)?(問い合わせ回答|相談メモ|社内連絡)(?:[ \t　：:].*)?$/u.exec(firstLine.trimStart())
    if (!match) return []
    const profile = PROFILES.find(p => p.title === match[1])
    if (!profile) return []
    const titleStart = ctx.lineStarts[first]! + firstLine.indexOf(profile.title)
    const lines = ctx.lines.slice(first + 1).map((line, offset) => {
      const start = ctx.lineStarts[first + 1 + offset]!
      const masked = ctx.maskedText.slice(start, start + line.length)
      return masked.includes('\uFFFF') ? '' : line.trim()
    })
    return profile.requirements.filter(req => !lines.some(line => req.pattern.test(line)))
      .map(req => ({
        start: titleStart, end: titleStart + profile.title.length,
        message: `「${profile.title}」に「${req.label}」の項目が見当たりません。必要に応じて追加してください。`,
        fixKind: 'none' as const
      }))
  }
}
