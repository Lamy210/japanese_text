/**
 * Cross-paragraph tone consistency within Markdown heading sections.
 *
 * Intentionally conservative: one vote per single-tone prose paragraph.
 * Mixed paragraphs are diagnosed by style/mixed-tone instead.
 * No morphological inference, auto-fix, remote assets or persisted state.
 */
import type { CoreRule, RawDiagnostic } from '../../types'
import { isHeadingLine, isJapanese } from '../shared'

type Tone = 'polite' | 'plain'
interface Ending {
  start: number
  end: number
  text: string
}
interface ParagraphVote {
  tone: Tone
  first: Ending
}

const POLITE_ENDINGS = /(ませんでした|ましょうか|ましょう|でしょう|でした|ました|ません|ます|です|ください)(?=[。！？]|$)/gu
const PLAIN_ENDINGS = /(ではない|である|だった|だろう|だ)(?=[。！？]|$)/gu

/** Avoid treating quoted text, lists, indented code and Markdown tables as narrator prose. */
function shouldSkipLine(line: string): boolean {
  return /^(?: {4,}|\t| {0,3}>| {0,3}[-*+]\s| {0,3}\d+[.)]\s)/u.test(line) ||
    line.includes('|')
}

function collectEndings(maskedLine: string, lineStart: number, regex: RegExp): Ending[] {
  // Replacing by the same UTF-16 length preserves CodeMirror diagnostic offsets.
  const prose = maskedLine.replace(/「[^」\n]*」|『[^』\n]*』/gu, (value) => ' '.repeat(value.length))
  const endings: Ending[] = []
  for (const match of prose.matchAll(regex)) {
    const index = match.index
    const previous = prose[index - 1]
    if (previous !== undefined && !isJapanese(previous) && !/[、。！？\s（(]/u.test(previous)) {
      continue
    }
    endings.push({
      start: lineStart + index,
      end: lineStart + index + match[0].length,
      text: match[0]
    })
  }
  return endings
}

export const crossParagraphToneRule: CoreRule = {
  id: 'style/cross-paragraph-tone',
  category: 'style',
  tier: 'idle',
  defaultSeverity: 'info',
  description:
    '同じ見出し区間で複数段落にまたがる「です・ます調」と「である調」の混在を検出します。明示的な文末のみを対象とし、引用・箇条書き・混在段落を除外する控えめな判定です。自動修正はしません。',
  run(ctx): RawDiagnostic[] {
    const results: RawDiagnostic[] = []
    const votes: ParagraphVote[] = []
    let polite: Ending[] = []
    let plain: Ending[] = []

    const finishParagraph = (): void => {
      if ((polite.length > 0) !== (plain.length > 0)) {
        const tone = polite.length > 0 ? 'polite' : 'plain'
        votes.push({ tone, first: (tone === 'polite' ? polite : plain)[0]! })
      }
      polite = []
      plain = []
    }

    const finishSection = (): void => {
      finishParagraph()
      const politeVotes = votes.filter((vote) => vote.tone === 'polite')
      const plainVotes = votes.filter((vote) => vote.tone === 'plain')
      if (politeVotes.length >= 2 && plainVotes.length >= 1) {
        for (const vote of plainVotes) {
          results.push({
            start: vote.first.start,
            end: vote.first.end,
            message: `段落をまたぐ文体の混在: この区間ではですます調の段落が多いですが「${vote.first.text}」はである調です。統一を検討してください。`
          })
        }
      } else if (plainVotes.length >= 2 && politeVotes.length >= 1) {
        for (const vote of politeVotes) {
          results.push({
            start: vote.first.start,
            end: vote.first.end,
            message: `段落をまたぐ文体の混在: この区間ではである調の段落が多いですが「${vote.first.text}」はですます調です。統一を検討してください。`
          })
        }
      }
      votes.length = 0
    }

    for (let index = 0; index < ctx.lines.length; index++) {
      const sourceLine = ctx.lines[index]!
      const offset = ctx.lineStarts[index]!
      const maskedLine = ctx.maskedText.slice(offset, offset + sourceLine.length)
      // A visible heading in the original may be inside a masked code fence.
      // Only unmasked headings start a new prose section.
      if (isHeadingLine(sourceLine) && isHeadingLine(maskedLine)) {
        finishSection()
        continue
      }
      if (sourceLine.trim() === '' || shouldSkipLine(sourceLine)) {
        finishParagraph()
        continue
      }
      polite.push(...collectEndings(maskedLine, offset, POLITE_ENDINGS))
      plain.push(...collectEndings(maskedLine, offset, PLAIN_ENDINGS))
    }

    finishSection()
    return results
  }
}
