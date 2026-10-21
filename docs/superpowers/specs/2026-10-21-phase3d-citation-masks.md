# Citation Evidence Mask-Awareness (Phase 3D)

**Base:** `main` at `881e477a3d29677be89414fa6cc0ec6c96ada409`.

## Confirmed defect

The citation/evidence linter searches the entire original Markdown source for
links, while the content checker scans offset-preserving masked text.
Consequently, a URL or Markdown link in an inline/fenced code sample,
HTML comment, or YAML frontmatter could satisfy a prose claim's citation
requirement despite not being an actual citation in that prose.

The defect applies to all three citation heuristics (numeric facts,
comparisons, and external facts).

## Decision

Use the **existing mask regions** rather than add an AST parser or new
dependency. Accept a citation candidate only when it does not overlap
a `code` or `metadata` region. Do **not** disqualify `url` regions:
legitimate link targets, autolinks and bare URLs are intentionally masked
by `maskDocument` so the content scanner will not lint the URL itself.

This change does not infer whether an external URL truly supports the claim;
it only prevents a proven false-negative path caused by non-prose URLs.

## Test contract

- RED first: real links hidden in code/comments/frontmatter must not silence
  a missing-source warning.
- GREEN after change: inline Markdown links, autolinks and bare URLs in prose
  still satisfy the rule.
- Numeric claim, comparison claim, external-fact claim all covered.
- Emoji ahead of the claim still yields exact UTF-16 offsets.
- No new packages, requests, configuration, schema, API or storage changes.

## Review / alternatives

- **Chosen:** mask-kind filtering. Smallest change using an existing core
  abstraction, tested against both false negatives and false positives.
- **Not chosen:** full Markdown AST parsing. Better grammar support but higher
  scope, performance, and compatibility risk for this isolated defect.
- **Not chosen:** scan the already-masked string for links. This rejects actual
  links because the target URL itself is intentionally masked.

## Remaining limitations

Reference links are still treated heuristically: determining whether a
reference ID is actually defined and whether the linked source supports
a claim is a distinct follow-up. Likewise, style-guide validation does
not imply the correctness of a cited statement. Both should be
independently researched and tested before product claims.
