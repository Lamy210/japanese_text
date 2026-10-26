/**
 * Versioned, local-first Thought Graph IR.
 *
 * This is a data contract only. It does not run NLP, persist user content,
 * generate prose, call external services, or alter the existing Lint pipeline.
 */
export type ThoughtKind =
  | 'problem' | 'idea' | 'claim' | 'assumption' | 'evidence'
  | 'counterargument' | 'question' | 'experiment' | 'decision' | 'action'

export type ThoughtRelation =
  | 'supports' | 'challenges' | 'depends-on' | 'derived-from'
  | 'answers' | 'tests' | 'addresses' | 'duplicates'

export type ThoughtOrigin =
  | 'user-stated' | 'rule-derived' | 'model-suggested' | 'imported'

export type ThoughtStatus =
  | 'draft' | 'reviewed' | 'accepted' | 'rejected' | 'archived'

export type BrainstormPhase =
  | 'discover' | 'define' | 'diverge' | 'challenge'
  | 'evaluate' | 'decide' | 'act'

/**
 * UTF-16 [startUtf16, endUtf16) positions in the original document revision.
 * The excerpt must match that exact slice when a snapshot is available.
 * A structurally valid span is NOT evidence that it is still current.
 */
export interface SourceSpanV1 {
  readonly documentId: string
  readonly revision: number
  readonly startUtf16: number
  readonly endUtf16: number
  readonly excerpt: string
}

export interface ThoughtNodeV1 {
  readonly id: string
  readonly kind: ThoughtKind
  readonly text: string
  readonly origin: ThoughtOrigin
  readonly status: ThoughtStatus
  readonly sourceSpans: readonly SourceSpanV1[]
  readonly createdAt: string
  readonly updatedAt: string
}

export interface ThoughtEdgeV1 {
  readonly id: string
  readonly fromNodeId: string
  readonly toNodeId: string
  readonly relation: ThoughtRelation
  readonly origin: ThoughtOrigin
}

export interface BrainstormSessionV1 {
  readonly id: string
  readonly workspaceId: string
  readonly theme: string
  readonly goal: string | null
  readonly constraints: readonly string[]
  readonly phase: BrainstormPhase
  readonly historyRevision: number
}

/**
 * Nodes and edges live in one atomic snapshot. There are deliberately
 * no redundant nodeIds/edgeIds arrays that could drift out of sync.
 */
export interface BrainstormSnapshotV1 {
  readonly schemaVersion: 1
  readonly session: BrainstormSessionV1
  readonly nodes: readonly ThoughtNodeV1[]
  readonly edges: readonly ThoughtEdgeV1[]
}

export interface SourceDocumentSnapshot {
  readonly documentId: string
  readonly revision: number
  readonly text: string
}

export type SpanValidity = 'current' | 'stale' | 'invalid'
