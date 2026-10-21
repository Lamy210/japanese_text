# Phase 3A — Bounded Japanese repetition diagnostics

Status: implementation. Base: main `51a351d5ff84f07f33d875956a001523499dede3`.

## Goal

Add two conservative writing-support rules without introducing a tokenizer, remote
dictionary, new package, LLM, API, database or migration. The purpose is to
catch high-confidence surface repetitions, **not** evaluate the semantics of
conjunctions or automatically rewrite the author's meaning.

## Rules and semantics

### `wording/repeated-phrase` (fast)

Flag the *second* occurrence in a bounded same-line pattern such as
`について、について` or `に関して， に関して`. The approved
phrase lexicon is intentionally limited to `について`, `に関して`,
`において`, `に対して`, `という`, and `として`.
A comma and optional horizontal whitespace must separate **identical** phrases.
This does not flag normal separated use such as `日本について、教育について`.

### `style/consecutive-conjunction` (fast)

Detect an identical connective at the beginning of adjacent sentences
within one prose paragraph, only when written with a following Japanese comma
(e.g. `しかし、...。しかし、...`). The bounded lexicon contains
explicit connective forms, not every use of `また` as an adverb.

A blank line, non-prose Markdown line, or intervening sentence without a
matching initial connective clears the prior candidate. Hard line breaks
after a sentence boundary are allowed; incomplete soft-wrapped lines clear it.
`一方` or `そのため` being repeated is a *review hint*, not proof
that the logic is wrong.

## False-positive boundaries

- Use the existing offset-preserving Markdown mask for code, URLs and metadata.
- Exclude Markdown headings, block quotes, lists, indented code and tables.
- Exclude Japanese inline quoted speech, including multiline bracketed quotes.
- Keep the original UTF-16 offsets (surrogate-pair/emoji regression tests).
- No replacements, no Quick Fix, no Safe Fix; the user decides.
- Deliberately do not infer invalid `しかし` vs `そのため` semantic relations,
  nor treat different additive connectives as equivalent.

## Wiring and backward compatibility

Register both with the existing builtin RuleProvider and its cached manifests.
Both are fast-tier, default `info`. General/Technical profiles enable them as
`info`, Strict as `warning`, Minimal leaves them disabled. No config schema
version bump, profile migration or dependency change.

## Verification

- Start with a failing regression suite (RED CI), then implement and verify GREEN.
- Positive and negative cases for both rules; exact UTF-16 offsets after emoji.
- Quoted text, Markdown code/URL/list/heading, paragraph boundaries, and
  detection only on consecutive sentence openings.
- Registry manifest parity and settings/preset integration.
- `bun run lint`, `bun run test`, `bun run build`, `bun run build:pages`
  and GitHub Pages worker asset-path check.

## Known limitations / follow-up

- The phrase rule covers only explicitly listed particles and may miss
  unbounded lexical repetitions.
- The conjunction rule does not perform morphological or discourse parsing,
  may miss connectors without commas, and may flag intentional rhetoric.
- Distinct connectives in the same discourse category, longer paragraph
  structure and context-sensitive grammar remain separate PoC/research items.
- Supplied regex NG words have separate ReDoS considerations; this change
  does not modify their validation/runtime behavior.
