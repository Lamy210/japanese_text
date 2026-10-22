import type { CoreRule, RawDiagnostic, RuleContext } from '../../types'

/**
 * Compare honorific suffixes for the same explicitly written person name.
 * This does not infer identity between different spellings, roles or nicknames.
 */
export const honorificConsistencyRule: CoreRule = {
  id: 'style/honorific-consistency',
  category: 'style',
  tier: 'fast',
  defaultSeverity: 'info',
  description: '同じ氏名に「さん」「くん」が混在する場合だけ確認を促します。敬称の正否は判定せず、自動修正もしません。',
  run(ctx: RuleContext): RawDiagnostic[] {
    const results: RawDiagnostic[] = []
    const seen = new Map<string, string>()
    // Two or more CJK characters reduces collisions with ordinary pronouns.
    const pattern = /([\p{Script=Han}]{2,6})(さん|くん)(?![ぁ-んァ-ン])/gu
    for (let i = 0; i < ctx.lines.length; i++) {
      const original = ctx.lines[i]!
      const offset = ctx.lineStarts[i]!
      // Avoid headings, code snippets, lists, sample quotations and blockquotes.
      if (/^\s*(?:#|>|[-*+]\s|\d+[.)]\s)/u.test(original)) continue
      const line = ctx.maskedText.slice(offset, offset + original.length)
        .replace(/「[^」]*(?:」|$)|『[^』]*(?:』|$)/gu, m => '\uFFFF'.repeat(m.length))
      for (const match of line.matchAll(pattern)) {
        const name = match[1]!
        const suffix = match[2]!
        const previous = seen.get(name)
        if (previous && previous !== suffix) {
          const start = offset + match.index
          results.push({
            start, end: start + match[0].length,
            message: `「${name}」の敬称が「${previous}」と「${suffix}」で混在しています。文書内で統一するか確認してください。`,
            fixKind: 'none'
          })
        } else if (!previous) {
          seen.set(name, suffix)
        }
      }
    }
    return results
  }
}
