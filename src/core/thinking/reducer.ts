/**
 * Pure, optimistic-concurrency Thought Graph reducer.
 *
 * No persistence, UI side effects, network requests or model execution.
 * Every changed snapshot is revalidated by the V1 import gate.
 */
import type {
  BrainstormPhase, BrainstormSnapshotV1, ThoughtEdgeV1, ThoughtNodeV1, ThoughtStatus
} from './contracts'
import { parseBrainstormSnapshot, type BrainstormValidationFailure } from './validate'

const PHASES: readonly BrainstormPhase[] = [
  'discover', 'define', 'diverge', 'challenge', 'evaluate', 'decide', 'act'
]

export type BrainstormCommandV1 =
  | { readonly type: 'add-node'; readonly expectedRevision: number; readonly node: ThoughtNodeV1 }
  | { readonly type: 'answer-question'; readonly expectedRevision: number; readonly question: ThoughtNodeV1; readonly answer: ThoughtNodeV1; readonly edge: ThoughtEdgeV1 }
  | { readonly type: 'edit-node'; readonly expectedRevision: number; readonly nodeId: string; readonly text: string; readonly updatedAt: string }
  | { readonly type: 'review-node'; readonly expectedRevision: number; readonly nodeId: string; readonly status: ThoughtStatus; readonly updatedAt: string }
  | { readonly type: 'remove-node'; readonly expectedRevision: number; readonly nodeId: string }
  | { readonly type: 'add-edge'; readonly expectedRevision: number; readonly edge: ThoughtEdgeV1 }
  | { readonly type: 'remove-edge'; readonly expectedRevision: number; readonly edgeId: string }
  | { readonly type: 'move-phase'; readonly expectedRevision: number; readonly direction: 'forward' | 'backward' }

export type BrainstormMutationResult =
  | { readonly status: 'applied'; readonly snapshot: BrainstormSnapshotV1 }
  | { readonly status: 'unchanged'; readonly snapshot: BrainstormSnapshotV1 }
  | { readonly status: 'rejected'; readonly reason: 'invalid-snapshot' | 'invalid-command' | 'revision-conflict' | 'not-found' | 'invalid-transition' | 'revision-limit'; readonly detail?: BrainstormValidationFailure }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: unknown, required: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).length === required.length &&
    required.every(k => Object.prototype.hasOwnProperty.call(value, k))
}

function validCommand(value: unknown): value is BrainstormCommandV1 {
  if (!isRecord(value) || !Number.isSafeInteger(value.expectedRevision) ||
      (value.expectedRevision as number) < 0) return false
  switch (value.type) {
    case 'add-node':
      return exactKeys(value, ['type', 'expectedRevision', 'node']) && isRecord(value.node)
    case 'answer-question':
      return exactKeys(value, ['type', 'expectedRevision', 'question', 'answer', 'edge']) &&
        isRecord(value.question) && isRecord(value.answer) && isRecord(value.edge)
    case 'add-edge':
      return exactKeys(value, ['type', 'expectedRevision', 'edge']) && isRecord(value.edge)
    case 'edit-node':
      return exactKeys(value, ['type', 'expectedRevision', 'nodeId', 'text', 'updatedAt']) &&
        typeof value.nodeId === 'string' && typeof value.text === 'string' &&
        typeof value.updatedAt === 'string'
    case 'review-node':
      return exactKeys(value, ['type', 'expectedRevision', 'nodeId', 'status', 'updatedAt']) &&
        typeof value.nodeId === 'string' && typeof value.status === 'string' &&
        typeof value.updatedAt === 'string'
    case 'remove-node':
      return exactKeys(value, ['type', 'expectedRevision', 'nodeId']) &&
        typeof value.nodeId === 'string'
    case 'remove-edge':
      return exactKeys(value, ['type', 'expectedRevision', 'edgeId']) &&
        typeof value.edgeId === 'string'
    case 'move-phase':
      return exactKeys(value, ['type', 'expectedRevision', 'direction']) &&
        (value.direction === 'forward' || value.direction === 'backward')
    default:
      return false
  }
}

/**
 * Transactional graph mutations using an expected revision to reject stale
 * UI actions and duplicate replay. Any invalid candidate is fully rejected.
 */
export function applyBrainstormCommand(
  input: unknown, command: unknown
): BrainstormMutationResult {
  const parsed = parseBrainstormSnapshot(input)
  if (parsed.status !== 'valid') return { status: 'rejected', reason: 'invalid-snapshot', detail: parsed.reason }
  const current = parsed.snapshot
  if (!validCommand(command)) return { status: 'rejected', reason: 'invalid-command' }
  if (command.expectedRevision !== current.session.historyRevision) {
    return { status: 'rejected', reason: 'revision-conflict' }
  }
  if (current.session.historyRevision === Number.MAX_SAFE_INTEGER) {
    return { status: 'rejected', reason: 'revision-limit' }
  }
  let nodes: readonly ThoughtNodeV1[] = current.nodes
  let edges: readonly ThoughtEdgeV1[] = current.edges
  let phase: BrainstormPhase = current.session.phase

  switch (command.type) {
    case 'add-node':
      nodes = [...nodes, command.node]
      break
    case 'answer-question':
      // The graph transition is all-or-nothing: question, answer and
      // their link must be committed under one snapshot revision.
      if (command.question.kind !== 'question' ||
          command.question.origin !== 'rule-derived' ||
          command.answer.origin !== 'user-stated' ||
          command.edge.relation !== 'answers' ||
          command.edge.fromNodeId !== command.answer.id ||
          command.edge.toNodeId !== command.question.id) {
        return { status: 'rejected', reason: 'invalid-command' }
      }
      nodes = [...nodes, command.question, command.answer]
      edges = [...edges, command.edge]
      break
    case 'edit-node': {
      const old = nodes.find(n => n.id === command.nodeId)
      if (old === undefined) return { status: 'rejected', reason: 'not-found' }
      if (old.text === command.text) {
        // Updating a timestamp alone is not a content edit.
        return { status: 'unchanged', snapshot: current }
      }
      if (!Number.isFinite(Date.parse(command.updatedAt)) ||
          Date.parse(command.updatedAt) <= Date.parse(old.updatedAt)) {
        return { status: 'rejected', reason: 'invalid-transition' }
      }
      // A revised claim must not retain its old approval or evidence links.
      nodes = nodes.map(n => n.id === command.nodeId
        ? { ...n, text: command.text, status: 'draft' as const,
            sourceSpans: [], updatedAt: command.updatedAt } : n)
      break
    }
    case 'review-node': {
      const old = nodes.find(n => n.id === command.nodeId)
      if (old === undefined) return { status: 'rejected', reason: 'not-found' }
      if (old.origin === 'model-suggested' && command.status !== 'draft') {
        return { status: 'rejected', reason: 'invalid-transition' }
      }
      // Explicit review is required before accepting a human-origin idea.
      if (command.status === 'accepted' && old.status !== 'reviewed') {
        return { status: 'rejected', reason: 'invalid-transition' }
      }
      if (old.status === command.status) {
        return { status: 'unchanged', snapshot: current }
      }
      if (!Number.isFinite(Date.parse(command.updatedAt)) ||
          Date.parse(command.updatedAt) <= Date.parse(old.updatedAt)) {
        return { status: 'rejected', reason: 'invalid-transition' }
      }
      nodes = nodes.map(n => n.id === command.nodeId
        ? { ...n, status: command.status, updatedAt: command.updatedAt } : n)
      break
    }
    case 'remove-node':
      if (!nodes.some(n => n.id === command.nodeId)) return { status: 'rejected', reason: 'not-found' }
      nodes = nodes.filter(n => n.id !== command.nodeId)
      edges = edges.filter(e => e.fromNodeId !== command.nodeId && e.toNodeId !== command.nodeId)
      break
    case 'add-edge':
      edges = [...edges, command.edge]
      break
    case 'remove-edge':
      if (!edges.some(e => e.id === command.edgeId)) return { status: 'rejected', reason: 'not-found' }
      edges = edges.filter(e => e.id !== command.edgeId)
      break
    case 'move-phase': {
      const index = PHASES.indexOf(phase)
      const target = index + (command.direction === 'forward' ? 1 : -1)
      if (target < 0 || target >= PHASES.length) return { status: 'unchanged', snapshot: current }
      phase = PHASES[target]!
      break
    }
  }

  const candidate: BrainstormSnapshotV1 = {
    schemaVersion: 1,
    session: {
      ...current.session,
      phase,
      historyRevision: current.session.historyRevision + 1
    },
    nodes,
    edges
  }
  const accepted = parseBrainstormSnapshot(candidate)
  if (accepted.status !== 'valid') {
    return { status: 'rejected', reason: 'invalid-command', detail: accepted.reason }
  }
  return { status: 'applied', snapshot: accepted.snapshot }
}
