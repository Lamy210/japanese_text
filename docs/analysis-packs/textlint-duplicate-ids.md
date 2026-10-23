# textlint duplicate diagnostic IDs

## Root cause and rationale

The builtin rule normalization assigns `ruleId@start-end`, adding
`#1`, `#2` for repeated findings at the exact same UTF-16 range.
The textlint adapter lacked this disambiguation. A textlint rule can
report multiple distinct issues at the same position, making multiple
diagnostics appear with one ID. The panel's selectedDiagnosticId would
then select multiple rows and any ID-keyed UI could collide.

## Smallest compatible fix

- Keep the existing unmodified ID for the first occurrence.
- Within one `runTextlint()` call, count occurrences of each normalized
  `ruleId@start-end` and assign `#N` starting from 1.
- Use the same suffix convention as `normalizeDiagnostics()`.
- Count **after** rejecting invalid spans, so malformed results do not
  consume IDs of valid findings.
- Scope the map to each call to preserve deterministic results across runs.
- Do not change source, sort order, FixCommand, severity or user ignore keys
  (ignore keys are derived from ruleId and excerpt, not the diagnostic ID).

## Regression evidence

`tests/analysis/textlint-adapter-invalid-span.test.ts` now feeds a genuine
adapter call with three distinct findings at the same rule/range and one
at another position. It asserts unique IDs, unchanged order and repeatable
IDs across two independent runs. The test fails against the old adapter
because the duplicate IDs would all lack a suffix.

No config, Worker, DB, dependency, asset or CI changes.
