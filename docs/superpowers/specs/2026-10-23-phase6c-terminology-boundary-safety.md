# Phase 6C — Conservative Safe Fix boundaries for terminology

## Background

`wording/terminology` is user-configurable and currently offers
`fixKind: safe`. Applying a rejected spelling to any matching substring is
unsafe when the spelling is part of a longer ASCII identifier or Katakana
proper name. Examples include `GithubEnterprise`, `NodeJSRuntime`,
`ユーザビリティ`, and `サーバレス`.

## Rule

- If a matched ASCII token begins or ends next to ASCII letters, digits or
  underscores, skip that match.
- If a matched Katakana token begins or ends next to Katakana, long vowel mark,
  ASCII letters, digits or underscores, skip that match.
- Kanji and Hiragana immediately adjacent to a complete term do not suppress
  the match (e.g. `ユーザ一覧`, `サーバの設定`).
- Keep the established guard against detecting the rejected spelling as an
  internal prefix of the preferred spelling.
- Keep existing `wording/terminology` source, severity, messages, and
  `Safe Fix` behavior for complete tokens. No new dictionary, dependency,
  profile migration or remote processing is added.

## Intentional trade-off

Some compound Katakana phrases with a genuinely undesired spelling will no
longer be automatically repaired. This false-negative trade-off is preferred
to a destructive, silent Safe Fix inside a brand, identifier or valid word.
Users may add the full compound as an explicit rejected term when necessary.

## Validation

`tests/rules/terminology-safe-boundaries.test.ts` covers protected longer
names, complete-token fixes, mixed Japanese sentences, and UTF-16 offsets
after an emoji. Existing provider, formatter and user-terminology tests must
also continue to pass.
