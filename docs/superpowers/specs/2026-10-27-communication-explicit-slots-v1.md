# P1-D — Explicit temporal and motivation candidate extraction

> Date: 2026-10-27; based on PR #101's explicit communication acts and PR #106's read-only UI. No source rewriting, model execution, automatic task extraction, automatic normalization or persistence.

## Why

A question/approval/request classifier alone cannot help reviewers spot explicitly written deadlines and their motivating clauses. The V1 detector can be extended with narrow, source-anchored candidate spans without pretending to understand the full semantics of Japanese subordinate clauses.

## Implementation

`extractExplicitCommunicationSlots(source, acts)` scans **only** acts already accepted by the conservative explicit-act detector. Every candidate has:
- exact `[startUtf16, endUtf16)`, `evidence`, and enclosing act span,
- `kind`: deadline-candidate, purpose-candidate, reason-candidate, ambiguous-motivation,
- `needsDateContext` for relative/omitted-year deadlines,
- `scope: 'sentence-candidate'` and extraction method.

The patterns recognize explicit `まで/までに` date phrases (including ISO dates, Japanese year/month/day, weekday and common relatives), reason phrases with `が原因で/という理由で/が理由で`, purpose phrases with `を目的として/を目指して`, and ambiguous `のため(に)`. **No candidate is an asserted causal fact or a resolved deadline.**

The UI renders candidates under the matching detected request/question with caution messages. The entire existing review snapshot is tied to the exact current workspace/document/revision/text and therefore rejects stale source navigation.

## Deliberately unsupported / not inferred

- Who is the responsible actor, which event owns the deadline, or whether the event has multiple deadlines
- Relative date normalization; missing-year resolution; validity of 2026-02-30
- Relationship of purpose/reason to a specific predicate or corporate entity
- Text from masked Markdown code, tables and quoted examples
- Implicit motivation, references spanning multiple clauses/sentences
- Automatic warnings, severity or Quick Fix

## Safety and performance

Source cap 200,000 UTF-16 code units; max 512 acts; max 1,024 candidates. Return `skipped` rather than partial results on invalid inputs or result overflow. Reason/purpose regexes use bounded lookahead windows to avoid unrestricted backtracking. Every generated span must equal the source slice, and candidates are sorted by original UTF-16 offset. Output is immutable and not uploaded.

## Alternatives considered

| Option | Benefit | Problem | Decision |
|---|---|---|---|
| Full predicate-argument parser now | More semantic roles | Lindera/GiNZA/WASM readiness and accuracy not validated | Defer |
| Convert relative dates to actual deadlines | Actionable | Unknown reference date and timezone; incorrect concrete dates are harmful | Reject |
| Context-preserving explicit patterns | Low-cost, testable, no invented facts | Lower recall | Adopt |

## Verification

- Test explicit and relative deadlines, omitted-year flags, purpose/reason ambiguity and lexical reason/purpose.
- Include emoji and Markdown list source offset invariants.
- Detect no deadline unless `まで/までに` is explicit.
- Corrupted act anchor yields failure, not a fabricated slot.
- Existing PR CI: typecheck, full Vitest, reproducible dictionaries, smoke benchmark, normal and Pages builds.
- Manual browser E2E is still a separate acceptance gate.

## Next step

Gold corpus labeling for Japanese business inquiries, multi-clause deadline scope and actor/action/object extraction with abstention. Only after precision is measured should optional `Diagnostic` integration be considered.
