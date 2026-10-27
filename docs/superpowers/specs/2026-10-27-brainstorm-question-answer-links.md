# P2-C — 質問・回答の原子的なThought Graph記録

> 2026-10-27 / Based on #100 (V1 graph), #102 (reducer/strategies) and #103 (memory-only UI). This feature remains local and does not persist data, invoke models or change the text editor.

## Problem

The P2-B UI stores only the user's note, but does not preserve which question triggered it. Subsequent brainstorming and export cannot explain the question→answer trail. Worse, sequentially saving a question, answer, and link could leave a half-written graph after a failed update.

## Design

Add `answer-question` to the existing `BrainstormCommandV1`:
- `question`: rule-derived, draft, kind `question`.
- `answer`: user-stated, draft, kind selected by current brainstorm phase.
- `edge`: exactly `answer.id → question.id`, relation `answers`.
- `expectedRevision`: guard against replay and stale UI actions.

All three objects are added to **one candidate graph** and run through the existing `parseBrainstormSnapshot()`. On success, historyRevision increments exactly once. On failure, neither question, answer, nor edge becomes visible.

The MemorySession only consumes the template question **after** the atomic update succeeds. When no template question is available (e.g. exhausted prompts), a free note is recorded without inventing a question.

## Invariants

1. No LLM or network, no user document modifications, no IndexedDB/Local Library writes; all user content is volatile.
2. Rule-generated question nodes are not asserted facts; human answer nodes stay draft until reviewed by a future workflow.
3. The V1 snapshot and JSON export include the exact question and answer nodes plus their `answers` relation. V1 schema is unchanged.
4. Strict validator rejects ID collisions, missing links and caps. A failed answer cannot advance question history or silently lose the answer.
5. UI shows the linked question on the answer entry. A rule-derived question is also visible as its own graph node, and deleting it removes the incident relation (without deleting the user's answer). The UI currently does **not** offer relation editing or answer re-assignment.
6. The graph cannot be silently upgraded to `accepted` by merely answering a question.

## Alternatives

| Option | Evaluation | Decision |
|---|---|---|
| Save question text on answer node | Requires V1 schema change, duplicates arbitrary fields and loses graph semantics | Reject |
| Save question then answer then link in three commands | Partial failures and 3 revision increments | Reject |
| Add atomic command to pure reducer | Keeps V1 parser and current UI, ensures referential integrity | Adopt |

## Verification

Tests cover: atomic commits and one revision increment; graph export roundtrip; invalid link shape; model-origin question reject; duplicate answer ID reject; 1000-node cap; revision replay; no-question free notes; no implicit persistence. The normal TypeScript/Vitest/build/Pages CI is required.

## Limitations and follow-up

- This records **which template question** the user responded to, but does not semantically grade whether the response fully answers it.
- The prompt is a fixed template; it is not a verified external fact.
- No undo/redo or imported persisted session is supplied; delete confirmation and manual JSON export remain the available safety tools.
- UI screenshot/keyboard/device smoke tests are still needed before claiming browser-level UX completeness.
