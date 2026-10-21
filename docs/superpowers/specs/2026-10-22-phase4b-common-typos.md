# Phase 4B — Curated Japanese Typo Diagnostics

## Goal and non-goals

Extend the browser-only Japanese Writing Toolkit with deterministic typo
suggestions that work fully offline and without any LLM, remote dictionary,
text upload or server-side analysis.

Scope is **only four manually reviewed, explicit spelling pairs** in v1:

| Suspicious spelling | Suggested spelling |
| --- | --- |
| シュミレーション | シミュレーション |
| コミニュケーション | コミュニケーション |
| デバック | デバッグ |
| うる覚え | うろ覚え |

These are writing *suggestions*, not proof of linguistic correctness. Named
entities, quotes and deliberate terminology may legitimately use different
spellings. There is no semantic or morphology inference.

## Behavior

- Rule ID `wording/common-typo`; fast tier, default `info`.
- Show a candidate `replacement` with `fixKind: suggestion`, never
  `safe`; Format Document must preserve the original unchanged.
- A matching Katakana typo embedded in a longer Katakana word or brand-like
  spelling (e.g. `スーパーシュミレーション`) is ignored.
- Compound Japanese prose can still be checked (`コミニュケーション能力`).
- Existing masking excludes code, HTML comments, YAML frontmatter and URLs.
- Deliberate Japanese-quoted strings (「」/『』, including line breaks) and
  Markdown blockquotes are excluded.
- Headings and normal Markdown list item text remain in scope: they are
  author-written content.
- UTF-16 offsets remain intact even after emoji/surrogate pairs.

## Configuration

General: `info`. Technical, Strict, Minimal: `warning`. The rule may
be disabled or changed in RuleProfile settings. Custom organization-specific
spelling should continue to use the existing terminology/NG-word features,
rather than bloating the built-in dictionary.

## Safeguards

- Curated dictionary only: do not silently add large scraped spell-check data.
- Add each new pair with positive and negative examples, including
  surrounding Katakana and quotations.
- Real-world precision/recall should be measured separately from synthetic
  regression tests and must not be represented as 100% simply because CI passes.
- Preserve the independent user override: suggestions are not applied
  automatically.
- No new dependencies, network operations, config migration or stored data.

## Validation and future work

TDD with negative examples, Unicode positions, masking and RuleProvider
integration. Check TypeScript, Vitest, production build, Pages build and
Worker paths on the final commit. Future expansions may consider
opt-in domain dictionaries, per-rule exclusions and a documented
provenance/licensing workflow for third-party lexical resources.
