/**
 * Strict runtime validation for untrusted imported/local Thought Graph snapshots.
 * Fail closed on malformed data. The returned graph owns fresh frozen copies,
 * so mutation of an input object cannot change previously validated results.
 */
import type {
  BrainstormPhase, BrainstormSessionV1, BrainstormSnapshotV1,
  SourceDocumentSnapshot, SourceSpanV1, SpanValidity,
  ThoughtEdgeV1, ThoughtKind, ThoughtNodeV1, ThoughtOrigin,
  ThoughtRelation, ThoughtStatus
} from './contracts'

const NODE_KINDS: ReadonlySet<string> = new Set<ThoughtKind>([
  'problem', 'idea', 'claim', 'assumption', 'evidence',
  'counterargument', 'question', 'experiment', 'decision', 'action'
])
const RELATIONS: ReadonlySet<string> = new Set<ThoughtRelation>([
  'supports', 'challenges', 'depends-on', 'derived-from',
  'answers', 'tests', 'addresses', 'duplicates'
])
const ORIGINS: ReadonlySet<string> = new Set<ThoughtOrigin>([
  'user-stated', 'rule-derived', 'model-suggested', 'imported'
])
const STATUSES: ReadonlySet<string> = new Set<ThoughtStatus>([
  'draft', 'reviewed', 'accepted', 'rejected', 'archived'
])
const PHASES: ReadonlySet<string> = new Set<BrainstormPhase>([
  'discover', 'define', 'diverge', 'challenge', 'evaluate', 'decide', 'act'
])
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/u
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u

export type BrainstormValidationFailure =
  | 'shape' | 'schema-version' | 'limits' | 'session' | 'node'
  | 'edge' | 'source-span' | 'duplicate-id' | 'dangling-edge'
  | 'duplicate-edge' | 'provenance'

export type BrainstormParseResult =
  | { readonly status: 'valid'; readonly snapshot: BrainstormSnapshotV1 }
  | { readonly status: 'invalid'; readonly reason: BrainstormValidationFailure }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function keys(value: unknown, required: readonly string[]): value is Record<string, unknown> {
  return record(value) &&
    Object.keys(value).length === required.length &&
    required.every(key => Object.prototype.hasOwnProperty.call(value, key))
}

function boundedText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max && value.trim().length > 0
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value)
}

function whole(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isoUtc(value: unknown): value is string {
  return typeof value === 'string' && ISO_UTC.test(value) &&
    Number.isFinite(Date.parse(value))
}

function member(value: unknown, set: ReadonlySet<string>): value is string {
  return typeof value === 'string' && set.has(value)
}

function parseSpan(raw: unknown): SourceSpanV1 | null {
  if (!keys(raw, ['documentId', 'revision', 'startUtf16', 'endUtf16', 'excerpt']) ||
      !identifier(raw.documentId) || !whole(raw.revision) ||
      !whole(raw.startUtf16) || !whole(raw.endUtf16) ||
      !boundedText(raw.excerpt, 1024) ||
      raw.endUtf16 <= raw.startUtf16 ||
      raw.endUtf16 - raw.startUtf16 !== raw.excerpt.length) return null
  return Object.freeze({
    documentId: raw.documentId, revision: raw.revision,
    startUtf16: raw.startUtf16, endUtf16: raw.endUtf16, excerpt: raw.excerpt
  })
}

/**
 * 'stale' means structurally valid evidence cannot be authenticated against
 * the current source revision. 'invalid' means its geometry is malformed.
 */
export function validateSourceSpan(
  span: unknown, document: SourceDocumentSnapshot
): SpanValidity {
  const valid = parseSpan(span)
  if (valid === null || !identifier(document?.documentId) ||
      !whole(document?.revision) || typeof document?.text !== 'string') return 'invalid'
  if (valid.documentId !== document.documentId ||
      valid.revision !== document.revision ||
      valid.endUtf16 > document.text.length ||
      document.text.slice(valid.startUtf16, valid.endUtf16) !== valid.excerpt) return 'stale'
  const interiorSurrogate = (offset: number) =>
    offset > 0 && offset < document.text.length &&
    document.text.charCodeAt(offset - 1) >= 0xd800 &&
    document.text.charCodeAt(offset - 1) <= 0xdbff &&
    document.text.charCodeAt(offset) >= 0xdc00 &&
    document.text.charCodeAt(offset) <= 0xdfff
  return interiorSurrogate(valid.startUtf16) || interiorSurrogate(valid.endUtf16)
    ? 'invalid' : 'current'
}

function parseSession(raw: unknown): BrainstormSessionV1 | null {
  if (!keys(raw, ['id', 'workspaceId', 'theme', 'goal', 'constraints', 'phase', 'historyRevision']) ||
      !identifier(raw.id) || !identifier(raw.workspaceId) ||
      !boundedText(raw.theme, 512) ||
      (raw.goal !== null && !boundedText(raw.goal, 2048)) ||
      !Array.isArray(raw.constraints) || raw.constraints.length > 64 ||
      !raw.constraints.every(c => boundedText(c, 512)) ||
      !member(raw.phase, PHASES) || !whole(raw.historyRevision)) return null
  return Object.freeze({
    id: raw.id, workspaceId: raw.workspaceId, theme: raw.theme,
    goal: raw.goal as string | null,
    constraints: Object.freeze([...raw.constraints] as string[]),
    phase: raw.phase as BrainstormPhase, historyRevision: raw.historyRevision
  })
}

function parseNode(raw: unknown): ThoughtNodeV1 | BrainstormValidationFailure {
  if (!keys(raw, ['id', 'kind', 'text', 'origin', 'status', 'sourceSpans', 'createdAt', 'updatedAt']) ||
      !identifier(raw.id) || !member(raw.kind, NODE_KINDS) ||
      !boundedText(raw.text, 4096) || !member(raw.origin, ORIGINS) ||
      !member(raw.status, STATUSES) ||
      !isoUtc(raw.createdAt) || !isoUtc(raw.updatedAt) ||
      Date.parse(raw.createdAt) > Date.parse(raw.updatedAt) ||
      !Array.isArray(raw.sourceSpans) || raw.sourceSpans.length > 32) return 'node'
  if (raw.origin === 'model-suggested' && raw.status !== 'draft') {
    // Explicit approval events are not part of V1; do not silently trust a model.
    return 'provenance'
  }
  const sourceSpans: SourceSpanV1[] = []
  for (const span of raw.sourceSpans) {
    const parsed = parseSpan(span)
    if (parsed === null) return 'source-span'
    sourceSpans.push(parsed)
  }
  return Object.freeze({
    id: raw.id, kind: raw.kind as ThoughtKind, text: raw.text,
    origin: raw.origin as ThoughtOrigin, status: raw.status as ThoughtStatus,
    sourceSpans: Object.freeze(sourceSpans), createdAt: raw.createdAt,
    updatedAt: raw.updatedAt
  })
}

function parseEdge(raw: unknown): ThoughtEdgeV1 | null {
  if (!keys(raw, ['id', 'fromNodeId', 'toNodeId', 'relation', 'origin']) ||
      !identifier(raw.id) || !identifier(raw.fromNodeId) ||
      !identifier(raw.toNodeId) || raw.fromNodeId === raw.toNodeId ||
      !member(raw.relation, RELATIONS) || !member(raw.origin, ORIGINS)) return null
  return Object.freeze({
    id: raw.id, fromNodeId: raw.fromNodeId,
    toNodeId: raw.toNodeId, relation: raw.relation as ThoughtRelation,
    origin: raw.origin as ThoughtOrigin
  })
}

/** Bounded, atomic parser for future IndexedDB persistence / import. */
export function parseBrainstormSnapshot(input: unknown): BrainstormParseResult {
  if (!keys(input, ['schemaVersion', 'session', 'nodes', 'edges'])) {
    return {status: 'invalid', reason: 'shape'}
  }
  if (input.schemaVersion !== 1) return {status: 'invalid', reason: 'schema-version'}
  if (!Array.isArray(input.nodes) || !Array.isArray(input.edges)) {
    return {status: 'invalid', reason: 'shape'}
  }
  if (input.nodes.length > 1000 || input.edges.length > 5000) {
    return {status: 'invalid', reason: 'limits'}
  }
  const session = parseSession(input.session)
  if (session === null) return {status: 'invalid', reason: 'session'}
  const nodes: ThoughtNodeV1[] = []
  const nodeIds = new Set<string>()
  for (const rawNode of input.nodes) {
    const node = parseNode(rawNode)
    if (typeof node === 'string') return {status: 'invalid', reason: node}
    if (nodeIds.has(node.id)) return {status: 'invalid', reason: 'duplicate-id'}
    nodeIds.add(node.id)
    nodes.push(node)
  }
  const edges: ThoughtEdgeV1[] = []
  const edgeIds = new Set<string>()
  const relations = new Set<string>()
  for (const rawEdge of input.edges) {
    const edge = parseEdge(rawEdge)
    if (edge === null) return {status: 'invalid', reason: 'edge'}
    if (nodeIds.has(edge.id) || edgeIds.has(edge.id)) {
      return {status: 'invalid', reason: 'duplicate-id'}
    }
    if (!nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId)) {
      return {status: 'invalid', reason: 'dangling-edge'}
    }
    const relationKey = JSON.stringify([edge.fromNodeId, edge.toNodeId, edge.relation])
    if (relations.has(relationKey)) {
      return {status: 'invalid', reason: 'duplicate-edge'}
    }
    edgeIds.add(edge.id)
    relations.add(relationKey)
    edges.push(edge)
  }
  return {
    status: 'valid',
    snapshot: Object.freeze({
      schemaVersion: 1,
      session,
      nodes: Object.freeze(nodes),
      edges: Object.freeze(edges)
    })
  }
}
