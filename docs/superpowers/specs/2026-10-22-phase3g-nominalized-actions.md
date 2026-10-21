# Phase 3G — Nominalized-action clarity hints

## Context

Extend Japanese Writing Toolkit's browser-only, no-LLM writing guidance
without turning stylistic choices into automatic grammar changes.

Current `wording/redundancy` already covers selected fixed expressions
like `することができます`. This change is deliberately a distinct
`wording/nominalized-action` fast-tier rule for nominal-action combinations.

## Supported wording

Detect only a bounded list of nominal verbs:
`確認`, `検討`, `調査`, `検証`, `分析`, `評価`,
`測定`, `点検` followed by `を` and one of:

- `実施する`, `実施します`, `実施した`, `実施しました`
- `行う`, `行います`, `行った`, `行いました`

Check that the verb form is not just the prefix of a longer kana ending
(e.g. `実施したい`), and ignore quoted examples and already masked
Markdown code/URLs/metadata. Preserve UTF-16 offsets.

## Output policy

- `info` severity in General, Technical and Strict profiles.
- Minimal profile stays disabled.
- Emit a clear suggestion to review concision, but **no automatic replacement**
  and no Safe Fix. `情報の確認を実施しました` cannot be mechanically
  transformed to `情報の確認しました` (ungrammatical).
- Treat a phrase as potentially intentional in legal, process, or audit records.
- Do not trigger on a longer `することができます` construction already
  diagnosed by `wording/redundancy`.

## Non-goals and review

The rule does not infer subject/object structure, choice of honorific, causal
relations, or semantic validity. It is an optional writing *hint* rather than
a claim that the sentence is incorrect. This initial lexicon is intentionally
small and further expansion requires positive/negative examples.

No network calls, new dependencies, LLM, migration, or changes to document
storage/private-session boundaries.

## Verification

- Exact UTF-16 spans after emoji
- 8 representative affirmative forms and counter-examples
- Code/URLs/HTML comments/quotation exclusions
- Existing redundancy overlap and no unsafe replacement
- RuleProvider inventory, profile severities and fast engine
- Full TypeScript/Vitest/production/Pages CI checks

Future work: larger externally annotated Japanese writing corpus and measured
false-positive rates (distinct from synthetic unit-test pass rates).
