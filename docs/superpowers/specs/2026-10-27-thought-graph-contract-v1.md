# Writing & Thinking Engine — Thought Graph IR v1 (P0-A)

> Status: experimental data contract only. No end-user UI, LLM, NLP provider, document persistence, or automatic rewriting is enabled by this change.
> Baseline: `japanese_text` main after ZIP gate fix PR #99 (2026-10-27 JST).

## Why now

The upcoming communication analyzer and one-person brainstorm feature need to share structured ideas, questions, claims, evidence and decisions. A chat log cannot safely represent relationships or track stale source evidence. Introduce a small versioned, bounded local-first graph IR **before** adding model providers or graph visualization.

## Scope and files

- `src/core/thinking/contracts.ts`: versioned `BrainstormSnapshotV1`, typed nodes/edges/session, UTF-16 source anchors, provenance.
- `src/core/thinking/validate.ts`: strict parse/clone/freeze, graph referential integrity, source-anchor verification.
- `tests/thinking/graph-contract-v1.test.ts`: valid graph, malformed imports, limits, provenance, Unicode/stale references.

Not changed: existing `CoreRule`, `Diagnostic`, `Fast/Deep/Idle`, Formatter, worker protocols, dictionaries, app config, IndexedDB schema, CI workflow, or bundle dependencies.

## Decisions and invariants

1. **Atomic graph snapshot.** `session`, `nodes`, `edges` travel as one `schemaVersion:1` value. Do not redundantly persist node/edge ID arrays that can drift out of sync.
2. **Bounded import boundary.** Max 1,000 nodes; 5,000 edges; 4,096 UTF-16 units per node; 32 source spans per node; 1,024 UTF-16 units per excerpt; 64 constraints. Unexpected fields and unknown enum values are rejected. Future schema versions are rejected until migration logic exists.
3. **Referential integrity.** Unique IDs across nodes/edges, existing edge endpoints, no self-edge and no duplicate directed (source,target,relation) edges. Different relation types on the same two nodes are allowed. `depends-on` cycles are not silently broken; potential cycles are future **diagnostics**, not a serialization error.
4. **Source provenance.** `SourceSpanV1` carries `documentId`, `revision`, UTF-16 half-open range and verbatim excerpt. `validateSourceSpan(span, currentDocument)` must return `current`, `stale` or `invalid`; an excerpt mismatch or revision mismatch must never count as current. Surrogate-pair slicing is invalid.
5. **Model authority boundary.** `model-suggested` nodes are **draft only** in V1. A future explicit human approval event is needed before model-origin decisions can be accepted. `externally-verified` provenance is not yet permitted: this requires a separate trusted source verification record.
6. **Immutability / input isolation.** The validator returns fresh frozen copies rather than exposing caller-owned mutable arrays.
7. **No automatic fixes.** This IR is not a `Diagnostic` and cannot write the document or claim that an inferred statement is factual.

## Alternative approaches considered

| Approach | Upside | Downside | Decision |
|---|---|---|---|
| Extend `Diagnostic` with graph fields | Less new code | Couples ephemeral UI findings to persistent thought state; migration risk | Reject |
| Store arbitrary graph JSON without validation | Quick prototype | Orphan edges, duplicate IDs, prompt/HTML injection risks, hard recovery | Reject |
| Versioned typed graph + runtime gate | Explicit limits and migration surface; isolated from Lint | Requires schema and tests | **Adopt** |

## Data migration

No existing user storage changes in this PR. No graph is persisted. Later persistence requires an additive IndexedDB upgrade or a separate scoped object store, Private Session tests, recovery from malformed snapshots, and explicit exported format versioning. Future `schemaVersion` values must not be silently interpreted as v1.

## Test rationale

The tests must fail if the duplicate ID guard, endpoint validation, provenance restriction, source revision/excerpt validation, surrogate boundary check or input-copy isolation is removed. They also verify a legal cycle is not incorrectly rejected.

No real user text or external model files are included in fixtures. The number of tests is not a substitute for future end-to-end verification.

## Remaining risks / subsequent PRs

- Add the separate `EventFrame` / `QuestionFrame` / `CommunicativeAct` contracts on top of these source spans; explicit Japanese question classification is the first vertical slice.
- The current `excerpt` duplicates text inside the IR. Assess whether to store an excerpt hash instead when integrating with Private/Local Library. Avoid writing the IR to disk in Private Session.
- No graph reducer, human approval ledger, XSS-safe renderer, profile policies, persistence or model outputs exist yet.
- Browser measurements and full end-to-end backup/restore are required before user release.

## Acceptance criteria

- `bun run lint` / `bun run test` / `bun run build` / `bun run build:pages` on existing CI.
- The existing editor, Lint and storage semantics remain unchanged.
- Malformed inputs do not yield usable graph snapshots, and valid inputs cannot be mutated by changing the original object afterwards.
