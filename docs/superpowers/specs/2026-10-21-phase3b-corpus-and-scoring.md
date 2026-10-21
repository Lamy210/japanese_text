# Phase 3B — Japanese Writing Evaluation Corpus (v1)

## Scope and limitations

This is a **small, human-curated synthetic regression corpus**, not a statistically
representative sample of Japanese writing or a certified grammar benchmark.
It presently evaluates only:

- `wording/repeated-phrase`: bounded comma-separated immediate phrase repetition
- `style/consecutive-conjunction`: consecutive, identical sentence-initial conjunctions

It must **not** be used to claim overall Japanese proofreading accuracy, naturalness
or discourse correctness. The corpus does not measure typo/omission recovery,
reading difficulty, morphology, logical validity or the quality of rewriting.

## Files

- `tests/corpus/japanese-writing-v1.json`: versioned, human-curated examples
- `tests/corpus/scorer.ts`: exact rule ID + UTF-16 half-open span TP / FP / FN
- `tests/corpus/japanese-writing-corpus.test.ts`: schema guard, gold alignment,
  per-example golden tests and aggregation regression tests

Each expected annotation identifies the **surface spelling and its 1-based
occurrence in the unmodified source text**. Tests independently recover
`[start, end)` from the source, not the implementation's masked representation.
This catches missing, duplicated and mispositioned warnings.

The dataset deliberately includes both positive and negative examples, masked
Markdown, quotations, soft/hard line boundaries, emoji, and multi-occurrence
repetitions. Incorrect expected labels are not corrected by blindly updating
snapshots: changes require evidence, a documented rule decision and review.

## Evaluation

Run:

`bun run test -- tests/corpus/japanese-writing-corpus.test.ts`

Also run the repository's full gate:

`bun run lint`, `bun run test`, `bun run build`, `bun run build:pages`.

The scorer treats predictions as a **multiset**, so duplicate diagnostics are
counted as false positives. A match must have the same rule ID and exact UTF-16
offsets. Recall = TP/(TP+FN), precision = TP/(TP+FP). When a denominator is zero,
the metric is **undefined** (`null`), not artificially 100%.

CI requires zero FP/FN for this deliberately controlled v1 regression suite.
This is a **test invariant**, not a production SLO or a realistic field estimate.
For a future independent benchmark, sample representative documents, annotate
blindly by multiple reviewers, record disagreements, report confidence intervals,
and keep a holdout set separate from development fixtures.

## Defect reproduced by this corpus

The initial RED test proved `A、A、A` reported only one duplicate because
nonoverlapping global regex matches skip the shared second `A`. The implementation
now resumes matching from the second phrase, reporting the second **and** third
occurrences. Both whitespace-separated and plain versions are covered.

## Extension plan

- Add rule-specific positive/negative fixtures for redundancy, honorifics,
  terminology and typo candidates in separate reviewed batches.
- Add language-specific adversarial cases: quotations, user-defined terminology,
  technical documentation, intentional repetition, dialectal expressions.
- Keep benchmark data and performance baselines independent from rule code and
  preserve source/provenance and redistribution rights for future external text.
