# Phase 3F — Non-prose boundaries in Markdown reference analysis

**Base:** `main` at `ea4862faf64529a006e486538ab87158b3598975`.

## Problem

The existing reference analyzer skips fenced and inline code but does not
consistently exclude YAML frontmatter and HTML comments when building:

- reference definitions (`[id]: url`)
- reference usages (`[label][id]`)
- heading slugs for in-document anchors.

This can suppress reference/undefined, reference/unused, broken-anchor
warnings, and the evidence/citation warnings that share the definition lookup.

## Design decision

Do not change the public rule registry, editor, storage, or tokenizer.

- Use existing `ctx.maskRegions` for code/metadata boundaries.
- Permit a `metadata` mask **only when it exactly covers a valid reference
  definition line**; definition lines are intentionally masked by
  `maskDocument`.
- Reject definitions, uses and headings inside other metadata regions.
- Independently identify complete HTML comment spans in the original source.
  This matters because the mask builder marks reference-definition lines as
  metadata *before* processing multiline HTML comments: the overlapping
  comment mask may not be added.
- Keep `url` masks allowed as they represent actual link destinations.
- Preserve UTF-16 offsets, existing reference-ID matching, and normal
  Markdown definitions.
- No new network I/O, dependencies, LLM, browser permissions or schema change.

## Validation

Tests cover:
- False definitions in frontmatter and multiline HTML comments.
- Duplicate IDs when one definition is hidden.
- Reference use only within HTML comments or frontmatter.
- Hidden headings incorrectly satisfying a document anchor.
- Ordinary references, real usages and visible headings remaining valid.
- Fenced/inline code isolation.

The tests are intended to fail on the old implementation before a minimal
repair, and pass after. Final approval requires TypeScript check, all Vitest
tests, production build and GitHub Pages build including Worker paths.

## Alternative approaches / limitations

- Full Markdown AST: more complete structural parsing but a substantially
  larger change, different dependency and more regression risk.
- Different masking order: could alter the whole project's diagnostics,
  so keep the change scoped to reference analysis.
- HTML comment recognition currently addresses closed comment spans.
  Parsing malformed/unclosed comments and CommonMark reference normalization
  can be handled in a separate reviewed task.

The linter cannot verify whether a referenced external page factually supports
a claim, and must not represent valid URL syntax as evidence of truth.
