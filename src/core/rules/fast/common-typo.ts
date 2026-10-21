/**
 * Small, deterministic, explicitly curated Japanese typo dictionary.
 * No external dictionary or LLM. Suggestions require user confirmation.
 */
import type { CoreRule, RawDiagnostic, RuleContext } from '../../types'
import type { TermEntry } from '../../config/schema'

interface TypoEntry {
  wrong: string
  preferred: string
}

const TYPO_ENTRIES: readonly TypoEntry[] = [
  { wrong: 'シュミレーション', preferred: 'シミュレーション' },
  { wrong: 'コミニュケーション', preferred: 'コミュニケーション' },
  { wrong: 'デバック', preferred: 'デバッグ' },
  { wrong: 'うる覚え', preferred: 'うろ覚え' },
  { wrong: 'コミニュティ', preferred: 'コミュニティ' },
  { wrong: 'アクセサビリティ', preferred: 'アクセシビリティ' },
  { wrong: 'シュミレーター', preferred: 'シミュレーター' },
  { wrong: 'シュミレータ', preferred: 'シミュレータ' }
]

// Avoid changing proper-name-like Katakana extensions (e.g. a product name
// containing the suspicious spelling). Also avoid attached ASCII product IDs.
const PRODUCT_NAME_CHAR = /[\u30A0-\u30FF\u31F0-\u31FFーA-Za-z0-9]/u
const QUOTED = /「[^」]*(?:」|$)|『[^』]*(?:』|$)/gu

function withoutQuotes(text: string): string {
  return text.replace(QUOTED, (quote) => '\uFFFF'.repeat(quote.length))
}

function isBlockQuote(sourceLine: string): boolean {
  return /^ {0,3}>/u.test(sourceLine)
}

/**
 * User terminology is authoritative. Never emit contradictory built-in typo
 * guidance for a spelling that the user explicitly prefers or manages as a
 * rejected custom terminology variant.
 */
export function createCommonTypoRule(terminology: () => readonly TermEntry[]): CoreRule {
  return {
    id: 'wording/common-typo',
    category: 'wording',
    tier: 'fast',
    defaultSeverity: 'info',
    description:
      'よくある日本語の誤字・誤表記について、小規模な辞書を使って訂正候補を提示します。引用・コード・URLなどを除外し、自動修正はしません。ブランド名や固有名詞は利用者が確認してください。',
    run(ctx: RuleContext): RawDiagnostic[] {
      const text = withoutQuotes(ctx.maskedText)
      const results: RawDiagnostic[] = []
      const preferredOrManaged = new Set<string>()
      for (const term of terminology()) {
        preferredOrManaged.add(term.preferred)
        for (const rejected of term.rejected) preferredOrManaged.add(rejected)
      }

      for (let i = 0; i < ctx.lines.length; i++) {
        const lineStart = ctx.lineStarts[i]!
        const sourceLine = ctx.lines[i]!
        if (isBlockQuote(sourceLine)) continue
        const line = text.slice(lineStart, lineStart + sourceLine.length)

        for (const entry of TYPO_ENTRIES) {
          if (preferredOrManaged.has(entry.wrong)) continue
          let from = 0
          while (true) {
            const idx = line.indexOf(entry.wrong, from)
            if (idx < 0) break
            from = idx + entry.wrong.length
            if (PRODUCT_NAME_CHAR.test(entry.wrong) &&
              (PRODUCT_NAME_CHAR.test(line[idx - 1] ?? '') || PRODUCT_NAME_CHAR.test(line[from] ?? ''))) {
              continue
            }
            results.push({
              start: lineStart + idx,
              end: lineStart + from,
              fixKind: 'suggestion',
              replacement: entry.preferred,
              message: `「${entry.wrong}」は誤表記の可能性があります。「${entry.preferred}」への修正を検討してください。固有名詞や引用の場合は原文を確認してください。`
            })
          }
        }
      }
      return results.sort((a, b) => a.start - b.start || a.end - b.end)
    }
  }
}
