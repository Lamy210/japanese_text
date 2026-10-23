# Formatter — Guard stale shadow analysis across Profile / Pack revisions

## Root cause (Confirmed)

`formatDocumentAction()` captures an initial document revision, waits for a
complete baseline, constructs a Safe Fix plan and then awaits a complete
negative-revision Shadow lint. Before this change, the final apply guard only
compared Workspace ID, Document ID and text. A Pack toggle or RuleProfile
switch can increment the active analysis revision while preserving exactly
the same text. In that case the earlier plan and its shadow verification are
stale, but the old guard permitted applying them.

## Fix

- Require `appState.revision() === baselineRevision` again after the Shadow
  run and after the asynchronous before-format checkpoint.
- Recheck Workspace/Document IDs, identical content and
  `config.formatter.enabled` before history capture and transaction.
- Do not create a history snapshot if an already-detected stale generation
  makes the Format operation invalid.
- Preserve the existing complete 3-tier baseline and shadow error-count gates.
  Shadow lint requests remain negative and independent of interactive
  cancellation; no Worker protocol or persistence changes are necessary.

## Alternatives

1. Cancel in-flight Shadow Worker jobs on settings changes: not chosen because
   independent formatter Shadow jobs are intentionally isolated from UI
   revision cancellation and changing the Worker lifecycle is riskier.
2. **Chosen:** guard the immutable baseline revision at both asynchronous
   boundaries. This protects against stale results with a narrowly scoped
   change, preserving current formatter behavior.
3. Recompute plan after any setting change: requires a new full baseline/shadow
   cycle and would be surprising compared with explicitly cancelling Format.

## Meaningful regressions

`tests/formatter/format-action-safety.test.ts` injects a pending Shadow
Promise; after the Formatter has started waiting, it changes Dictionary Pack
settings without changing the text, advances the analysis generation and
resolves a fully successful Shadow result. The action must **not** call
`applyFixesTransaction`. A second test increments the revision with exactly
the same text to prove that comparing strings alone is insufficient. Both
would have failed against the previous implementation.

## Remaining risk

End-to-end browser testing of a real Worker, Profile switching, and history
capture timing should supplement these deterministic unit regressions. This
PR does not add new Worker, storage, config or CI behavior.
