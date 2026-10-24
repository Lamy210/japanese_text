# AP-09 part 3 — Complete MorphToken contract validation

## Scope

The previous AP-09 PRs introduced the original-text `ProseRegion`, exact
UTF-8 byte/UTF-16 position map, atomic raw-byte span validation, and the
`MorphToken` interface. A future tokenizer adapter must validate its final
part-of-speech feature records too, not just the raw byte ranges.

`src/core/nlp/morph-token-validator.ts` adds
`validateMorphTokenSequence(source, region, candidates)` as a synchronous,
pure, **all-or-nothing** boundary. It has no runtime import from a provider,
Worker, UI, storage or third-party dictionary.

## Accepted token contract

- The supplied region's identity and exact `source.slice(start,end)` are
  verified before accepting a single token. Lone UTF-16 surrogates fail.
- Every token must reference the current region ID and a nonempty sentence ID.
- `pos` must be one of the declared normalized POS categories; unknown
  provider-specific POS classifications must be mapped to `other` by
  a reviewed adapter, never forwarded as arbitrary strings.
- Lemma, reading, conjugation type/form are `string | null`. Unknown-word
  status is `boolean | null`, never inferred from a missing property.
- `posDetails` and `originalFeatures` are arrays of strings only.
- Source offsets must be finite safe integers, nonempty and confined to the
  region; both boundaries must be valid Unicode scalar boundaries, and the
  exact source substring must equal `surface`.
- Tokens must be in ascending, nonoverlapping order. Gaps are permitted, but
  overlap and reverse order fail the whole batch.
- Accepted token records and nested feature arrays are copied and frozen,
  preventing a provider from mutating the validation result afterwards.
- Invalid input produces a differentiated invalid-region / invalid-token /
  overlap result, without a partially valid token list.

## Intentional limits

- This is a contract validator, **not** a tokenizer or a grammar rule.
- No automatic `fixKind: safe`, diagnostics or AI semantics are added.
- POS and conjugation mapping, sentence identity consistency and actual
  provider output compatibility are still AP-11/12 work.
- An empty token array is valid only for a valid source region. Provider
  failures must be transmitted as failures by the future Coordinator, never
  mislabeled as an empty successful tokenization.
- No network, OPFS/IndexedDB, privacy or Worker protocol changes.

## Regression coverage

`tests/analysis/ap09-morph-token-validator.test.ts` includes repeated
Japanese surface forms, emoji UTF-16 boundaries, original-source identity,
incorrect POS/features/nullable values, invalid scalar boundaries and
coordinates, overlaps/ordering, full-result rejection for a late invalid
token, lone surrogate input, and ownership/freeze of feature arrays.

No new CI workflows or dependencies.
