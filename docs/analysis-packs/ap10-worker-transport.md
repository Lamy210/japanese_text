# AP-10 part 2 — Independent NLP Worker transport (fail-closed)

> Scope: an opt-in callable Worker transport and atomic source-token validation. No tokenizer installed, no UI integration, no automatic NLP request on app launch.

## Baseline and decision

AP-09 validated the original Unicode byte/UTF-16 spans and morphological token shape; AP-10 part 1 introduced immutable request identity, Worker epoch and one-shot terminal states. The current three-tier `analysis.worker.ts` and Formatter Shadow protocol must not change until NLP is ready.

The chosen implementation adds three modules without changing the Fast/Deep/Idle execution path:

- `src/core/nlp/worker-protocol.ts`: separate typed request/response, `NlpRegionTokens` batches, and `validateNlpWorkerBatch()`. Every result must reproduce **all** `extractProseRegions(original, docType)` regions in order. Each token must pass `validateMorphTokenSequence` (AP-09) against an exact original UTF-16 source slice; partial, reordered or forged regions reject the entire batch.
- `src/core/nlp/worker-client.ts`: creates a dedicated same-origin module Worker **only if request() is explicitly called**. Its Coordinator rechecks Revision, Profile, document, Provider, dictionary SHA-256 and an opaque per-content nonce before results are delivered. A per-request watchdog is independent from the existing lint Worker. Cancellation, crash, timeout, constructor failure and `postMessage` failure produce explicit terminal outcomes; retired Worker event handlers are ignored.
- `src/worker/nlp.worker.ts`: a separate Worker entry with a **fail-closed stub** that replies `provider-unavailable` until Lindera/kuromojin and signed/hash-checked local dictionaries are integrated. No success with empty tokens, remote fetch, CDN or model inference. The message contains text only when a caller explicitly opts in to a future NLP run; text stays on-device.

## Trust boundaries

1. **Caller prerequisites:** user permission and explicit local verified asset readiness. The transport does not attempt to obtain them and must not be invoked from the application until later rollout. The caller's `isCurrent` callback must include consent and live document/Profile/Provider/asset fingerprint; a changed live state must return false.
2. **Worker:** returns one of `error` or a region+MorphToken batch. Startup is not proof of provider availability. Today it *always* returns explicit error.
3. **Main thread:** coordinates request/Worker epochs, handles timeout/crash, rejects stale response identities, validates all original source spans and normalized POS fields before publishing a completed batch. Invalid or partial result is `failed/invalid-payload`.
4. **Formatter isolation:** the existing `LintRequest`, positive UI revisions and negative Shadow revisions are unchanged. This module is not instantiated in app boot or formatting.

## Failure semantics and limitations

- `provider-error`: backend Worker returned error (including explicit `provider-unavailable`).
- `worker-unavailable`: module Worker startup, postMessage or runtime exception failed.
- `timeout`: per-request watchdog expired; Worker is terminated and the epoch advanced. A delayed reply cannot revive old tokens.
- `invalid-payload`: returned regions/tokens do not exactly match the original document and AP-09 invariants.
- `skipped`: superseded, explicit cancellation or changed snapshot. Never flatten a failed run into `[]`/clean analysis.
- A completed array may legitimately be empty only when an enabled, real tokenizer validates a matching set of prose regions. This is not currently reachable through the actual stub Worker.
- The transport permits one active request. On supersession, the old Promise ends but a synchronous already-running tokenizer may continue in that Worker until a future implementation supports cooperative cancel; timeout eventually retires it. Later provider rollout must add budgets, cancellation and initialization rules.
- Worker availability and dictionary installation, lifecycle hooks for app session/Private mode, UI/error affordances, whole-document NLP diagnostics, and performance measurements are still deferred.

## Regression verification

`tests/analysis/ap10-nlp-worker-transport.test.ts` runs with injectable fake Workers and fake timers, covering: successful echo and accepted token, atomic invalid token rejection, forged/omitted region, provider unavailable, supersession, stale Profile, mismatched snapshot and watchdog, Worker crash/epoch, worker constructor and postMessage failures, cancel/dispose, and lazy construction. No CI workflows/dependencies/DB migration are modified.

Merge only if existing CI succeeds: TypeScript, dictionary integrity, Vitest, benchmark smoke, Vite production and GitHub Pages builds.