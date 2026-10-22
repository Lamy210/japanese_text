/**
 * A deliberately narrow object-particle typo heuristic.
 *
 * Detect only adjacent "をを" and "を[space/comma]を"; do not generalize to
 * はは (mother/laughing), がが (word boundaries), にに, or any other particles.
 * This is review-only because the appropriate repair can depend on syntax.
 */
import type { CoreRule, RawDiagnostic } from '../../types'
import { maskHonorificQuotedExamples } from './honorific-utils'

const DUPLICATED = /を(?:[ \t　]*|[、，,][ \t　]*)を/gu

export const doubledObjectParticleRule: CoreRule = {
  id: 'wording/doubled-object-particle',
  category: 'wording',
  tier: 'fast',
  defaultSeverity: 'info',
  description:
    '目的語の助詞「を」の直後反復（例:「資料をを確認」）のみを検出し、入力ミスの確認を促します。他の助詞や文法的に正常な連続文字まで拡張せず、自動修正は行いません。',
  run(ctx): RawDiagnostic[] {
    const masked = maskHonorificQuotedExamples(ctx.maskedText)
    const findings: RawDiagnostic[] = []
    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i]!
      if (/^ {0,3}>/u.test(line)) continue
      const offset = ctx.lineStarts[i]!
      const content = masked.slice(offset, offset + line.length)
      const re = new RegExp(DUPLICATED.source, DUPLICATED.flags)
      let match: RegExpExecArray | null
      while ((match = re.exec(content)) !== null) {
        const secondStart = offset + match.index + match[0].lastIndexOf('を')
        findings.push({
          start: secondStart,
          end: secondStart + 1,
          message: '助詞「を」が直後に繰り返されています。不要な助詞や読点がないか確認してください。文脈により適切な直し方が異なるため、自動置換は行いません。'
        })
        // Report a triple ("ををを") at both the second and third positions.
        re.lastIndex = match.index + match[0].lastIndexOf('を')
      }
    }
    return findings
  }
}
