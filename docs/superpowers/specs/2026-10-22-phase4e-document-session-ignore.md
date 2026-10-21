# Phase 4E — Document-scoped diagnostic ignore (session-only MVP)

## Purpose and intentional storage boundary

The previous `wording/common-typo` allowance is a **profile-wide spelling
exception**. The new action is different: suppress the same **rule + source +
exact highlighted substring** only within the active document/workspace.

V1 is intentionally **memory only for the current browser tab**. It does not
write ignored terms, excerpts or fingerprints into AppConfig, IndexedDB,
workspace profiles, document bodies, history or URLs. Reloading the page ends
these suppressions. Persistent local-library overrides and their migration
/privacy lifecycle are separate projects.

## User journey

1. From DiagnosticsPanel, select **「この文書で同じ警告を無視」**.
2. The current rule's diagnostics on matching highlighted text disappear from
   the list and CodeMirror gutter/annotations. Other rules continue operating.
3. Below the list, **「この文書で無視中」** shows each suppression with a
   **「再表示」** button. Restoring makes matching current diagnostics visible.
4. Switching away and back to the same document in the same tab restores the
   session suppression. Other documents and other workspaces are unaffected.
5. Deleting a document or workspace clears its suppression state. Closing
   or reloading the tab clears everything.

This is **not** a once-per-occurrence suppression: two occurrences of the
same exact spelling flagged by the same rule in the same document are both
suppressed. Modifying the text so the exact highlighted content differs
returns a diagnostic; inserting text before it does not.

## Core design

- Pure model `src/state/ignored-diagnostics.ts` constructs and matches keys
  from `[source, ruleId, excerpt]`.
- Scope key: `[workspaceId, documentId]` (both nonempty), never the visible
  filename or generic configuration ID.
- Up to 100 suppressed match patterns per document, each excerpt up to 240
  UTF-16 code units; invalid, empty and out-of-range spans are rejected.
- A user action is accepted only when the diagnostic ID, rule, source and
  offsets are present in the active revision's derived diagnostic list.
  Stale Worker callbacks and mismatched document context are rejected.
- Raw Worker results remain unchanged. The derived `diagnostics` list filters
  active suppressions and is shared by EditorPane, Diagnostic counts and
  the source diagnostics used to plan Safe Fixes.
- The Format shadow lint error comparison uses **unfiltered raw** errors
  before vs raw shadow errors after. Otherwise a deliberately hidden error
  would spuriously count as a newly introduced error.
- No additional Worker messages or lint rerun are needed for toggling:
  Solid's derived state updates the presentation immediately.
- Successful document/workspace deletion clears ignored entries to avoid
  reuse of a now-deleted identity.

## Validation

- Stable matching after emoji insertion shifts UTF-16 offsets.
- Cross-document/workspace separation and reversible "show again" workflow.
- Different source or rule IDs remain independent even with matching text.
- Guard stale revision, spoofed ID, invalid/out-of-bound/zero-length offsets.
- Ignoring a safe-fix warning prevents formatter from applying it; raw
  comparison still sees existing errors.
- No changes to serialized config (including private-mode settings).
- Document switching/deletion lifecycle test, CI typecheck, full Vitest,
  production and Pages builds, Worker asset-path validation.

## Known limitations and next work

- No persistent ignores; explicit UI copy prevents implying otherwise.
- Matching by exact substring can suppress more than one occurrence of the
  same rule within a document, by design.
- A multi-line diagnostic excerpt over 240 UTF-16 units cannot be ignored in
  this version. Its normal diagnostic remains visible.
- Further work: opt-in, privacy-reviewed durable Local Library ignores,
  ephemeral per-occurrence ignore semantics, management/search of rules,
  keyboard accessibility and richer ignored-warning statistics.
