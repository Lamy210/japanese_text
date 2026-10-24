# Worker Deep tier — true lazy textlint loading

## Finding (confirmed in the source)

The worker's Deep-tier branch always awaited `loadTextlint()`, even when
all textlint rules were disabled in the active `AppConfig`. The adapter
itself checks enabled rules, but that check happens **after** the lazy
module/chunk has already been requested. Thus a disabled textlint feature
could still allocate, load a chunk or report a module-load failure.

This is especially undesirable for users choosing Minimal or custom
profiles without active textlint rules, and for offline operation.

## Resolution

- Check the small, statically available `TEXTLINT_RULE_IDS` metadata
  against the **request-scoped** config before calling `loadTextlint()`.
- If none are enabled, run existing builtin Deep rules and publish the same
  terminal Deep result without loading or executing textlint.
- If at least one is enabled, preserve the entire existing adapter/error/
  superseded-revision handling.
- Recheck revision-gate obsolescence after the optional asynchronous step.
- Do not change whether Shadow negative-revision jobs are independently
  completed; their config determines whether they require textlint.
- Do not add a timer, dynamic network feature, asset, dependency or worker
  message. The source document stays entirely in the same Worker.

## Regression test

`tests/worker/analysis-stale-integration.test.ts` exercises the **real
Worker event loop** with a hoisted adapter mock whose module factory records
when it was evaluated:

1. Initial Deep/Idle with no enabled textlint rules: two valid terminal
   results, builtin Deep/Idle executed, **zero adapter imports**.
2. Enable textlint later: adapter imported and called exactly once.
3. Disable it again: Deep finishes, no adapter execution or new import.
4. Re-enable it: cached adapter is reused without a second import.
5. Existing stale-revision / negative Shadow / tier-failure tests still pass.

Tests distinguish module loading from adapter execution; a
`runTextlint()` invocation assertion alone would not catch the old bug.

## Review, alternatives, limitations

**Confirmed:** Previous Worker unconditionally imported textlint on Deep
requests, irrespective of settings.

Alternatives: checking only inside `runTextlint()` is insufficient since
the module has already loaded; introducing a second provider registry is
unnecessary. Reading `TEXTLINT_RULE_IDS` from the existing lightweight
metadata is the minimal backward-compatible fix.

**Intentional:** This does not disable builtin Deep rules or the
formatter's independent Shadow analysis. It does not make assumptions
about failed dynamic imports; they can still be retried on the next
enabled request as before.

**Remaining risk:** No actual browser network waterfall/performance
measurement is claimed; E2E offline coverage is still desirable.

No existing rule ID, Diagnostic ID, Config schema, IndexedDB, Worker
protocol, CI workflow or generated dictionary asset is changed.
