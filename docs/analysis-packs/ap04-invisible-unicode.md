# AP-04 — Invisible Unicode separator lint (Phase 1)

## Context and priority

After AP-03c Dictionary Pack wiring, the existing Fast Engine can accept narrowly scoped new builtin rules without an NLP provider. A prose copy/paste may contain visually undetectable separators and BOM remnants. These can introduce surprising formatting or matching behavior.

## Decision

- Add `typography/invisible-separator` as a synchronous, builtin Fast-tier rule in the mandatory `core` Pack.
- Detect **U+200B ZERO WIDTH SPACE**, **U+2060 WORD JOINER**, and **U+FEFF when not at offset 0**. Preserve the first U+FEFF as a possible input file BOM.
- Operate on the already-masked `RuleContext.maskedText`; never flag fenced/inline code, URL destinations, bare URLs, metadata, or HTML comments.
- Emit original UTF-16 ranges (`[start,end)`), one code unit per matched separator, and an explicit codepoint in the diagnostic message.
- Always set `fixKind: suggestion` and `replacement: ''` (manual deletion). These characters can intentionally affect line breaks, so a `safe` automatic fix would be unjustified.
- Do not flag U+200C, U+200D, U+FE0F or bidirectional controls. These have distinct writing-system, emoji, security or rendering considerations and require independent rules and false-positive evaluation.

## Configuration and compatibility

- General preset enables the rule at **Info**; Technical and Strict enable it at **Warning**; Minimal omits it to preserve its narrow default scope.
- The existing v2 config validator accepts the new rule through the provider registry; individual `RuleSetting.enabled` can disable it.
- Existing Rule IDs, storage schemas, Worker protocol, textlint adapter, Formatter's 3-tier Baseline/Shadow safety gate and CI files are unchanged.
- Intentional behavior change: old non-minimal Profile imports that inherit the newly defined General preset may now receive an additional **non-auto-applied** diagnostic when suspicious invisible characters appear.

## Alternatives considered

1. Bring in a full textlint package immediately: rejected for this small deterministic rule; avoid bundle and browser-compatibility risk.
2. Auto-delete every format/control character: rejected; breaks emoji shaping and multilingual typography.
3. **Selected:** three precisely scoped characters, masked input, review-only suggestion, no new dependency.

## Regression gates

- Single/duplicate occurrences with codepoint-specific messages and correct UTF-16 offsets after emoji and across lines.
- First-character BOM ignored; emoji ZWJ, ZWNJ and variation selector ignored.
- Mixed Markdown content: prose highlighted, code/URL/comment/frontmatter/reference definition suppressed.
- Safe Formatter never applies this rule's empty-string suggestion automatically.
- Rule enabled/disabled state and General/Technical/Strict/Minimal preset expectations.
- Static rule-provider manifest count and ordering kept consistent.

## Deferred

- Rule-family conflict and Gold Corpus precision/false-positive evaluation for non-Japanese languages.
- More Unicode security cases including bidi controls and isolated joiner misuses, each subject to a separate risk/false-positive review.
- Grammar / Style / Technical ownership migration: legacy flags presently default OFF but their older rules remain Core-owned, so changing ownership in the same PR would disable existing diagnostics unexpectedly.

Required pre-merge checks: TypeScript, all Vitest tests, deterministic dictionary integrity, analysis smoke, production/Pages builds. Existing workflows only.