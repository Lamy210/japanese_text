/**
 * Conservatively flag prose paragraphs containing many explicitly completed
 * Japanese sentences. Sentence density is a review hint, not a grammar error.
 */
import type { CoreRule, RawDiagnostic, RuleContext } from '../../types'
import { splitSentences, isSubstantiveSentence } from '../../text/segmenter'
import { isHeadingLine } from '../shared'

const TERMINAL = /[。！？!?]+(?=\s*$)/u
const JAPANESE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u

function isStructuralLine(source: string, masked: string): boolean {
  if (source.trim().length === 0 || /^[\uFFFF\s]+$/u.test(masked)) return true
  return isHeadingLine(source) ||
    /^(?: {4,}|\t| {0,3}>| {0,3}[-*+]\s| {0,3}\d+[.)]\s)/u.test(source) ||
    source.includes('|')
}

function withoutQuotedExamples(text: string): string {
  return text.replace(/「[^」]*(?:」|$)|『[^』]*(?:』|$)/gu, (quoted) => '\uFFFF'.repeat(quoted.length))
}

export const paragraphDensityRule: CoreRule = {
  id: 'style/paragraph-density',
  category: 'style',
  tier: 'idle',
  defaultSeverity: 'info',
  description:
    '段落内の完結した文が目安より多い場合、段落の分割を検討するための情報を表示します。長い段落は誤りとは限らず、文章の論理性や意味を自動判定するものではありません。',
  optionDefs: [
    { key: 'max', type: 'number', label: '1段落の完結文数の目安', defaultValue: 5, min: 2, max: 20 }
  ],
  run(ctx: RuleContext, setting): RawDiagnostic[] {
    const requested = setting.options?.max
    const max = typeof requested === 'number' && Number.isInteger(requested) && requested >= 2 && requested <= 20
      ? requested : 5
    const results: RawDiagnostic[] = []
    let start = -1
    let end = -1

    const finish = (): void => {
      if (start < 0 || end <= start) {
        start = -1
        end = -1
        return
      }
      const prose = withoutQuotedExamples(ctx.maskedText.slice(start, end))
      let count = 0
      let beyond: { start: number; end: number } | null = null

      for (const sentence of splitSentences(prose)) {
        const terminal = TERMINAL.exec(sentence.text)
        if (!terminal || !isSubstantiveSentence(sentence.text)) continue
        count++
        if (count === max + 1) {
          const firstJapanese = JAPANESE.exec(sentence.text)
          beyond = {
            start: start + sentence.start + (firstJapanese?.index ?? 0),
            end: start + sentence.start + terminal.index + terminal[0].length
          }
        }
      }
      if (beyond !== null) {
        results.push({
          start: beyond.start,
          end: beyond.end,
          message: `この段落には完結した文が${count}文あります（目安は${max}文以下）。情報を整理し、段落の分割を検討してください。`
        })
      }
      start = -1
      end = -1
    }

    for (let i = 0; i < ctx.lines.length; i++) {
      const raw = ctx.lines[i]!
      const offset = ctx.lineStarts[i]!
      const masked = ctx.maskedText.slice(offset, offset + raw.length)
      if (isStructuralLine(raw, masked)) {
        finish()
        continue
      }
      if (start < 0) start = offset
      end = offset + raw.length
    }
    finish()
    return results
  }
}
