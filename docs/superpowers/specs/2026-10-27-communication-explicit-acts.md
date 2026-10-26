# Communication Analysis P1-A — 明示的な質問・確認依頼の分類

> Status: rules-only experimental core module. Existing Lint/UI, Formatter, Worker and storage remain unchanged. No NLP/LLM model or network access.
> Parent: Thought Graph IR P0-A, merged PR #100.

## Why

Conventional question-mark or polite-ending detection confuses:
- 「資料をご確認いただけますか？」 — grammatical Yes/No question that asks for an actual checking task.
- 「この仕様で問題ありませんか？」 — Yes/No confirmation question; answer may be complete depending on context.

Do not equate the first with a completed Yes/No response. The classifier separates `surfaceForm`, `intent`, `expectedAnswer`, and `answerCompletesRequest`.

## Scope

`detectExplicitCommunicationActs(source, documentType)` uses the existing `extractProseRegions()` and `splitSentences()`. It recognizes only explicit suffixes for confirmation/approval/action requests, and explicit interrogatives for choice/date/number/explanation/binary responses.

- Returns frozen, original UTF-16 source-anchored evidence spans and labeled acts; no passage is rewritten.
- `answerCompletesRequest: false` for action requests, `'unknown'` for information and confirmation questions; `true` is intentionally never inferred from a question ending.
- Markdown headings, link labels, blockquotes, code and tables are skipped by conservative region extraction or dedicated guards. Reported quoted examples are not attributed to the author.
- Input length max 200,000 UTF-16 units, results max 512; oversized inputs are `skipped` rather than returning partial misleading findings.
- Uses no dependency additions or network calls.

## Alternatives

| Approach | Pros | Cons | Decision |
|---|---|---|---|
| Match question marks only | Tiny code | Misclassifies 「ご確認いただけますか？」 | Reject |
| Unconditionally run a Japanese generative model | Better flexibility | Large download, latency, unsupported browser/device, invented intent | Defer |
| Rule baseline + future NLP adapters | Deterministic, low cost, testable | Recall is limited | Adopt |

## Coverage, known limits and human review

This is an **explicit form detector**, not a semantic role labeler or complete Japanese dialog act classifier.

- Does not infer actors, reasons, deadline scopes, implied intents, negation logic, or relationship between separate questions.
- "確認できますか？" may represent ability or a request; the high-precision rules avoid forcing it into a checking-task category.
- Some legitimate forms such as "ご確認いただければ幸いです" are intentionally left unclassified rather than guessed.
- Embedded quotations/markdown prose broken by formatting are skipped rather than joined across uncertain boundaries.
- No numeric confidence is fabricated; future calibrated providers may add scored alternatives.
- Does not claim that the user can answer every binary question with Yes/No alone.

## Test contract

Tests cover: request-vs-binary distinction, choice/date/numeric/explanation labels, source offsets with emoji and Markdown list markers, non-prose exclusion, reported speech negatives, unknown input and size limits, stable ordering/immutability.

This module is not registered in the existing CoreRule provider. Before making it user-visible, add a document-profile policy, suppress collisions with existing honorific-request rules, build a gold set of Japanese business text with negative examples, and project only verified findings to the Diagnostic UI. An unanswered semantic question must remain `unknown`, not "no problem".

## Follow-up

- P1-B: `EventFrame` actor/action/object/reason/purpose/deadline candidate slots and profile-driven lint projection.
- P2-A: Thought Graph reducer, session transitions and no-model brainstorming strategies.
- When a reliable Lindera/WASM provider is available, compare measured precision/recall against this deterministic baseline, without breaking fallback.
