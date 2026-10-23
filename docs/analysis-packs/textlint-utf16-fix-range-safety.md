# textlint adapter: validate UTF-16 diagnostic and fix ranges

## Investigation / confirmed issues

The builtin-rule path validates all coordinates at
`normalizeDiagnostics()` (PR #82), but `runTextlint()` previously used
`Math.max(0, Math.min(offset, text.length))`. NaN survives Math.min/Math.max,
while out-of-bounds and reversed spans could silently be clamped. This
creates invalid diagnostic coordinates in the editor.

Textlint reports `message.range` and `fix.range` separately. The former
describes the diagnostic issue; the latter describes the exact replacement
target. The previous adapter used the report span with `fix.text` even when
`fix.range` differed, which can replace the wrong portion of a document.

## Selected mitigation

- `src/core/engine/textlint-span.ts`: strict, reusable and pure UTF-16
  geometry boundary. Require finite safe integers, 0 <= start <= end <=
  document length, two elements per range.
- An invalid reporting range is rejected, with a per-rule `ruleErrors` entry.
  No fabricated `0` range or clamped NaN.
- When a reporting range is valid but a FixCommand range is malformed, retain
  a non-actionable diagnostic with `fixKind:'none'` and report the invalid
  suggestion via `ruleErrors`. This avoids silently presenting a broken fix.
- When both are valid, Suggestion points to the exact `fix.range`. An
  insertion (zero-length range) and a deletion (empty replacement) remain
  valid. All textlint fixes remain suggestion-only, never formatter Safe Fix.
- Legacy fallback `message.index` is accepted only when it is a safe integer
  in the document. The resulting span is one UTF-16 code unit at most.

## Alternatives

1. Merely clamp or coerce third-party offsets: rejected because NaN and
   invalid FixCommands would still be ambiguous and might mutate unrelated
   text.
2. Discard every diagnostic carrying an invalid FixCommand: safer for edits,
   but hides an otherwise useful textlint finding.
3. **Chosen:** fail closed on invalid report ranges; downgrade invalid
   fix-only messages while retaining visible diagnostics and rule errors.

## Regression coverage

- Pure geometry tests for NaN, Infinity, fractional, negative, reversed,
  oversize, malformed/missing ranges; emoji/surrogate UTF-16 coordinates,
  insertion and deletion.
- Adapter-level test injects malformed third-party kernel messages and
  confirms one invalid report is discarded, one valid different FixCommand
  range is preserved, and one invalid fix cannot be applied.
- Existing textlint integration tests continue to cover the real kernel,
  plugins and rule modules. No new dependencies or workflows.

## Compatibility / privacy / follow-up

No change to Rule IDs, source, Worker protocol, config, Profile, IndexedDB,
user dictionaries, or text upload. Normal textlint results with matching
report/fix ranges retain their behavior.

A browser-based Quick Fix integration test with the actual CodeMirror editor
is the next recommended validation step; this change does not claim a browser
E2E result. This is a local correctness boundary, not a remote trust system.
