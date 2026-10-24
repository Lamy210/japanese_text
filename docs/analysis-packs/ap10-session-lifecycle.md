# AP-10 part 1 — NLP request lifecycle and snapshot identity

> Design-only integration boundary: no NLP Worker starts, no dictionaries download, and no diagnostics are emitted in this PR.

## Current baseline

AP-09 (#89–#91) now provides `Utf8OffsetMap`, `ProseRegion`, atomic byte token validation and feature-complete `MorphToken` validation. Before wiring an external tokenizer, Worker results must be tied to the **exact active** document, Profile, Provider, dictionary and Worker generation. Existing Fast / Deep / Idle and Formatter Shadow use a separate request protocol and are not changed.

## Chosen contract

Implement the pure, generic `NlpSessionCoordinator<T>` in `src/core/nlp/session-coordinator.ts`.

- `NlpSnapshotIdentity`: nonnegative document Revision, workspace/document/Profile IDs, Markdown/text type, selected Provider, 64-character lowercase SHA-256 of the **dictionary asset** (never hash of user text), caller-supplied opaque per-content nonce, UTF-16 document length.
- `begin(snapshot)` validates the identity and checks a caller-provided live-context callback; stale requests are rejected without disturbing current work. Accepted starts allocate a monotonic request ID and current Worker epoch. Starting a second run yields the prior run's explicit `skipped/superseded` terminal outcome.
- `deliver(reply)` demands the echoed request ID, Worker epoch and **entire** snapshot identity match the active run. It then re-evaluates live context. Changed document, Profile, Provider, dictionary, nonce or length produces an explicit `skipped/snapshot-stale` outcome, not empty results. Provider errors produce explicit `failed/provider-error`.
- `cancel(identity)` and `timeout(identity)` are one-shot transitions. A real timer/AbortSignal lives in the future runtime, **not** in this pure module. There is no implied timeout or automatic cancellation.
- `restartWorker()` increments a monotonic epoch; any previous request is skipped as `worker-restarted`, and delayed old-epoch replies are ignored. A complete reply is consumable only once. Identity copies are frozen.
- A completed payload of type `T` is **not evidence of valid morphology** until the AP-09 validators have accepted all regions and tokens. The caller must never convert a provider exception into a successful empty array.

## Why not integrate immediately?

1. The current `src/worker/protocol.ts` is the established 3-tier lint and negative-revision Formatter Shadow contract. Reusing it for NLP without independent error/timeout semantics risks hanging or altering core formatting. Keep this module separate until AP-10 part 2.
2. A generic Worker creation here would require dictionary/asset load and consent lifecycle that do not exist yet. Pretending a provider is installed would be misleading.
3. A pure state machine can be tested deterministically without sleeps, browser globals, network, actual user content or background work.

## Limitations / follow-up

- Worker transport, cold/warm initialization, watchdog scheduling, verified dictionary loading, runtime diagnostic aggregation, Profile/Workspace hydration and actual cancellation **are not implemented**.
- `isCurrent` is an interface guarantee: the runtime must update its current snapshot when settings, text, document identity, Provider or dictionary fingerprint changes, even if an ordinary lint Revision is unchanged.
- A SHA-256 of user text must **not** be substituted for the `contentNonce`: short/private content could be guessed. Generate random or opaque counters at the caller, scoped to the UI runtime.
- Source region and token diagnostics still require AP-09 validation; the coordinator deliberately knows nothing about their bytes or UTF-16 offsets.
- This class supports one concurrent active NLP run per instance. If multi-document/background requests are required, use one instance per document context and define a resource budget first.

## Verifiable gates

New `tests/analysis/ap10-session-coordinator.test.ts` exercises duplicate terminal suppression, supersession, Profile/doc/Provider/dictionary/nonce/Revision changes, mismatched response echoes, explicit error/timeout/cancel, epoch replacement, source copy freezing, malformed identity and throwing freshness predicates.

Merge requires existing GitHub CI: typecheck, all Vitest, dictionary reproducibility, benchmark smoke, production build, Pages build and asset path checks. No new CI workflow/dependencies/storage change.