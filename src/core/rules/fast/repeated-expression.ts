/**
 * Conservative Japanese writing-support rules without morphological dictionaries.
 *
 * These checks detect explicit local repetition, NOT the logical correctness
 * of a sentence or its connective. Never provide an automatic replacement.
 */
import type { CoreRule, RawDiagnostic, RuleContext } from '../../types'

/** Repeated postpositional phrases separated by a single comma. */
const REPEATED_PHRASE = /(について|に関して|において|に対して|という|として)([、，,][ \t　]*)\1/gu

/** Sentence-initial connective followed by a comma (not an adverb inside a clause). */
const INITIAL_CONJUNCTION = /^[ \t　]*(しかし|また|さらに|したがって|そのため|一方|つまり|例えば|たとえば|ただし|ところが|なお|そして|加えて|すなわち|ところで)[、，]/u
const SENTENCES_IN_LINE = /[^。！？!?]+[。！？!?]?/gu

/** Avoid treating quoted speech, headings, lists, blockquotes or tables as author prose. */
function shouldSkipLine(line: string): boolean {
  return line.trim().length === 0 ||
    /^(?: {4,}|\t| {0,3}>| {0,3}[-*+]\s| {0,3}\d+[.)]\s| {0,3}#{1,6}\s)/u.test(line) ||
    line.includes('|')
}

/** Mask inline quotation spans across lines, retaining UTF-16 offsets. */
function withoutQuotedSpeech(maskedText: string): string {
  return maskedText.replace(/「[^」]*(?:」|$)|『[^』]*(?:』|$)/gu, (quoted) => ' '.repeat(quoted.length))
}

export const repeatedPhraseRule: CoreRule = {
  id: 'wording/repeated-phrase',
  category: 'wording',
  tier: 'fast',
  defaultSeverity: 'info',
  description:
    '「について、について」など、読点を挟む限られた同一助詞句の直後反復を検出します。引用やMarkdown構造は除外し、文脈の判断と修正は利用者に委ねます。',
  run(ctx: RuleContext): RawDiagnostic[] {
    const results: RawDiagnostic[] = []
    const text = withoutQuotedSpeech(ctx.maskedText)
    for (let i = 0; i < ctx.lines.length; i++) {
      if (shouldSkipLine(ctx.lines[i]!)) continue
      const startOffset = ctx.lineStarts[i]!
      const line = text.slice(startOffset, startOffset + ctx.lines[i]!.length)
      for (const match of line.matchAll(REPEATED_PHRASE)) {
        const duplicateStart = startOffset + match.index + match[1]!.length + match[2]!.length
        results.push({
          start: duplicateStart,
          end: duplicateStart + match[1]!.length,
          message: `「${match[1]}」が直後に重複している可能性があります。文脈に応じて不要な表現を確認してください。`
        })
      }
    }
    return results
  }
}

export const consecutiveConjunctionRule: CoreRule = {
  id: 'style/consecutive-conjunction',
  category: 'style',
  tier: 'fast',
  defaultSeverity: 'info',
  description:
    '同じ段落で連続する文が同一の文頭接続詞（例:「しかし、」）を繰り返す場合、表現の整理を提案します。意味関係は判定せず自動修正もしません。',
  run(ctx: RuleContext): RawDiagnostic[] {
    const results: RawDiagnostic[] = []
    const text = withoutQuotedSpeech(ctx.maskedText)
    let previous: string | null = null

    for (let i = 0; i < ctx.lines.length; i++) {
      const sourceLine = ctx.lines[i]!
      if (shouldSkipLine(sourceLine)) {
        previous = null
        continue
      }
      const offset = ctx.lineStarts[i]!
      const line = text.slice(offset, offset + sourceLine.length)
      for (const sentence of line.matchAll(SENTENCES_IN_LINE)) {
        const match = INITIAL_CONJUNCTION.exec(sentence[0])
        if (match === null) {
          previous = null
          continue
        }
        const current = match[1]!
        if (current === previous) {
          const start = offset + sentence.index + match[0].length - current.length - 1
          results.push({
            start,
            end: start + current.length,
            message: `接続詞「${current}」が連続する文の冒頭で繰り返されています。省略や構成の整理を検討してください。`
          })
        }
        previous = current
      }
      // A soft line break is not sufficient evidence of a sentence boundary.
      if (!/[。！？!?][ \t　]*$/u.test(line)) previous = null
    }
    return results
  }
}
