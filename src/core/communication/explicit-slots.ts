/**
 * Conservative evidence spans for explicit temporal/motivation expressions
 * inside previously detected communication acts.
 *
 * These are unscoped candidates, NOT normalized deadlines, proven reasons,
 * or predicate-argument roles. All spans are exact UTF-16 source slices.
 */
import type { ExplicitCommunicationAct } from './explicit-acts'

export type ExplicitSlotKind =
  | 'deadline-candidate' | 'purpose-candidate'
  | 'reason-candidate' | 'ambiguous-motivation'

export interface ExplicitCommunicationSlot {
  readonly kind: ExplicitSlotKind
  readonly startUtf16: number
  readonly endUtf16: number
  readonly evidence: string
  readonly actStartUtf16: number
  readonly actEndUtf16: number
  /** Missing year or relative expression: reference date required. */
  readonly needsDateContext: boolean
  /** Only the enclosing sentence is known; event/deadline scope is unresolved. */
  readonly scope: 'sentence-candidate'
  readonly extractionMethod: 'explicit-slot-rule-v1'
}

export type ExplicitSlotResult =
  | { readonly status: 'analyzed'; readonly slots: readonly ExplicitCommunicationSlot[] }
  | { readonly status: 'skipped'; readonly reason: 'invalid-input' | 'size-limit' | 'result-limit' }

const MAX_SOURCE_LENGTH = 200_000
const MAX_SLOTS = 1024

// Recognize literal dates and relatives only; no inferred year, timezone,
// recurrence, actual date validity or assignment to a particular action.
const DATE = /(?:[12]\d{3}年)?(?:1[0-2]|0?[1-9])月(?:3[01]|[12]\d|0?[1-9])日|[12]\d{3}-\d{2}-\d{2}|(?:今週|来週|再来週)?[月火水木金土日]曜日|今日|明日|明後日|今週末|来週末|今月末|来月末/
const DEADLINE = new RegExp(`(?:${DATE.source})(?:の)?(?:午前|午後)?(?:[0-2]?\\d時(?:[0-5]?\\d分)?)?(?:までに|まで)`, 'gu')

// Distinguish unambiguous wording from the overloaded Japanese 「〜のため」.
// In particular, do NOT misrepresent 「再発防止のため」 as proved causality.
const REASON = /(?:^|[、，,;；\s])([^、，,。！？?\r\n]{1,48}?(?:が原因で|という理由で|が理由で))(?=[、，,\s]|$)/gu
const PURPOSE = /(?:^|[、，,;；\s])([^、，,。！？?\r\n]{1,48}?(?:を目的として|を目指して))(?=[、，,\s]|$)/gu
const AMBIGUOUS = /(?:^|[、，,;；\s])([^、，,。！？?\r\n]{1,48}?のため(?:に)?)(?=[、，,\s]|$)/gu

type Pattern = { readonly kind: ExplicitSlotKind; readonly re: RegExp; readonly group: 0 | 1 }
const PATTERNS: readonly Pattern[] = [
  { kind: 'deadline-candidate', re: DEADLINE, group: 0 },
  { kind: 'reason-candidate', re: REASON, group: 1 },
  { kind: 'purpose-candidate', re: PURPOSE, group: 1 },
  { kind: 'ambiguous-motivation', re: AMBIGUOUS, group: 1 }
]

function validAct(act: ExplicitCommunicationAct, source: string): boolean {
  return Number.isSafeInteger(act.startUtf16) &&
    Number.isSafeInteger(act.endUtf16) &&
    act.startUtf16 >= 0 && act.endUtf16 <= source.length &&
    act.endUtf16 > act.startUtf16 &&
    source.slice(act.startUtf16, act.endUtf16) === act.evidence
}

export function extractExplicitCommunicationSlots(
  source: string, acts: readonly ExplicitCommunicationAct[]
): ExplicitSlotResult {
  if (typeof source !== 'string' || !Array.isArray(acts)) {
    return { status: 'skipped', reason: 'invalid-input' }
  }
  if (source.length > MAX_SOURCE_LENGTH || acts.length > 512) {
    return { status: 'skipped', reason: 'size-limit' }
  }
  const slots: ExplicitCommunicationSlot[] = []
  for (const act of acts) {
    if (!validAct(act, source)) return { status: 'skipped', reason: 'invalid-input' }
    for (const {kind, re, group} of PATTERNS) {
      for (const match of act.evidence.matchAll(re)) {
        const rawPhrase = match[group]
        if (rawPhrase === undefined || rawPhrase.length === 0) continue
        // Decorative pictographs immediately before a Japanese clause are
        // not part of a reason/purpose phrase; preserve exact UTF-16 offsets.
        const decorative = group === 1
          ? /^(?:\\p{Extended_Pictographic}\\uFE0F?\\s*)+/u.exec(rawPhrase)?.[0] ?? ''
          : ''
        const phrase = rawPhrase.slice(decorative.length)
        if (!phrase) continue
        const matchStart = match.index + match[0].length - rawPhrase.length + decorative.length
        const startUtf16 = act.startUtf16 + matchStart
        const endUtf16 = startUtf16 + phrase.length
        if (source.slice(startUtf16, endUtf16) !== phrase) {
          return { status: 'skipped', reason: 'invalid-input' }
        }
        if (slots.length >= MAX_SLOTS) return { status: 'skipped', reason: 'result-limit' }
        slots.push(Object.freeze({
          kind, startUtf16, endUtf16, evidence: phrase,
          actStartUtf16: act.startUtf16, actEndUtf16: act.endUtf16,
          needsDateContext: kind === 'deadline-candidate' &&
            !/(?:[12]\d{3}年\d{1,2}月\d{1,2}日|[12]\d{3}-\d{2}-\d{2})/u.test(phrase),
          scope: 'sentence-candidate' as const,
          extractionMethod: 'explicit-slot-rule-v1' as const
        }))
      }
    }
  }
  slots.sort((a, b) => a.startUtf16 - b.startUtf16 ||
    a.endUtf16 - b.endUtf16 || a.kind.localeCompare(b.kind))
  return { status: 'analyzed', slots: Object.freeze(slots) }
}
