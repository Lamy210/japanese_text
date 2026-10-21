# Phase 3E — Resolved Markdown references in evidence lint

**Base:** `main` at `bfff6816c0060f92631ffd4c1f8c8068c1eced4e`.

## Confirmed defect

The evidence linter's `[text][id]` matcher accepted the *presence* of a
reference-style link without checking whether `id` had a Markdown reference
definition. Hence a factual statement followed by `[資料][missing]` could
lose the missing-citation warning while the separate `reference/undefined`
rule reported a broken link.

This also applied to `[text][]` collapsed references, empty destinations and
malformed destination syntax.

## Decision and boundary

Reuse the reference rule's existing indexed definition analysis rather than
create a second definition parser.

- A reference-style citation qualifies only if the target ID exists and its
  first definition has a nonempty, structurally valid URL destination.
- `[label][]` uses `label` as the target, exactly as the current
  `reference/undefined` implementation does.
- Definition lookup is document-wide, independent of the scope that determines
  whether the **usage** is near a claim.
- Ignore definitions in code using existing reference-parser masking.
- Genuine inline links, autolinks and bare URLs are not subject to ID lookup.
- Never fetch remote URLs or claim that a valid syntax proves a factual claim.
- Keep UTF-16 offsets, diagnostic IDs, presets and API unchanged.

## Alternatives

1. **Adopted:** small exported validity query using the existing reference
   linter's cached map and URL structural validator.
2. Duplicate reference-definition parsing in evidence rules: less coupling,
   but error-prone and potentially inconsistent with `reference/undefined`.
3. Full Markdown AST migration: broader standards support but higher risk
   and unnecessary for this defect.

The current reference lint uses exact, trimmed labels; case folding and
more-complete CommonMark parsing are separate future compatibility work.
This PR intentionally preserves those semantics rather than cause conflicting
rule decisions.

## Evidence / regression

- RED first: 11 new failing tests demonstrated unsupported references hiding
  warnings in numeric, comparison and external-fact claims.
- GREEN: all new tests and existing full suite must pass on final PR SHA.
- Positive: full and collapsed references, forward definitions, ordinary
  Markdown links, bare URLs.
- Negative: undefined reference, empty/malformed destination, definition only
  in a fenced code block, no real citation.
- Unicode: emoji ahead of an unreferenced claim preserves exact UTF-16 offsets.

## Remaining work

- References inside HTML comments/frontmatter, case-insensitive Markdown
  reference label normalization, inline destination validity, and verifying
  the citation actually supports the claim require separate research/tests.
- No source retrieval or external document upload is introduced.
