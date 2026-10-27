# P1-C — Read-only Communication Review Dialog

> Date: 2026-10-27. Builds on PR #101's explicit communication act classifier, without modifying the existing Lint/Formatter contract.

## Goal

Make structured Japanese question/request analysis visible to users, on demand, without prematurely promoting heuristic results to ordinary lint warnings.

## Scope

- `src/core/communication/review.ts`: explicit-run review snapshot, Japanese intent and answer-type descriptions, stale-source/navigation guards.
- `src/components/CommunicationReviewDialog.tsx` / `CommunicationReviewDialog.css`: mobile-friendly dialog with classification, evidence, expected answer, completion caveat, re-analyze and jump to original.
- `Header.tsx`, `App.tsx`: independent launch button and modal state.
- `tests/communication/review.test.ts`: human-readable categories, exact UTF-16 spans, source freshness and spoofed evidence rejection.
- README documentation.

## Semantics

1. Classifier recognizes explicit examples only: approval/confirmation/action requests; binary/choice/date/numeric/explanation questions. It does **not** detect all implicit intent, infer actors/deadlines, verify factual truth or score answer completeness.
2. Grammar and pragmatic request purpose differ. A polite interrogative request still needs the requested action; a simple "はい" is not proof the task was completed.
3. Unknown outcomes are presented as "cannot determine", not successful or error-free analysis.
4. This is a **read-only feature**: no automatic edits, no new `Diagnostic`, no severity levels, no background Lint jobs or network calls.
5. Explicit analysis captures workspace ID, document ID, revision, document type and source text in volatile memory. Reopening the dialog analyzes the current document. While open, a source edit marks the previous snapshot stale until reanalysis; it is not silently refreshed.
6. The "navigate" operation checks all captured identity and revision fields, entire source text equality, evidence exact range, and membership in the original review result before using the existing editor adapter.
7. Opening a different document/workspace invalidates old source navigation. Stale results remain visible as historical context but must be marked stale.
8. Size/result caps from the existing classifier apply (200,000 UTF-16 code units / max 512 acts); over-limit documents do not return partial findings.
9. The app's CSS variables and SolidJS modal patterns are reused; existing Lint/Formatter/Local Library/Private Session remain unchanged.

## Alternatives and decision

| Approach | Benefits | Risks | Decision |
|---|---|---|---|
| Register broad `CoreRule` diagnostics immediately | Minimal new UI | High false positives in normal prose, warning fatigue, fixes without clear context | Defer |
| Automatically re-run deep analysis at each keystroke | Always fresh | UI performance and confusing incomplete input updates | Reject for v1 |
| On-demand read-only review | Explicit, interpretable, no conflict with current Lint, safe fallback | Extra click; won't detect implicit requests | Adopt |

## Validation

- Unit tests for labels, request-vs-binary question distinction and explicit examples.
- UTF-16 evidence round-trip, stale revision after edits, workspace/document switch, entire document source mismatch.
- Reject synthetic/replayed evidence objects and invalid ranges even if text seems plausible.
- Markdown code/blockquote/heading exclusions and empty results.
- Existing CI must pass: Bun typecheck, Vitest, dictionary verification, production and GitHub Pages builds.

## Out of scope / follow-ups

- No full Japanese syntactic/semantic parsing, predicate argument extraction, deadline scope normalization, answer-to-question semantic alignment, multi-question splitting or grounded model explanations.
- Browser E2E, keyboard/focus and cross-browser performance smoke tests remain to be performed before claiming complete production UX.
- After gold corpus evaluation, safely project high-precision findings into `Diagnostic` only behind a document profile policy, with no automatic replacement.
