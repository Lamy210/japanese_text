/**
 * Conservative, deterministic detection of explicit Japanese communication acts.
 *
 * This module does not infer a missing actor, resolve a relative date,
 * validate an answer, claim semantic correctness, or change the document.
 * NLP and model-backed classification are separate future providers.
 */
import type { DocumentType } from '../types'
import { extractProseRegions } from '../nlp/prose-regions'
import { splitSentences } from '../text/segmenter'

export type ExplicitIntent =
  | 'confirmation_request' | 'approval_request' | 'action_request'
  | 'confirmation_question' | 'information_question'

export type ExpectedAnswer =
  | 'binary' | 'choice' | 'date' | 'numeric'
  | 'explanation' | 'action' | 'unknown'

export interface ExplicitCommunicationAct {
  readonly intent: ExplicitIntent
  readonly surfaceForm: 'interrogative' | 'imperative'
  readonly expectedAnswer: ExpectedAnswer
  /**
   * A polite Yes/No request can require further action; this is never
   * automatically inferred to be true from sentence syntax alone.
   */
  readonly answerCompletesRequest: false | 'unknown'
  readonly startUtf16: number
  readonly endUtf16: number
  /** Identical to source.slice(startUtf16, endUtf16). */
  readonly evidence: string
  readonly extractionMethod: 'explicit-rule-v1'
}

export type ExplicitCommunicationResult =
  | { readonly status: 'analyzed'; readonly acts: readonly ExplicitCommunicationAct[] }
  | { readonly status: 'skipped'; readonly reason: 'invalid-input' | 'size-limit' | 'result-limit' }

const MAX_SOURCE_UTF16 = 200_000
const MAX_ACTS = 512

const ACTION_AT_END =
  /(ご?(?:確認|承認|対応|修正|提出|調査|回答|送付|報告|共有)|レビュー)(?:を)?(?:して)?(?:ください|いただけますか|いただけないでしょうか|お願い(?:します|いたします))$/u

const BINARY_END = /(?:です|ます|でしょう|ません|できます|あります|可能です|よろしいです)か$/u
const CHOICE_WORD = /(?:どちら|いずれ|どれを|どの案|何番目)/u
const DATE_WORD = /(?:いつまで|いつ|何日|何時|何曜日)/u
const NUMBER_WORD = /(?:何件|何人|何回|何円|いくら|何％|何%)/u
const EXPLANATION_WORD = /(?:なぜ|どうして|どのように|何(?:が|を|です)|誰(?:が|に)|どこ|理由|原因)/u
const QUESTION_MARK = /[？?]$/u
const QUESTION_END = /(?:ですか|ますか|でしょうか|ませんか|でしょう|だろうか|かどうか)$/u

function classify(sentence: string): Omit<ExplicitCommunicationAct,
  'startUtf16' | 'endUtf16' | 'evidence' | 'extractionMethod'> | null {
  // Skip quoted examples rather than attributing instructions to their author.
  if (/^[「『]/u.test(sentence)) return null
  const text = sentence.replace(/[。！？?]+$/u, '').trim()
  if (!text) return null
  const asks = QUESTION_MARK.test(sentence) || QUESTION_END.test(text) ||
    BINARY_END.test(text)

  const request = ACTION_AT_END.exec(text)
  if (request !== null) {
    const action = request[1]!
    return {
      intent: action.includes('承認') ? 'approval_request'
        : action.includes('確認') ? 'confirmation_request' : 'action_request',
      surfaceForm: asks ? 'interrogative' : 'imperative',
      expectedAnswer: asks ? 'binary' : 'action',
      answerCompletesRequest: false
    }
  }
  if (!asks) return null
  const expectedAnswer: ExpectedAnswer =
    CHOICE_WORD.test(text) ? 'choice'
      : DATE_WORD.test(text) ? 'date'
        : NUMBER_WORD.test(text) ? 'numeric'
          : EXPLANATION_WORD.test(text) ? 'explanation'
            : BINARY_END.test(text) ? 'binary' : 'unknown'
  return {
    intent: expectedAnswer === 'binary' ? 'confirmation_question' : 'information_question',
    surfaceForm: 'interrogative',
    expectedAnswer,
    answerCompletesRequest: 'unknown'
  }
}

/**
 * Only independently extractable, nonquoted prose regions are considered.
 * No results are emitted for headings, link labels, markdown code, quotes
 * or tables. Results are anchored to original UTF-16 coordinates.
 */
export function detectExplicitCommunicationActs(
  source: string, documentType: DocumentType = 'markdown'
): ExplicitCommunicationResult {
  if (typeof source !== 'string' ||
      (documentType !== 'markdown' && documentType !== 'text')) {
    return { status: 'skipped', reason: 'invalid-input' }
  }
  if (source.length > MAX_SOURCE_UTF16) return { status: 'skipped', reason: 'size-limit' }
  const acts: ExplicitCommunicationAct[] = []
  for (const region of extractProseRegions(source, documentType)) {
    if (region.kind === 'heading' || region.kind === 'link-label' ||
        region.kind === 'quote' || region.kind === 'table-cell') continue
    for (const sentence of splitSentences(region.text)) {
      let start = sentence.start
      let end = sentence.end
      while (start < end && /\s/u.test(region.text[start]!)) start++
      while (end > start && /\s/u.test(region.text[end - 1]!)) end--
      if (start >= end) continue
      const evidence = region.text.slice(start, end)
      const kind = classify(evidence)
      if (kind === null) continue
      if (acts.length >= MAX_ACTS) return { status: 'skipped', reason: 'result-limit' }
      acts.push(Object.freeze({
        ...kind,
        startUtf16: region.sourceStartUtf16 + start,
        endUtf16: region.sourceStartUtf16 + end,
        evidence,
        extractionMethod: 'explicit-rule-v1' as const
      }))
    }
  }
  return { status: 'analyzed', acts: Object.freeze(acts) }
}
