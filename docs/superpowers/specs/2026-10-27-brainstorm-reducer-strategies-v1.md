# Brainstorm P2-A — Atomic reducer & no-model question strategies

> Date: 2026-10-27. Scope: domain-only feature slice. Not connected to editor, storage, RuleProfile, Lint or any AI service.

## Background and scope

The merged PR #100 introduced `BrainstormSnapshotV1` (session, thought nodes/edges, UTF-16 source evidence, provenance) and a strict runtime gate. PR #101 introduced explicit Japanese question/confirmation/action intent detection. Neither foundation provides safe interactive editing nor deterministic solo-brainstorming questions.

This PR delivers:
- `src/core/thinking/reducer.ts` — pure optimistic-concurrency graph mutations.
- `src/core/thinking/questions.ts` — phase-aware Japanese question strategies, model-free.
- Failure-detecting unit tests and this design note.

No new runtime dependency, network access, storage migration, model download, UI surface, CI workflow, or change to existing Lint/Formatter.

## Semantics and invariants

1. **Atomic graph updates:** All candidate snapshots run through `parseBrainstormSnapshot()`. Invalid updates yield only rejection; the old snapshot is never modified.
2. **Optimistic concurrency:** Each command requires `expectedRevision` matching `session.historyRevision`. A stale or replayed command is rejected with `revision-conflict`. A successful mutation increments the revision exactly once. No-op commands return `unchanged` without incrementing.
3. **Graph consistency:** Add/remove node, add/remove edge preserve existing V1 ID uniqueness, edge endpoints and caps; node deletion cascades its incident edges. Valid dependency cycles remain allowed and may be flagged by future diagnostic rules.
4. **Human-review boundary:** Human-origin nodes cannot transition directly from draft to accepted; reviewed is required. `model-suggested` stays draft (as required by V1); future explicit approval ledger is outside this PR.
5. **Evidence invalidation:** A semantic node text edit resets status to draft and removes old source excerpts so an altered claim does not keep an approval or unrelated supporting span. The new update timestamp must advance monotonically. No text generation or automatic document rewriting happens.
6. **Phase control:** Adjacent moves only along discover → define → diverge → challenge → evaluate → decide → act. Returning to a prior phase is allowed. Boundary moves are no-op. Completion criteria are **advisory**, not an arbitrary hard stop.
7. **No-model questions:** Each of 7 phases has 3 fixed Japanese prompts with a strategy ID; 5 Whys, problem framing, SCAMPER, premortem, alternatives, decision and action-planning. Prompts use a bounded codepoint-safe 80-scalar focus from the most recent preferred active node or the session theme. No user text is sent externally.
8. **Avoid repetition:** Suggestion IDs are stable per phase/template/focus node. Caller supplies consumed IDs; no hidden mutable history or background queue. Once all 3 prompts for a focus are consumed, the result is an empty suggestions array; future UI may guide users to enter a new thought or return to a previous phase.

## Alternatives

| Option | Benefits | Drawbacks | Decision |
|---|---|---|---|
| Mutate graph arrays directly in SolidJS state | Fast to prototype | Difficult rollback; stale UI actions and orphaned edges | Reject |
| Use XState/Yjs/LLM in core | Extensive capabilities | Unnecessary dependency and migration risk before MVP validation | Defer |
| Pure reducer + strict snapshot gate + deterministic questions | Simple, testable, offline, compatible | UI/persistence and open-ended ideation still missing | **Adopt** |

## Test plan

Mutation checks:
- Add node/edge and immutable result, stale replay rejection, malformed command and future schema rejection.
- Orphan/duplicate-edge and ID conflicts reject without mutating the previous snapshot.
- Remove node cascades only incident edges.
- Editing previously accepted text revokes accepted status and source anchors.
- Monotonic timestamp, human review step, model proposal no-promotion.
- Phase forward/back and boundaries, `MAX_SAFE_INTEGER` revision overflow.

Question strategy checks:
- Seven phase strategies and exact deterministic no-model prompts.
- Recent preferred node selection; archived/rejected nodes skipped.
- No-node fallback to theme, bounded emoji text, consumed ID deduplication.
- Invalid import/oversized consumed history rejected; frozen output.

## Release and follow-ups

This PR does not make a full usable brainstorm UI. Follow-ups:
- P2-B: memory-only session controller and a simple thought/question panel, first behind a feature flag and compatible with Private Session.
- P1-B: `EventFrame`, missing information, source-anchored deadlines and reasons — opt-in diagnostics with false-positive corpus.
- P2-C: explicit Local Library persistence and version migration, delete/reset/export, multi-document source validation; no private-text persistence.
- Later: graph visualization, search and opt-in local NLP/AI providers after measured benchmarks and license review.

CI gate: existing `bun run lint`, `dict:check`, `bun run test`, smoke benchmark, both Vite builds; do not claim end-user UX or browser device validation from these tests alone.
