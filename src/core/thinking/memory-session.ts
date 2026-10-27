/**
 * Volatile, workspace-isolated solo brainstorming session.
 *
 * Never reads or writes IndexedDB/localStorage, the editor document or network.
 * Switching workspaces discards the previous graph, even in Local Library mode.
 */
import type {
  BrainstormPhase, BrainstormSnapshotV1, ThoughtKind, ThoughtNodeV1
} from './contracts'
import {
  applyBrainstormCommand, type BrainstormCommandV1
} from './reducer'
import {
  suggestBrainstormQuestions, type BrainstormSuggestionV1
} from './questions'
import { parseBrainstormSnapshot } from './validate'

export const BRAINSTORM_PHASE_LABELS: Readonly<Record<BrainstormPhase, string>> = {
  discover: '問題を発見する',
  define: '問題を明確にする',
  diverge: 'アイデアを広げる',
  challenge: '仮説を検証・反証する',
  evaluate: '比較・評価する',
  decide: '意思決定する',
  act: '実行計画にする'
}

export const BRAINSTORM_PHASE_THOUGHT_KIND: Readonly<Record<BrainstormPhase, ThoughtKind>> = {
  discover: 'problem', define: 'problem', diverge: 'idea',
  challenge: 'counterargument', evaluate: 'evidence',
  decide: 'decision', act: 'action'
}

export class BrainstormMemorySession {
  private workspaceId: string | null = null
  private current: BrainstormSnapshotV1 | null = null
  private consumedQuestions: string[] = []

  /** Returns true if the workspace changed and old volatile state was discarded. */
  bindWorkspace(workspaceId: string | null): boolean {
    if (this.workspaceId === workspaceId) return false
    this.workspaceId = workspaceId
    this.clear()
    return true
  }

  clear(): void {
    this.current = null
    this.consumedQuestions = []
  }

  start(theme: string, id: string): boolean {
    if (this.workspaceId === null || typeof theme !== 'string' ||
        !theme.trim() || theme.length > 512) return false
    const checked = parseBrainstormSnapshot({
      schemaVersion: 1,
      session: {
        id, workspaceId: this.workspaceId, theme: theme.trim(),
        goal: null, constraints: [], phase: 'discover', historyRevision: 0
      },
      nodes: [], edges: []
    })
    if (checked.status !== 'valid') return false
    this.current = checked.snapshot
    this.consumedQuestions = []
    return true
  }

  snapshot(): BrainstormSnapshotV1 | null {
    return this.current
  }

  private run(command: BrainstormCommandV1): boolean {
    if (this.current === null) return false
    const result = applyBrainstormCommand(this.current, command)
    if (result.status !== 'applied') return false
    this.current = result.snapshot
    return true
  }

  addThought(id: string, text: string, timestamp: string): boolean {
    if (this.current === null) return false
    const normalized = typeof text === 'string' ? text.trim() : ''
    if (!normalized || normalized.length > 4096) return false
    const node: ThoughtNodeV1 = {
      id, kind: BRAINSTORM_PHASE_THOUGHT_KIND[this.current.session.phase],
      text: normalized, origin: 'user-stated', status: 'draft',
      sourceSpans: [], createdAt: timestamp, updatedAt: timestamp
    }
    const answeredQuestion = this.question()
    if (answeredQuestion === null) {
      return this.run({
        type: 'add-node', expectedRevision: this.current.session.historyRevision, node
      })
    }
    const questionNode: ThoughtNodeV1 = {
      id: `question-${id}`, kind: 'question',
      text: answeredQuestion.question, origin: 'rule-derived', status: 'draft',
      sourceSpans: [], createdAt: timestamp, updatedAt: timestamp
    }
    const committed = this.run({
      type: 'answer-question', expectedRevision: this.current.session.historyRevision,
      question: questionNode, answer: node,
      edge: {
        id: `answer-${id}`,
        fromNodeId: node.id, toNodeId: questionNode.id,
        relation: 'answers', origin: 'user-stated'
      }
    })
    if (committed) this.consume(answeredQuestion.id)
    return committed
  }

  removeThought(id: string): boolean {
    if (this.current === null) return false
    return this.run({
      type: 'remove-node', expectedRevision: this.current.session.historyRevision, nodeId: id
    })
  }

  movePhase(direction: 'forward' | 'backward'): boolean {
    if (this.current === null) return false
    return this.run({
      type: 'move-phase', expectedRevision: this.current.session.historyRevision,
      direction
    })
  }

  question(): BrainstormSuggestionV1 | null {
    if (this.current === null) return null
    const result = suggestBrainstormQuestions(this.current, this.consumedQuestions, 1)
    return result.status === 'ready' ? (result.suggestions[0] ?? null) : null
  }

  private consume(id: string): void {
    // Bounded ephemeral history: never turn long sessions into invalid options.
    if (this.consumedQuestions.length >= 1024) this.consumedQuestions.shift()
    this.consumedQuestions.push(id)
  }

  skipQuestion(): boolean {
    const question = this.question()
    if (question === null) return false
    this.consume(question.id)
    return true
  }

  /** Opt-in export only; never called from autosave. */
  exportSnapshot(): string | null {
    return this.current === null ? null : JSON.stringify(this.current, null, 2)
  }
}
