# Builtin rule diagnostics: UTF-16 scalar boundary validation

## Confirmed gap

The own-rule engine's `normalizeDiagnostics()` (PR #82) rejects NaN,
fractions, reversed spans and offsets outside the document. It does not
distinguish a valid UTF-16 scalar boundary from the index **between** the
high and low surrogate of an emoji such as 📚.

Rule exceptions are already isolated as `ruleErrors`; accepting a
malformed builtin RawDiagnostic risks presenting an unsafe Quick Fix or
Formatter candidate. PR #87 applied scalar-boundary checks to textlint
reports and FixCommands. This follow-up applies the same rule to builtin
RawDiagnostic normalization.

## Selected small change

- `LineIndex` keeps a reference to the source string passed at
  construction and exposes `isCodePointBoundary(offset)`.
- `normalizeDiagnostics()` requires both start and end at scalar
  boundaries in addition to the existing safe-integer/range checks.
- Invalid native-rule diagnostics throw in normalizing, which the
  existing `runOwnRules` per-rule catch converts to a visible rule error.
- No new heap copy of the full source document or scanning of every
  character per diagnostic. Checking each boundary reads at most two
  UTF-16 code units.
- An intentionally unpaired surrogate already present in source does
  not make neighboring indices invalid: the validator rejects the
  interior of **well-formed high+low pairs only**.

## Alternatives

1. Leave builtin rules as-is and guard only editor transactions: late
   defense is useful but the invalid range would still reach diagnostics,
   highlighting and downstream consumers.
2. Round invalid positions to a neighboring scalar boundary: rejected
   because this guesses the rule author's intended selection and may
   target unintended text.
3. **Chosen:** reject at the raw→normalized diagnostic boundary. Safe
   Formatter continues using its existing baseline/shadow contract.

## Meaningful regression coverage

`tests/analysis/builtin-surrogate-boundary.test.ts` directly exercises
`normalizeDiagnostics` with offset 2 in `A📚B`, which is in range but
splits a surrogate pair. The old normalizer would accept it; the new one
rejects. It also verifies accepted whole-emoji ranges, text end,
out-of-bounds and NaN errors, and isolated source surrogates.

No schema, RuleProfile, runtime pack gate, Worker message, IndexedDB,
dependency, new CI workflow or network change.

## Remaining risk

Some future Rule implementations may emit spans targeting individual
UTF-16 code units within a surrogate pair. These now fail closed as a
per-rule error rather than being presented as valid user edits, which
is intended. Grapheme clusters (ZWJ sequences and combining marks)
are not equated with Unicode scalar values here; those need a distinct
product and multilingual-precision review.
