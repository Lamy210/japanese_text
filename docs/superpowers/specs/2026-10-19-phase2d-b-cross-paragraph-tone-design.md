# Phase 2D-B — Cross-paragraph Japanese tone consistency

Status: implementation. Base: `main` at `4366c5eebb086152b56a39bee24e3b68e70c6ad6`.

## Goal
Extend the existing paragraph-local `style/mixed-tone` with an independent, explicitly scoped idle-tier rule `style/cross-paragraph-tone`. Detect prose that is internally consistent paragraph by paragraph but changes between polite (です・ます) and plain (である・だ) style across a single Markdown section. No LLM, morphology model, backend, network, schema migration, or new dependency.

## Semantics
- Divide document into sections at ATX headings, and prose paragraphs at blank lines. Headings do not contribute evidence; each heading starts a new section.
- Skip list items, blockquotes, Markdown tables, and code/URL/metadata regions already masked by the core engine. Inline Japanese quotation brackets `「…」`, `『…』` are ignored for evidence to avoid conflating quoted speech with narrator tone.
- Count one vote per paragraph, **not** per sentence. A paragraph qualifies only when it has clearly marked sentence-ending examples of exactly one style. Paragraphs mixing both styles are excluded, because existing `style/mixed-tone` handles them.
- Only emit when a section contains at least two majority paragraphs and at least one minority paragraph. On ties emit nothing. Emit one diagnostic at the first matching ending in each minority paragraph. Multiple headings/sections are evaluated separately.
- Detect only explicit bounded Japanese sentence endings before a full stop/question/exclamation or line end; do not claim grammatical validity or subject/persona interpretation.
- Diagnostics are informational suggestions, with no replacement and no safe fix.
- Presets: general/technical=`info`, strict=`warning`, minimal=disabled. Allow user to disable/adjust like every built-in rule.

## Test contract
1. Positive: two polite paragraphs + one plain paragraph and inverse, exact UTF-16 offsets with preceding emoji.
2. Negative: same style, 1:1 tie, only one paragraph, mixed-style paragraph (already diagnosed elsewhere).
3. Privacy/formatting: ignored Markdown code, URL, quote lines, bullet lists, table rows, and quoted speech. Heading boundaries do not leak tone evidence.
4. Registry, idle-tier wiring, preset settings, and no automatic format fix.
5. Existing `style/mixed-tone` behavior remains unchanged.

## Trade-offs
The conservative lexicon may miss inflected/colloquial phrases and text without explicit sentence-final cues. That is preferred to aggressive false positives in business inquiries and technical docs. No morphological analyzer or remote dictionary is introduced.
