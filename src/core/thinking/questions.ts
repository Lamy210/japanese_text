/**
 * No-LLM Japanese one-person brainstorming question strategies.
 *
 * Suggestions are prompts, not conclusions, factual claims or actions.
 * They are deterministic, side-effect free and independent of document storage.
 */
import type { BrainstormPhase, BrainstormSnapshotV1, ThoughtKind, ThoughtNodeV1 } from './contracts'
import { parseBrainstormSnapshot } from './validate'

export type BrainstormStrategy =
  | 'problem-framing' | 'five-whys' | 'scamper'
  | 'premortem' | 'alternative-check' | 'decision-check' | 'action-planning'

export interface BrainstormSuggestionV1 {
  readonly id: string
  readonly phase: BrainstormPhase
  readonly strategy: BrainstormStrategy
  readonly focusNodeId: string | null
  readonly question: string
  readonly generatedBy: 'builtin-template-v1'
}

export type BrainstormSuggestionResult =
  | { readonly status: 'ready'; readonly suggestions: readonly BrainstormSuggestionV1[] }
  | { readonly status: 'skipped'; readonly reason: 'invalid-snapshot' | 'invalid-options' }

type Template = {
  readonly id: string
  readonly strategy: BrainstormStrategy
  readonly format: (focus: string) => string
}

const TEMPLATES: Readonly<Record<BrainstormPhase, readonly Template[]>> = {
  discover: [
    { id: 'affected-person', strategy: 'problem-framing', format: x => `「${x}」で誰が、どんな場面で困っていますか？` },
    { id: 'observations', strategy: 'five-whys', format: x => `「${x}」が問題だと判断した具体的な出来事は何ですか？` },
    { id: 'why', strategy: 'five-whys', format: x => `「${x}」はなぜ起きていると考えていますか？` }
  ],
  define: [
    { id: 'desired-change', strategy: 'problem-framing', format: x => `「${x}」が改善されたと判断できる状態は何ですか？` },
    { id: 'in-scope', strategy: 'problem-framing', format: x => `「${x}」について、今回扱う範囲と扱わない範囲は何ですか？` },
    { id: 'constraints', strategy: 'problem-framing', format: x => `「${x}」を考える際、守るべき条件や制約は何ですか？` }
  ],
  diverge: [
    { id: 'substitute', strategy: 'scamper', format: x => `「${x}」の手順・利用者・仕組みを別のものに置き換えたらどうなりますか？` },
    { id: 'combine', strategy: 'scamper', format: x => `「${x}」を他の機能や案と組み合わせると何ができますか？` },
    { id: 'remove', strategy: 'scamper', format: x => `「${x}」の一部をなくしても目的を達成できますか？` }
  ],
  challenge: [
    { id: 'failure', strategy: 'premortem', format: x => `「${x}」が失敗したと仮定した場合、最も可能性が高い原因は何ですか？` },
    { id: 'unverified', strategy: 'premortem', format: x => `「${x}」を支える前提で、まだ確認できていないものは何ですか？` },
    { id: 'counterexample', strategy: 'premortem', format: x => `「${x}」が成り立たない具体例はありますか？` }
  ],
  evaluate: [
    { id: 'alternatives', strategy: 'alternative-check', format: x => `「${x}」以外に比較すべき代替案はありますか？` },
    { id: 'criteria', strategy: 'alternative-check', format: x => `「${x}」を他案と比べる際、何を評価基準にしますか？` },
    { id: 'evidence', strategy: 'alternative-check', format: x => `「${x}」を優先する根拠として、検証済みの情報は何ですか？` }
  ],
  decide: [
    { id: 'choice', strategy: 'decision-check', format: x => `「${x}」を採用するかどうか、判断に必要な条件は揃っていますか？` },
    { id: 'tradeoffs', strategy: 'decision-check', format: x => `「${x}」の採用で、どの欠点を許容しますか？` },
    { id: 'reversal', strategy: 'decision-check', format: x => `「${x}」の判断を見直す条件は何ですか？` }
  ],
  act: [
    { id: 'who-what-when', strategy: 'action-planning', format: x => `「${x}」を実行する担当者・作業内容・期限は何ですか？` },
    { id: 'acceptance', strategy: 'action-planning', format: x => `「${x}」の完了を確認する受入条件は何ですか？` },
    { id: 'next-check', strategy: 'action-planning', format: x => `「${x}」の最初の検証と見直しはいつ行いますか？` }
  ]
}

const PREFERRED_KINDS: Readonly<Record<BrainstormPhase, readonly ThoughtKind[]>> = {
  discover: ['problem', 'question'],
  define: ['problem', 'assumption'],
  diverge: ['idea', 'problem'],
  challenge: ['assumption', 'idea', 'claim'],
  evaluate: ['idea', 'claim'],
  decide: ['decision', 'idea'],
  act: ['action', 'decision', 'idea']
}

function shortFocus(value: string): string {
  // Code points, not UTF-16 offsets: do not split emoji or surrogate pairs.
  const scalars = Array.from(value.replace(/\s+/gu, ' ').trim())
  return scalars.length > 80 ? scalars.slice(0, 80).join('') + '…' : scalars.join('')
}

function pickFocus(snapshot: BrainstormSnapshotV1): ThoughtNodeV1 | undefined {
  const nodes = snapshot.nodes.filter(n => n.status !== 'archived' && n.status !== 'rejected')
  for (const kind of PREFERRED_KINDS[snapshot.session.phase]) {
    const candidates = nodes.filter(n => n.kind === kind)
    if (candidates.length !== 0) return candidates[candidates.length - 1]
  }
  return nodes[nodes.length - 1]
}

/**
 * Up to three prompts for the current phase; consumed IDs prevent repeating
 * previously asked questions without introducing a hidden mutable queue.
 */
export function suggestBrainstormQuestions(
  input: unknown,
  consumedIds: readonly string[] = [],
  maxSuggestions = 3
): BrainstormSuggestionResult {
  const parsed = parseBrainstormSnapshot(input)
  if (parsed.status !== 'valid') return { status: 'skipped', reason: 'invalid-snapshot' }
  if (!Array.isArray(consumedIds) || consumedIds.length > 1024 ||
      !consumedIds.every(id => typeof id === 'string' && id.length <= 256) ||
      !Number.isSafeInteger(maxSuggestions) || maxSuggestions < 1 || maxSuggestions > 3) {
    return { status: 'skipped', reason: 'invalid-options' }
  }
  const snapshot = parsed.snapshot
  const focus = pickFocus(snapshot)
  const focusId = focus?.id ?? null
  const topic = shortFocus(focus?.text ?? snapshot.session.theme)
  const consumed = new Set(consumedIds)
  const suggestions: BrainstormSuggestionV1[] = []
  for (const template of TEMPLATES[snapshot.session.phase]) {
    // Editing a thought changes its follow-up context: previous questions
    // must not suppress prompts for the revised claim.
    const id = focus === undefined
      ? [snapshot.session.phase, template.id, 'session'].join(':')
      : [snapshot.session.phase, template.id, focus.id, focus.updatedAt].join(':')
    if (consumed.has(id)) continue
    suggestions.push(Object.freeze({
      id,
      phase: snapshot.session.phase,
      strategy: template.strategy,
      focusNodeId: focusId,
      question: template.format(topic),
      generatedBy: 'builtin-template-v1'
    }))
    if (suggestions.length === maxSuggestions) break
  }
  return { status: 'ready', suggestions: Object.freeze(suggestions) }
}
