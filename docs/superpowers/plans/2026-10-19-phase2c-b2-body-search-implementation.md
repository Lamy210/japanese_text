# Phase 2C-B2 — Implementation Plan (2026-10-19)

Spec: `docs/superpowers/specs/2026-10-19-phase2c-b2-body-search-design.md`

### Task 1 — Pure search contract (RED→GREEN)
- Add `tests/document/body-search.test.ts` first: Japanese, regex metacharacters as literals, case folding, UTF-16 positions, sorted docs, 3-per-document/50-total bounds, blank/overlength queries.
- Add `DocumentSearchHit` type and pure `src/document/body-search.ts`.
- Verify test and full suite.

### Task 2 — Privacy-aware DocumentService (RED→GREEN)
- Add `tests/document/body-search-service.test.ts` using memory/IndexedDB backed stores.
- Add `search(workspace, query, activeDocument?)` to DocumentService without changing existing resolve/list semantics. Strict Workspace filtering and unsaved active overlay.
- Verify no writes, no Private durable reads.

### Task 3 — Controller and sidebar UX (RED→GREEN)
- Add controller search method with pre/post await identity guards.
- Add a compact, explicit query form, results and stale-result guards to DocumentSidebar; keep name filter unchanged.
- Ensure no document/Workspace identity changed during search; clicking a result uses existing document switch and guarded CodeMirror jump.
- Pure helpers for navigation if needed with unit coverage.

### Task 4 — Final review and merge
- Adversarial cross-Workspace, Private leakage, stale responses, regex, UTF-16 and result cap checks.
- `bun run lint`, `bun test`, `bun run build`, `bun run build:pages`, assets checks (CI).
- Review exact diff, classify/repair true positives with a failing regression first.
- PR with design links and exact test run; only squash-merge after CI success, mergeable, draft=false, no unresolved threads. Confirm main CI and Pages success.

**Out of scope:** search index, persisted queries, snapshot search, advanced fuzzy search, new dependencies.
