# UTF-16 scalar boundary protection for textlint diagnostics

## Confirmed gap

PR #83 strictly validated textlint report/fix offsets as finite, ordered
UTF-16 integers within the text length. These checks are necessary but not
sufficient: editing at an offset **between the two code units of a surrogate
pair** leaves an unpaired surrogate and corrupts characters such as 📚.

For example, in `A📚B` (4 UTF-16 units), position 2 is in bounds
but cannot be used as a character boundary.

## Chosen fix

Add a small `isUtf16CodePointBoundary(text, offset)` utility to the existing
text-position module. The textlint span normalizer now receives source text
instead of only its length. Both ends of a report range must be scalar
boundaries, otherwise the report is rejected with the existing per-rule
error path. A malformed FixCommand with a valid report is downgraded to
`fixKind: 'none'` while preserving a readable diagnostic.

The constraint is only about **surrogate pairs**; a pair that was already
unpaired in the source must not cause an unrelated valid offset to be
uneditable. Combining marks and grapheme clusters are intentionally not
reinterpreted by this patch, since their editing semantics require a broader
rule-specific product decision.

Alternatives considered:

- Clamp to the neighboring UTF-16 index: rejected because guessing a boundary
  may silently expand or shrink the intended edit.
- Drop every diagnosis with any malformed fix: safe for edits but hides useful
  non-actionable feedback.
- **Selected:** reject invalid report positions, downgrade only invalid
  FixCommands, and accept a complete emoji span with its original UTF-16
  coordinates.

## Meaningful regressions

Pure span tests reject report/fix positions inside high+low surrogate pairs,
including zero-length insertion in the middle. They preserve valid complete
emoji spans, normal ASCII insertion and deletion.

The adapter-level regression injects malformed textlint messages through a
mocked kernel output, verifies the split report is rejected, the invalid fix
is non-actionable, and the valid whole-emoji replacement remains a suggestion.
The old implementation would expose the split fix as a valid suggestion.

## Compatibility / risk

No changes to diagnostic source/rule IDs, Workspace/Profile, IndexedDB,
Worker protocol, dependency list, CI workflows, or privacy/storage behavior.
The normalizer is a private-to-project TypeScript function; its argument
changes from `text.length` to the source `text` so it can validate boundaries
without copying the document.

A full browser E2E test of an actual CodeMirror click remains a follow-up.
This PR does not assume all Unicode grapheme clusters are single-codepoint.
