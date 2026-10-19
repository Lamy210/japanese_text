# Phase 2D-A — Low-false-positive double-honorific detection

Status: scoped implementation. Base: main `50aac114a917b4a7e9d5c59be0d0de90fa60ff66`.

## Motivation and evidence
The existing `style/mixed-tone` detects sentence-ending style and `wording/redundancy` offers generic style suggestions, but neither diagnoses specific double honorifics. The Agency for Cultural Affairs' honorific guidance explicitly distinguishes inappropriate repeated honorific markers from established, acceptable expressions. In particular, `お読みになられる` is cited as double honorific, while `お召し上がりになる`, `お伺いする` and `お読みになっていらっしゃる` must **not** be treated as errors.
Reference: https://www.bunka.go.jp/seisaku/kokugo_nihongo/kokugo_shisaku/keigo/chapter4/detail.html

## Scope
- New native fast-tier `wording/double-honorific` rule, no LLM, dictionary download, tokenizer, network or storage changes.
- First dictionary intentionally only covers clear, bounded expressions: `お読みになられる`, `ご覧になられる`, `おっしゃられる` with present/polite/past polite inflections. No generalized honorific grammar claims.
- Report precise UTF-16 ranges on original text; read `ctx.maskedText` so code/URLs/metadata are excluded.
- Severity: `info` in general/technical, `warning` in strict, disabled in minimal. Rule is configurable like other native rules.
- Replacements are **suggestion only**, never `safe`, because honorific phrasing can be contextual.
- Existing config schema and privacy guarantees unchanged.

## Explicit examples
| Input | Suggested replacement |
|---|---|
| お読みになられる | お読みになる |
| お読みになられます | お読みになります |
| お読みになられました | お読みになりました |
| ご覧になられる | ご覧になる |
| ご覧になられます | ご覧になります |
| ご覧になられました | ご覧になりました |
| おっしゃられる | おっしゃる |
| おっしゃられます | おっしゃいます |
| おっしゃられました | おっしゃいました |

## Negative/exception tests
- No diagnosis for `お読みになる`, `ご覧になります`, `おっしゃいます`, `お召し上がりになる`, `お伺いいたす`, `お読みになっていらっしゃる`.
- Code fence/inline code/URL body are masked; explanatory prose outside those areas remains lintable.
- Repeated matches, emoji preceding a match, and longest-match precedence don't corrupt ranges.
- Built-in preset behavior and rule registry/tier wiring verified.
- Safe Format must not auto-apply suggested honorific replacements.

## Deferred
Morphology-dependent honorific misuse, subject-role inference, politeness level and tone agreement across an entire business message, custom phrase dictionaries, confidence scores, and reviewer feedback workflow. Those require separate rule designs and false-positive evaluation.
