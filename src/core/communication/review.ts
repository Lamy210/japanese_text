/**
 * Read-only, on-demand communication review of the currently selected document.
 *
 * No Diagnostic registration, persistence, external API or automatic edits.
 * Capturing the document identity and revision ensures UI cannot navigate to
 * an old evidence span after a document/workspace switch or source edit.
 */
import type { DocumentType } from '../types'
import { extractExplicitCommunicationSlots, type ExplicitCommunicationSlot, type ExplicitSlotKind } from './explicit-slots'
import {
  detectExplicitCommunicationActs,
  type ExplicitCommunicationAct,
  type ExpectedAnswer,
  type ExplicitIntent
} from './explicit-acts'

export interface CommunicationReviewInput {
  readonly workspaceId: string | null
  readonly documentId: string | null
  readonly revision: number
  readonly text: string
  readonly documentType: DocumentType
}

export interface CommunicationReviewSnapshot {
  readonly workspaceId: string
  readonly documentId: string
  readonly revision: number
  readonly sourceText: string
  readonly documentType: DocumentType
  readonly acts: readonly ExplicitCommunicationAct[]
  readonly slots: readonly ExplicitCommunicationSlot[]
}

export type CommunicationReviewResult =
  | { readonly status: 'ready'; readonly snapshot: CommunicationReviewSnapshot }
  | { readonly status: 'skipped'; readonly reason:
      'missing-document' | 'invalid-input' | 'size-limit' | 'result-limit' }

const INTENT_LABELS: Readonly<Record<ExplicitIntent, string>> = {
  confirmation_request: '確認作業の依頼',
  approval_request: '承認作業の依頼',
  action_request: '作業・対応の依頼',
  confirmation_question: 'Yes/No確認の質問',
  information_question: '情報を求める質問'
}

const SLOT_LABELS: Readonly<Record<ExplicitSlotKind, string>> = {
  'deadline-candidate': '期限の候補',
  'purpose-candidate': '目的の候補',
  'reason-candidate': '理由の候補',
  'ambiguous-motivation': '理由・目的の曖昧な候補'
}

export function describeCommunicationSlot(slot: ExplicitCommunicationSlot): {
  readonly label: string
  readonly caution: string
} {
  return Object.freeze({
    label: SLOT_LABELS[slot.kind],
    caution: slot.kind === 'deadline-candidate'
      ? (slot.needsDateContext
        ? '相対日付または年の省略があります。基準日と期限の適用先を確認してください。'
        : '日付表現の候補です。日付の有効性と期限の適用先は未検証です。')
      : slot.kind === 'ambiguous-motivation'
        ? '「〜のため」は理由・目的の両方に使われます。文脈の確認が必要です。'
        : '明示表現の候補です。主張の真偽や対応する行為との関係は未検証です。'
  })
}

const ANSWER_LABELS: Readonly<Record<ExpectedAnswer, string>> = {
  binary: 'はい／いいえ形式',
  choice: '選択式',
  date: '日時',
  numeric: '数値',
  explanation: '理由・説明',
  action: '実作業',
  unknown: '判定できません'
}

export function describeCommunicationAct(act: ExplicitCommunicationAct): {
  readonly intent: string
  readonly expectedAnswer: string
  readonly surfaceForm: string
  readonly completion: string
} {
  return Object.freeze({
    intent: INTENT_LABELS[act.intent],
    expectedAnswer: ANSWER_LABELS[act.expectedAnswer],
    surfaceForm: act.surfaceForm === 'interrogative' ? '疑問文' : '依頼・指示文',
    completion: act.answerCompletesRequest === false
      ? '回答だけでは依頼した作業が完了したとは扱えません。'
      : 'この文だけでは回答による依頼・確認の完了を判定できません。'
  })
}

export function reviewCurrentCommunication(
  input: CommunicationReviewInput
): CommunicationReviewResult {
  if (input === null || typeof input !== 'object' ||
      !Number.isSafeInteger(input.revision) || input.revision < 0 ||
      typeof input.text !== 'string') {
    return { status: 'skipped', reason: 'invalid-input' }
  }
  if (!input.workspaceId || !input.documentId) {
    return { status: 'skipped', reason: 'missing-document' }
  }
  const result = detectExplicitCommunicationActs(input.text, input.documentType)
  if (result.status === 'skipped') return result
  const slotResult = extractExplicitCommunicationSlots(input.text, result.acts)
  if (slotResult.status === 'skipped') return slotResult
  return {
    status: 'ready',
    snapshot: Object.freeze({
      workspaceId: input.workspaceId,
      documentId: input.documentId,
      revision: input.revision,
      sourceText: input.text,
      documentType: input.documentType,
      acts: result.acts,
      slots: slotResult.slots
    })
  }
}

/** A whole-document equality check: small edits outside a finding still stale it. */
export function isCommunicationReviewCurrent(
  snapshot: CommunicationReviewSnapshot | null,
  current: CommunicationReviewInput
): boolean {
  return snapshot !== null &&
    snapshot.workspaceId === current.workspaceId &&
    snapshot.documentId === current.documentId &&
    snapshot.revision === current.revision &&
    snapshot.documentType === current.documentType &&
    snapshot.sourceText === current.text
}

/** Only navigate to an intact evidence span in the exact source revision. */
export function canNavigateToCommunicationAct(
  snapshot: CommunicationReviewSnapshot | null,
  current: CommunicationReviewInput,
  act: ExplicitCommunicationAct
): boolean {
  return isCommunicationReviewCurrent(snapshot, current) &&
    Number.isSafeInteger(act.startUtf16) &&
    Number.isSafeInteger(act.endUtf16) &&
    act.startUtf16 >= 0 && act.endUtf16 > act.startUtf16 &&
    act.endUtf16 <= current.text.length &&
    current.text.slice(act.startUtf16, act.endUtf16) === act.evidence &&
    snapshot?.acts.includes(act) === true
}
