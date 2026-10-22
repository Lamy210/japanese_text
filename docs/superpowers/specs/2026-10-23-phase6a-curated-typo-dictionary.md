# Phase 6A — Versioned curated typo dictionary (compatibility-first)

## Scope

Extract the eight existing reviewed Japanese typo pairs from
`src/core/rules/fast/common-typo.ts` into the single read-only module
`src/core/dictionary/curated-typos.ts`.

This is a **structural change**, not a bulk dictionary expansion. No external
corpus, network call, generated model, new dependency, IndexedDB schema change,
config migration, or new rule is introduced.

## Contract

- `CURATED_TYPO_DICTIONARY_VERSION = 1` identifies this curated data snapshot,
  **not** `AppConfig.schemaVersion` or the IndexedDB version.
- `listCuratedTypos()` returns an immutable array in the original order.
- `findCuratedTypo(spelling)` performs an **exact**, case-sensitive lookup.
- `wording/common-typo` keeps its ID, `source: core`, `fast` tier, messages,
  offsets (UTF-16), and `fixKind: suggestion`.
- The allow-spelling action looks up the same source of truth and continues to
  register a preferred-only term in the existing `terminology` settings.
- User-managed `preferred` **and** `rejected` entries still override the
  built-in typo suggestion.
- Code/URL/frontmatter masking, quoted samples, blockquotes, and surrounding
  Katakana or ASCII product-name boundaries retain existing behavior.
- The formatter never auto-applies a curated typo suggestion.

## Addition / review process

1. Record the proposed `wrong → preferred` mapping, with a trustworthy source
   or explicit maintainer review. Do not infer correctness from mere unknown-word
   status, frequency, or an unreviewed third-party corpus.
2. Identify real words, proper nouns, quotations and domain-specific accepted
   spellings that might contain the proposed `wrong` sequence.
3. Add positive, negative, compound-word, quote/mask and Unicode-offset cases
   to `tests/corpus/common-typo-v1.json`, or version a new corpus intentionally.
4. Extend the direct dictionary contract test and update dictionary version in a
   deliberate, reviewed release change. Keep existing pairs stable.
5. Run typecheck, Vitest, regular and GitHub Pages production builds.
6. Before incorporating any external dictionary, verify data provenance,
   licensing, redistribution rights and third-party attribution requirements.

## Deferred Phase 6B+

- Dictionary-pack manifest (checksums, provenance and licensing).
- Optional technical/business term packs and controlled extension APIs.
- Dedicated precedence engine and RuleProfile changes.
- Morphological analyzers, asynchronous loading, contextual error correction,
  and ranking of multiple suggestions.

These are intentionally **not** part of Phase 6A. A packaging-only extraction
must not silently expand the scope of diagnostic behavior or persistence.
