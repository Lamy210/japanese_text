/**
 * AP-04: invisible separator hints for ordinary prose.
 *
 * These characters can be inserted by copy/paste and are visually difficult
 * to distinguish from adjacent letters. Deletion is NEVER a Safe Fix:
 * U+200B and U+2060 can be intentional word-break controls.
 *
 * Do not report characters in masked Markdown code, URLs, HTML comments,
 * frontmatter or reference definitions. UTF-16 spans are one code unit.
 * Intentionally do not flag ZWJ (emoji shaping), ZWNJ, variation selectors,
 * or bidirectional controls: they require separate linguistic/security rules.
 */
import type { CoreRule, RawDiagnostic } from '../../types'

const INVISIBLE = /[\u200B\u2060\uFEFF]/g

const DESCRIPTIONS: Readonly<Record<string, string>> = {
  '\u200B': 'ゼロ幅スペース (U+200B)',
  '\u2060': 'WORD JOINER (U+2060)',
  '\uFEFF': '不可視のBOM文字 (U+FEFF)'
}

export const invisibleSeparatorRule: CoreRule = {
  id: 'typography/invisible-separator',
  category: 'typography',
  tier: 'fast',
  description:
    '文章中のゼロ幅スペース(U+200B)、WORD JOINER(U+2060)、途中に入ったBOM(U+FEFF)を検出します。意図的な改行制御である可能性もあるため、自動削除はしません。Markdownコード・URL・メタデータは除外します。',
  defaultSeverity: 'info',
  run(ctx): RawDiagnostic[] {
    const results: RawDiagnostic[] = []
    for (const match of ctx.maskedText.matchAll(INVISIBLE)) {
      const start = match.index
      const character = match[0]
      // An initial UTF-8 BOM decoded as U+FEFF is a file marker.
      if (start === 0 && character === '\uFEFF') continue
      results.push({
        start,
        end: start + character.length,
        message: (DESCRIPTIONS[character] ?? '不可視の区切り文字') + 'があります。意図的な区切り・改行制御でなければ削除を検討してください。',
        fixKind: 'suggestion',
        replacement: ''
      })
    }
    return results
  }
}
