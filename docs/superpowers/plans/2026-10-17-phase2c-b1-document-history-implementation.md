# Phase 2C-B1 Document History / Snapshot / Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 2C-A の multi-document architecture に、privacy-first な Document History / Snapshot / Restore を追加し、Private Session は memory-only、Local Library は IndexedDB 永続化で安全に復元できるようにする。

**Architecture:** Snapshot persistence は `SnapshotRepository` と `AtomicOperationsPort` に閉じ、通常 capture と restore は `SnapshotService` が storage mode を見て Local / Private をルーティングする。`HistoryController` は app state と editor projection の調停だけを行い、UI は repository / IndexedDB を直接触らない。Local restore は rollback checkpoint と本文更新を1 transactionで確定し、Private restore は専用 memory store の atomic mutation で同じ observable semantics を持つ。

**Tech Stack:** TypeScript 7, SolidJS 1.9, Vite 8, Vitest 5, IndexedDB, fake-indexeddb, Bun 1.4.3

**Spec:** `docs/superpowers/specs/2026-10-17-phase2c-b1-document-history-design.md`

## Global Constraints

- Backend / LLM / Account / Cloud Sync を追加しない。
- `private-session` の snapshot body は IndexedDB / localStorage / sessionStorage へ永続化しない。
- `local-library` の snapshot body のみ既存 `documentSnapshots` store を使う。
- DB version は 2 のまま。新 object store は追加しない。
- Workspace default は `snapshotPolicy: { enabled: false, maxSnapshots: 20 }` を維持する。
- `maxSnapshots` は 1 document あたり、validation は整数 `1..1000` を維持する。
- Full snapshot を採用し、delta / compression / CRDT は導入しない。
- `before-import` は schema compatibility のため残すが Phase 2C-B1 では自動生成しない。
- body full-text search は Phase 2C-B2 に残し、本PRへ入れない。
- UI は persistence adapter を直接呼ばない。
- すべての product behavior 変更は RED → minimal fix → GREEN の順で実装する。

## Review Focus

1. `maxSnapshots=1` の restore で target snapshot が checkpoint prune に巻き込まれても、target body を transaction 内で先に固定して正常復元できること。Task 3 の IndexedDB restore test で固定する。
2. restore target と current body が同一の場合は body update も checkpoint 生成も行わないこと。Task 4 の service test で固定する。
3. snapshot policy OFF でも既存 history の閲覧/restore は可能で、restore rollback checkpoint だけは例外的に作れること。Task 4 / Task 6 で固定する。
4. Private → Local / Local → Private で snapshot history をコピーせず、Private body が durable storeへ漏れないこと。Task 7 の privacy regression test で固定する。
5. stale restore request が document / Workspace switch 後に別本文へ適用されないこと。Task 5 の controller regression test で固定する。

---

## File Map

### Domain / persistence
- Modify: `src/core/workspace/types.ts` — `SnapshotReason`, `before-restore`
- Modify: `src/core/workspace/validate.ts` — snapshot validation helper
- Modify: `src/storage/repositories/ports.ts` — `SnapshotRepository`, capture/restore atomic contracts
- Modify: `src/storage/repositories/indexeddb.ts` — read-only snapshot repository
- Modify: `src/storage/repositories/memory.ts` — memory adapter parity
- Modify: `src/storage/db/indexeddb-atomic-operations.ts` — atomic capture / restore
- Create: `src/document/session-snapshot-store.ts` — Private Session history

### Application layer
- Create: `src/history/snapshot-service.ts` — Local/Private routing, retention/throttle policy
- Create: `src/history/types.ts` — summaries / results / restore request types
- Create: `src/state/history-controller.ts` — active document/history UI orchestration
- Modify: `src/state/application-runtime.ts` — shared SessionSnapshotStore / SnapshotService
- Modify: `src/state/workspace-runtime.ts` — singleton HistoryController
- Modify: `src/state/app-state.ts` — history UI state
- Modify: `src/state/actions.ts` — Format checkpoint + post-autosave snapshot hook

### UI
- Create: `src/components/HistoryPanel.tsx`
- Create: `src/components/HistoryPanel.css`
- Modify: `src/components/DocumentSidebar.tsx` — History entry point
- Modify: `src/components/WorkspaceManageDialog.tsx` — snapshot policy controls
- Modify: `src/App.tsx` — History panel mount if required by current layout

### Tests
- Create: `tests/storage/snapshot-repository.test.ts`
- Create: `tests/storage/snapshot-atomic.test.ts`
- Create: `tests/document/session-snapshot-store.test.ts`
- Create: `tests/document/snapshot-service.test.ts`
- Create: `tests/document/history-controller.test.ts`
- Create: `tests/document/history-ui-model.test.ts` if pure UI helpers are extracted
- Create: `tests/storage/private-history-leak-regression.test.ts`
- Extend: formatter/action tests and workspace management tests where current files already own those flows

---

### Task 1: Snapshot domain types and read repositories

**Files:**
- Modify: `src/core/workspace/types.ts`
- Modify: `src/core/workspace/validate.ts`
- Modify: `src/storage/repositories/ports.ts`
- Modify: `src/storage/repositories/indexeddb.ts`
- Modify: `src/storage/repositories/memory.ts`
- Create: `tests/storage/snapshot-repository.test.ts`

**Interfaces:**
- Produces `SnapshotReason`, `SnapshotRepository`, validated `DocumentSnapshot` read semantics used by all later tasks.

- [ ] **Step 1: Write failing repository/domain tests**
  - `before-restore` is accepted.
  - invalid reason / invalid revision / empty IDs are rejected.
  - `listByDocument(documentId)` returns only that document and deterministic `createdAt DESC, revision DESC` order.
  - `get(id)` returns `undefined` for missing records and validates persisted records.

- [ ] **Step 2: Run targeted test**
  - Run: `bun test tests/storage/snapshot-repository.test.ts`
  - Expected: FAIL because snapshot repository/types are incomplete.

- [ ] **Step 3: Implement exact public contracts**
  - `type SnapshotReason = 'autosave' | 'manual' | 'before-format' | 'before-import' | 'before-restore'`
  - `interface SnapshotRepository { listByDocument(documentId: string): Promise<DocumentSnapshot[]>; get(id: string): Promise<DocumentSnapshot | undefined> }`
  - Add `snapshots: SnapshotRepository` to `StorageRepositories`.

- [ ] **Step 4: Run targeted test**
  - Expected: PASS.

- [ ] **Step 5: Commit**
  - `feat: add snapshot repository contracts`

### Task 2: Private Session snapshot store

**Files:**
- Create: `src/document/session-snapshot-store.ts`
- Create: `tests/document/session-snapshot-store.test.ts`

**Interfaces:**
- Consumes `DocumentSnapshot`, `SnapshotReason`.
- Produces `SessionSnapshotStore` with clone boundaries and atomic memory semantics.

- [ ] **Step 1: Write failing tests**
  - capture revision starts at 1 and increases per document.
  - duplicate latest content returns `skippedDuplicate=true` without new record.
  - retention prunes oldest by revision while never reusing revision numbers.
  - restore creates/reuses `before-restore` checkpoint according to duplicate rule and updates one document only.
  - `deleteDocument`, `deleteWorkspaceDocuments(documentIds)`, `clear` remove only intended history.
  - returned snapshots are clones.

- [ ] **Step 2: Run** `bun test tests/document/session-snapshot-store.test.ts` and verify RED.

- [ ] **Step 3: Implement `SessionSnapshotStore`**
  - Include `list`, `get`, `capture`, `restore`, `deleteDocument`, `deleteDocuments`, `clear`.
  - Keep monotonic next revision per document even after pruning.

- [ ] **Step 4: Run targeted tests and verify GREEN.**

- [ ] **Step 5: Commit** `feat: add private session snapshot store`.

### Task 3: Atomic Local Library capture and restore

**Files:**
- Modify: `src/storage/repositories/ports.ts`
- Modify: `src/storage/db/indexeddb-atomic-operations.ts`
- Modify: `src/storage/repositories/memory.ts`
- Create: `tests/storage/snapshot-atomic.test.ts`

**Interfaces:**
- Produces:
  - `captureSnapshot(input: SnapshotCaptureInput): Promise<SnapshotCaptureResult>`
  - `restoreDocumentFromSnapshot(input: RestoreDocumentInput): Promise<RestoreDocumentResult>`
- Both memory and IndexedDB adapters MUST have matching validation / collision / retention semantics.

- [ ] **Step 1: Write failing atomic tests for IndexedDB and memory parity**
  - capture validates target document existence.
  - duplicate content does not insert or consume revision.
  - insert + prune is atomic.
  - revision is `max existing revision + 1`, not `count + 1`.
  - restore rejects cross-document / cross-workspace targets.
  - restore failure leaves document and snapshots unchanged.
  - `maxSnapshots=1`: read target body first, create/reuse checkpoint, prune, update document successfully.
  - checkpoint duplicate with current latest content is reused rather than duplicated.

- [ ] **Step 2: Run** `bun test tests/storage/snapshot-atomic.test.ts` and verify RED.

- [ ] **Step 3: Implement atomic operations** using one `readwrite` transaction over `workspaces`, `workspaceDocuments`, `documentSnapshots` for Local restore and one over `workspaceDocuments`, `documentSnapshots` for capture where workspace validation is not required by the existing port contract.

- [ ] **Step 4: Run targeted tests and verify GREEN for both adapters.**

- [ ] **Step 5: Commit** `feat: add atomic snapshot capture and restore`.

### Task 4: SnapshotService policy, summaries, autosave throttle

**Files:**
- Create: `src/history/types.ts`
- Create: `src/history/snapshot-service.ts`
- Create: `tests/document/snapshot-service.test.ts`

**Interfaces:**
- Consumes `StorageRepositories.snapshots`, `AtomicOperationsPort`, `SessionSnapshotStore`.
- Produces `SnapshotService`:
  - `list(workspace, documentId): Promise<SnapshotSummary[]>`
  - `get(workspace, documentId, snapshotId): Promise<DocumentSnapshot | undefined>`
  - `capture(workspace, document, reason, options?): Promise<SnapshotCaptureResult>`
  - `captureAutosave(workspace, document): Promise<SnapshotCaptureResult | { skippedThrottle: true }>`
  - `restore(workspace, request): Promise<EditableDocument>`

- [ ] **Step 1: Write failing service tests**
  - policy OFF blocks manual/autosave/before-format capture.
  - policy OFF still permits list/get/restore and restore safety checkpoint.
  - autosave first capture is immediate; later autosave within 5 minutes is throttled; after 5 minutes allowed.
  - manual/before-format do not reset autosave throttle clock.
  - preview is normalized and limited to 160 Unicode code points.
  - current body === target body => restore no-op with no checkpoint/body write.
  - Private never calls durable snapshot repository/atomic capture.

- [ ] **Step 2: Run** `bun test tests/document/snapshot-service.test.ts` and verify RED.

- [ ] **Step 3: Implement SnapshotService** with per-document in-process serialization for capture/restore and exact storage-mode routing.

- [ ] **Step 4: Run targeted tests and verify GREEN.**

- [ ] **Step 5: Commit** `feat: add snapshot service`.

### Task 5: Shared runtime and HistoryController with stale-request protection

**Files:**
- Modify: `src/state/application-runtime.ts`
- Create: `src/state/history-controller.ts`
- Modify: `src/state/workspace-runtime.ts`
- Modify: `src/state/app-state.ts`
- Create: `tests/document/history-controller.test.ts`

**Interfaces:**
- ApplicationRuntime adds `getSessionSnapshotStore()` and `getSnapshotService()`.
- HistoryController produces `refresh`, `saveManualSnapshot`, `previewSnapshot`, `restoreSnapshot`, `closeHistory`.

- [ ] **Step 1: Write failing controller tests**
  - opening/refreshing history binds to active `{workspaceId, documentId}`.
  - manual capture uses current editor content and refreshes list.
  - preview does not mutate editor body.
  - restore captures request identity before async work.
  - document or Workspace identity change before completion rejects stale result and does not apply editor state.
  - successful restore cancels pending product autosave, updates editor, resets diagnostics, relints, refreshes history.
  - restore pending state blocks a second restore.

- [ ] **Step 2: Run** `bun test tests/document/history-controller.test.ts` and verify RED.

- [ ] **Step 3: Implement shared runtime and controller.**

- [ ] **Step 4: Run targeted tests and verify GREEN.**

- [ ] **Step 5: Commit** `feat: add history controller`.

### Task 6: Product integration — Format, autosave, policy controls, History UI

**Files:**
- Modify: `src/state/actions.ts`
- Create: `src/components/HistoryPanel.tsx`
- Create: `src/components/HistoryPanel.css`
- Modify: `src/components/DocumentSidebar.tsx`
- Modify: `src/components/WorkspaceManageDialog.tsx`
- Modify: `src/App.tsx` if layout mount is needed
- Extend/create relevant tests under `tests/document/` and `tests/workspace/`

**Interfaces:**
- Consumes singleton `historyController` / `SnapshotService` only; components never access repositories.

- [ ] **Step 1: Write failing product tests**
  - Format with actual fixes + policy ON requires successful `before-format` capture before editor mutation.
  - failed `before-format` capture cancels Format and leaves editor unchanged.
  - policy OFF preserves existing Format behavior.
  - successful debounced Local document save triggers best-effort autosave snapshot; snapshot failure does not roll back saved document.
  - Workspace Manage can toggle `snapshotPolicy.enabled` and change `maxSnapshots` within `1..1000` through WorkspaceService/controller persistence, not direct repository access.
  - History panel lists time/reason/preview, manual snapshot action, preview, confirmed restore, and disabled state while mutation pending.
  - document sidebar exposes History for active document only.

- [ ] **Step 2: Run targeted tests and verify RED.**

- [ ] **Step 3: Implement product integration.**
  - Keep History UI separate from DocumentSidebar internals; Sidebar only opens it.
  - Do not add a diff viewer.

- [ ] **Step 4: Run targeted tests and verify GREEN.**

- [ ] **Step 5: Commit** `feat: integrate document history UI`.

### Task 7: Privacy / lifecycle / adversarial regressions

**Files:**
- Modify as required in `src/workspace/workspace-service.ts`, `src/state/workspace-controller.ts`, `src/document/document-service.ts`, session snapshot lifecycle hooks
- Create: `tests/storage/private-history-leak-regression.test.ts`
- Extend: `tests/storage/document-delete-adversarial.test.ts`
- Extend: existing Workspace transition/deletion regression tests

**Interfaces:**
- No new public UI contract unless a true gap is discovered.

- [ ] **Step 1: Write adversarial RED tests**
  - Private manual/autosave/format/restore snapshot flows write zero durable snapshot records.
  - Private → Local copies documents only; Private snapshot history is not migrated.
  - Local → Private scrubs durable snapshots atomically but does not import them into Private history.
  - deleting active/non-active/last documents cascades only deleted document snapshots.
  - deleting Workspace clears its Private snapshot store only after successful delete, and Local cascade removes its durable snapshots.
  - failed Workspace delete/storage transition preserves canonical source history.
  - another Workspace/document history remains unchanged.

- [ ] **Step 2: Run targeted regression suite and verify RED only for missing lifecycle hooks.**

- [ ] **Step 3: Implement minimal lifecycle hooks** without broad refactors.

- [ ] **Step 4: Run all Phase 2C-B1 targeted tests and verify GREEN.**

- [ ] **Step 5: Commit** `test: harden document history privacy boundaries` or `fix:` if product code changes are required.

### Task 8: Whole-branch review, verification, PR and merge gate

**Files:**
- All changed files from Tasks 1–7
- Update design/plan only if implementation exposes an actual contract correction

**Interfaces:**
- Final shipped contract only.

- [ ] **Step 1: Run static/type verification**
  - `bun run lint`
  - Expected: PASS.

- [ ] **Step 2: Run full tests**
  - `bun test`
  - Expected: all tests PASS.

- [ ] **Step 3: Run builds**
  - `bun run build`
  - `bun run build:pages`
  - Verify `/japanese_text/assets/` and worker asset paths using existing CI-equivalent checks.

- [ ] **Step 4: Perform whole-branch code review**
  - Check false positives, transaction atomicity, clone boundaries, stale async application, privacy leakage, adapter parity, accessibility, and whether any new failure path can overwrite a different document.
  - Add RED regression tests before every true-positive fix.

- [ ] **Step 5: Re-run exact-head full verification after review fixes.**

- [ ] **Step 6: Open PR**
  - Title: `feat: Phase 2C-B1 Document History / Snapshot / Restore`
  - Body includes design/plan links, privacy semantics, atomic restore guarantees, test counts, exact head SHA, CI evidence, and Phase 2C-B2 deferral.

- [ ] **Step 7: Verify PR exact-head CI and review state**
  - Require CI success, mergeable=true, draft=false, unresolved review threads=0.

- [ ] **Step 8: Squash merge after the already supplied merge authorization**
  - Use `expected_head_sha` to reject moved-head merges.
  - Suggested commit title: `feat: Phase 2C-B1 Document History / Snapshot / Restore (#<PR>)`.

- [ ] **Step 9: Verify post-merge main**
  - Confirm `main` points at merge SHA.
  - Confirm main CI success.
  - Confirm GitHub Pages build/deploy success for the same merge SHA.

---

## Plan Self-Review Result

- Spec coverage: all B1 requirements map to Tasks 1–8; B2 full-text search remains explicitly excluded.
- Type consistency: one `SnapshotReason`, one `SnapshotCaptureInput/Result`, one `RestoreDocumentInput/Result` contract shared across adapters/service.
- Failure semantics: restore atomicity, stale request rejection, adapter parity, policy OFF exception, and privacy transition behavior all have explicit tests.
- Scope: no DB version bump, no new dependency, no diff viewer, no search subsystem, no unrelated refactor.
- Execution mode: Native implementation is appropriate because tasks are strongly interface-dependent and the current GitHub connector supports incremental branch commits; whole-branch review remains mandatory before merge.