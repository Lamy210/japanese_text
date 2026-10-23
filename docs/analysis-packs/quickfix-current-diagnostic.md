# Quick Fix — Current-diagnostic authority check

## Confirmed defect

The existing Ignore action validates a diagnostic against the active visible
diagnostics. The adjacent `quickFix(diagnostic)` previously passed arbitrary
offsets/replacements to the CodeMirror adapter without checking whether the
diagnostic still belonged to the current document/Pack configuration. A
previously rendered callback could therefore apply an obsolete fix after
editing, a RuleProfile switch, or a Pack gate change.

## Decision

Reuse the existing `isCurrentDiagnostic` guard used by the Ignore action and
extend its equality check to the critical `fixKind` and `replacement`
fields. Require a non-`none` fix and a replacement before dispatch.

This avoids introducing a separate Quick Fix cache or modifying the Worker
protocol. The UI continues to use the existing Safe Fix/Suggestion buttons;
valid current fixes continue to execute one transaction through
`applyReplacement`. Invalid or stale requests fail closed with a warning.

## Meaningful tests

`tests/formatter/quickfix-current-diagnostic.test.ts`:
- current suggestion reaches the adapter with the original UTF-16 offsets;
- Pack/Profile generation invalidation with unchanged text blocks a stale fix;
- an edit invalidates old offsets even if they are still in bounds;
- spoofed replacement or fix kind with a genuine diagnostic ID is rejected;
- mismatching rule IDs and offsets are rejected.

Do not claim that this performs authorization across users or processes: it
is a local correctness boundary for a browser-only editing application.

## Deferred

A full interactive browser test for a queued pointer/keyboard event against a
replaced diagnostic panel remains desirable. This PR requires no persistence,
schema, CI, Worker, or dictionary changes.
