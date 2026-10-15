# Phase 2C-A Document Library / Sidebar / Multi-document Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 1 Workspace 内で複数 document を安全に作成・切替・改名・削除できる Document Library と Sidebar を追加し、Private Session / Local Library の privacy invariant を multi-document 対応へ拡張する。

**Architecture:** `WorkspaceService` から document body / selection の責務を分離し、新しい `DocumentService` と `DocumentController` に集約する。Local Library の active document selection は既存 IndexedDB `meta` store、Private Session の library / selection は共有 `SessionDocumentLibraryStore` の memory のみに保持し、autosave は `workspaceId + documentId` を schedule 時点で固定する。

**Tech Stack:** SolidJS 1.9, TypeScript 7, Vite 8, Vitest 5, fake-indexeddb 6.2.5, CodeMirror 6, IndexedDB v2, native CSS

**Spec:** `docs/superpowers/specs/2026-10-15-phase2c-document-library-design.md`

## Global Constraints

- Backend / account / cloud sync / LLM を追加しない。
- `private-session` の document content・document list・active document selection は IndexedDB / localStorage / sessionStorage に保存しない。
- `local-library` はユーザーの明示 opt-in のみ。document create/import/config import から暗黙に有効化しない。
- `Workspace.storageMode` を本文永続化 policy の canonical source とする。
- DB name は `japanese-writing-toolkit`、DB version は **2 のまま**。新 Object Store / index は追加しない。
- Local active document selection は `meta` key `active-document-id:<workspaceId>` を使用する。
- Document identity は immutable ID。name は identity に使わず、重複名を許可する。
- Sidebar ordering は `createdAt ASC, id ASC`。通常 active selection に `updatedAt` を使わない。
- 既存 Phase 2B data に active-document meta がない初回 repair のみ `updatedAt DESC, id ASC` で legacy behavior を尊重する。
- Document name は trim 後非空、最大 120 Unicode code points、control character と `/`・`\\` を禁止する。
- 新規 document default は `untitled.md` / `markdown` / empty content / `sourceKind='local'`。
- 最後の document 削除後も Workspace を通常状態で document 0件にせず、空 `untitled.md` を replacement として生成する。
- autosave destination は `workspaceId + documentId` の両方を capture し、callback 内で active selection を再解決しない。
- Document switch / Workspace switch / delete / storage mode transition / Open import の前に pending document autosave を cancel する。
- Private -> Local は session documents **全件** + active document ID + storage mode を atomic に commit する。
- Local -> Private は Local documents 全件を memory snapshot として読み取った後、persisted documents / snapshots / active document meta を atomic に scrub し、成功後だけ memory snapshot を canonical 化する。
- Phase 2C-A では snapshot を新規作成しない。既存 snapshot の cascade delete のみ維持する。
- folders / tags / tabs / body full-text search / History UI / file-backed / multi-tab sync は非対象。
- 全 product code は failing test → RED確認 → minimal implementation → GREEN確認 → commit の順で進める。
- 各Task完了時に対象test + `bun run lint` を実行する。Task 12でfull suite / build / Pages verificationを実行する。

## File Structure

### 新規

- `src/document/types.ts` — `EditableDocument`, `DocumentSummary`, `DocumentContext`, delete result 等のapplication/domain projection。
- `src/document/session-document-library.ts` — Private Session 用 multi-document memory store。
- `src/document/document-service.ts` — document CRUD / active selection / body routing / repair。
- `src/state/document-controller.ts` — `appState` と `DocumentService` の orchestration、CRUD/import/switch。
- `src/state/application-runtime.ts` — StorageContext / SessionDocumentLibraryStore / WorkspaceService / DocumentService の共有singleton runtime。
- `src/components/DocumentSidebar.tsx` — document library UI / filter / CRUD controls / drawer。
- `tests/document/session-document-library.test.ts`
- `tests/document/document-service.test.ts`
- `tests/document/document-controller.test.ts`
- `tests/document/document-autosave.test.ts`
- `tests/document/document-sidebar.test.ts`
- `tests/document/document-regression.test.ts`
- `tests/storage/document-selection.test.ts`
- `tests/storage/document-atomic-operations.test.ts`

### 主な変更

- `src/storage/repositories/ports.ts` — `DocumentSelectionRepository` と atomic API。
- `src/storage/repositories/memory.ts` — document selection + multi-document atomic semantics。
- `src/storage/repositories/indexeddb.ts` — `meta` based document selection adapter。
- `src/storage/db/schema.ts` — active document meta prefix/helper（DB version変更なし）。
- `src/storage/db/indexeddb-atomic-operations.ts` — create/delete/replacement/storage transition/workspace cleanup atomicity。
- `src/workspace/workspace-service.ts` — document routing責務を除去し、storage mode transitionをlibrary snapshot入力へ変更。
- `src/state/workspace-controller.ts` — DocumentController/DocumentService と連携してWorkspace switch/delete/storage transitionをorchestrate。
- `src/state/workspace-runtime.ts` — compatibility re-exportに縮小し、共有runtimeは`application-runtime.ts`へ移す。
- `src/state/app-state.ts` — document library signals。
- `src/state/actions.ts` — explicit `workspaceId + documentId + snapshot` autosave、OpenをDocumentControllerへ委譲。
- `src/components/EditorPane.tsx` — active document IDをschedule時点で取得してautosave。
- `src/components/Header.tsx` — Documents toggle、Open integration。
- `src/app/App.tsx` — DocumentSidebar配置 / panel mutual exclusion。
- `src/styles/global.css` — Sidebar / drawer / responsive layout。
- 既存 `src/workspace/session-document-store.ts` と対応test — 新runtime移行完了後に削除。
- Phase 2B workspace/storage tests — 新しいmulti-document contractへ更新し回帰を維持。

## Review Focus

1. **Stale save after navigation:** A を編集後に document/workspace を切替えても、遅延timerがBへ保存したりAを古いsnapshotで上書きしない。Task 7でrace testを固定する。
2. **Selection corruption / write failure:** Local active-document meta が不存在・不正・書込失敗でも本文を失わず deterministic repair / current-session fallback が成立する。Task 4でfailure injection testを固定する。
3. **Partial privacy transition:** Private→Local / Local→Private の途中失敗で一部documentだけpersist/scrubされた状態を残さない。Task 3とTask 9でatomic failure testを固定する。
4. **Delete boundary:** active/last/non-active document削除で別Workspaceのdocuments/snapshots/selectionを触らず、successor/replacementが一意に決まる。Task 3・4でcross-workspace testを固定する。
5. **Private data leak through compatibility paths:** legacy `saveRecentDocument` / generic config save / import / bootstrap がPrivate document list/body/selectionをdurable storageへ漏らさない。Task 11でadversarial regression testを固定する。

---

### Task 1: Document Selection Port + Memory / IndexedDB Adapters

**Files:**
- Modify: `src/storage/repositories/ports.ts`
- Modify: `src/storage/repositories/memory.ts`
- Modify: `src/storage/repositories/indexeddb.ts`
- Modify: `src/storage/db/schema.ts`
- Create: `tests/storage/document-selection.test.ts`
- Modify: `tests/storage/repository-contract.ts`
- Modify: `tests/storage/memory-repositories.test.ts`
- Modify: `tests/storage/indexeddb-repositories.test.ts`

**Interfaces:**
- Consumes: existing `StorageRepositories`, `STORE_META`, `requestToPromise`, `transactionDone`.
- Produces:
  ```ts
  interface DocumentSelectionRepository {
    getActiveDocumentId(workspaceId: string): Promise<string | undefined>
    setActiveDocumentId(workspaceId: string, documentId: string): Promise<void>
    deleteActiveDocumentId(workspaceId: string): Promise<void>
  }
  ```
  `StorageRepositories.documentSelection: DocumentSelectionRepository`
  and `activeDocumentMetaKey(workspaceId: string): string` returning `active-document-id:<workspaceId>`.

- [ ] **Step 1: Write failing repository contract tests**

  Add tests asserting:
  - get returns `undefined` initially;
  - set/get round-trips per Workspace;
  - Workspace A/B selection is isolated;
  - delete removes only target Workspace selection;
  - empty `workspaceId` or `documentId` on set rejects.

- [ ] **Step 2: Run RED**

  Run: `bun run test -- tests/storage/document-selection.test.ts tests/storage/memory-repositories.test.ts tests/storage/indexeddb-repositories.test.ts`

  Expected: FAIL because `documentSelection` and `activeDocumentMetaKey()` do not exist.

- [ ] **Step 3: Add port + meta key helper**

  Add exact signatures above. Keep `DB_VERSION = 2` unchanged.

- [ ] **Step 4: Implement Memory + IndexedDB adapters**

  Memory uses `Map<string,string>`; IndexedDB uses `STORE_META` and `activeDocumentMetaKey(workspaceId)`.

- [ ] **Step 5: Run GREEN + typecheck**

  Run: `bun run test -- tests/storage/document-selection.test.ts tests/storage/memory-repositories.test.ts tests/storage/indexeddb-repositories.test.ts && bun run lint`

  Expected: PASS.

- [ ] **Step 6: Commit**

  `git commit -am "feat: add active document selection storage"`

### Task 2: Private Session Multi-document Library Store

**Files:**
- Create: `src/document/types.ts`
- Create: `src/document/session-document-library.ts`
- Create: `tests/document/session-document-library.test.ts`
- Keep temporarily: `src/workspace/session-document-store.ts`

**Interfaces:**
- Produces:
  ```ts
  interface EditableDocument {
    id: string
    workspaceId: string
    name: string
    docType: DocumentType
    content: string
    sourceKind: 'local' | 'file'
    createdAt: number
    updatedAt: number
  }

  interface DocumentSummary extends Omit<EditableDocument, 'content'> {
    active: boolean
  }

  interface SessionDocumentLibrarySnapshot {
    documents: EditableDocument[]
    activeDocumentId: string
  }

  interface SessionDocumentLibraryStore {
    list(workspaceId: string): EditableDocument[]
    get(workspaceId: string, documentId: string): EditableDocument | undefined
    getActiveDocumentId(workspaceId: string): string | undefined
    save(document: EditableDocument): void
    setActiveDocumentId(workspaceId: string, documentId: string): void
    delete(workspaceId: string, documentId: string): void
    replaceWorkspace(workspaceId: string, snapshot: SessionDocumentLibrarySnapshot): void
    deleteWorkspace(workspaceId: string): void
    clear(): void
  }

  function createSessionDocumentLibraryStore(): SessionDocumentLibraryStore
  ```

- [ ] **Step 1: Write failing store tests**

  Cover Workspace isolation, multiple CRUD, clone-on-read/write, active selection, delete, `replaceWorkspace()` all-or-nothing validation, and `deleteWorkspace()`.

- [ ] **Step 2: Run RED**

  Run: `bun run test -- tests/document/session-document-library.test.ts`

  Expected: module missing / API missing.

- [ ] **Step 3: Implement types + store**

  Store all mutable state internally; every public read/write boundary uses structured clone. `replaceWorkspace()` validates that `activeDocumentId` exists in supplied documents before commit.

- [ ] **Step 4: Run GREEN + lint**

  Run: `bun run test -- tests/document/session-document-library.test.ts && bun run lint`

- [ ] **Step 5: Commit**

  `git commit -am "feat: add private session document library"`

### Task 3: Atomic Document Operations + Multi-document Privacy Transactions

**Files:**
- Modify: `src/storage/repositories/ports.ts`
- Modify: `src/storage/repositories/memory.ts`
- Modify: `src/storage/db/indexeddb-atomic-operations.ts`
- Create: `tests/storage/document-atomic-operations.test.ts`
- Modify: `tests/storage/privacy-deletion-atomic.test.ts`
- Modify: `tests/workspace/storage-mode-transition.test.ts`
- Modify: `tests/workspace/legacy-privacy-scrub.test.ts`

**Interfaces:**
- Consumes: Task 1 `documentSelection`, `activeDocumentMetaKey()`.
- Produces / changes:
  ```ts
  createDocumentAndActivate(document: StoredWorkspaceDocument): Promise<void>

  deleteDocumentAndSelectNext(
    workspaceId: string,
    documentId: string,
    nextDocumentId: string
  ): Promise<void>

  replaceLastDocument(
    workspaceId: string,
    oldDocumentId: string,
    replacement: StoredWorkspaceDocument
  ): Promise<void>

  enableLocalLibrary(
    workspaceId: string,
    documents: StoredWorkspaceDocument[],
    activeDocumentId: string
  ): Promise<void>

  makeWorkspacePrivate(workspaceId: string): Promise<void>
  ```
  Existing `deleteWorkspaceCascade()` and `deleteWorkspaceAndSelectNext()` also remove `active-document-id:<workspaceId>`.

- [ ] **Step 1: Write failing atomic tests**

  Assert:
  - create puts document + selection atomically;
  - delete active removes target snapshots + selects provided successor;
  - cross-Workspace successor is rejected;
  - replacement deletes old body/snapshots + inserts replacement + selects replacement;
  - Private→Local validates all documents belong to target, active ID exists, and commits mode+all docs+selection together;
  - injected failure leaves original mode/docs/meta untouched;
  - Local→Private removes target docs/snapshots/meta only;
  - Workspace delete removes target active-doc meta only;
  - migrated legacy recent scrub rule remains scoped to `MIGRATED_WORKSPACE_ID`.

- [ ] **Step 2: Run RED**

  Run: `bun run test -- tests/storage/document-atomic-operations.test.ts tests/storage/privacy-deletion-atomic.test.ts tests/workspace/storage-mode-transition.test.ts tests/workspace/legacy-privacy-scrub.test.ts`

- [ ] **Step 3: Update `AtomicOperationsPort`**

  Replace the Phase 2B one-document `enableLocalLibrary` signature; do not keep an overload that accepts one document.

- [ ] **Step 4: Implement Memory atomic semantics**

  Use projected copies for workspaces/documents/documentSelections and commit references only after all validation succeeds.

- [ ] **Step 5: Implement IndexedDB transactions**

  Use one transaction per operation with required stores. For cursor-dependent deletes, enqueue deletes inside IDB request callbacks so transaction lifetime remains valid.

- [ ] **Step 6: Run GREEN + lint**

  Run the Step 2 command plus `bun run lint`.

- [ ] **Step 7: Commit**

  `git commit -am "feat: add atomic multi-document storage operations"`

### Task 4: DocumentService — Resolve / Repair / CRUD / Switch

**Files:**
- Create: `src/document/document-service.ts`
- Extend: `src/document/types.ts`
- Create: `tests/document/document-service.test.ts`

**Interfaces:**
- Consumes: `StorageRepositories`, Task 2 session library, Task 3 atomic operations, `WELCOME_DOCUMENT`.
- Produces:
  ```ts
  interface DocumentContext {
    document: EditableDocument
    summaries: DocumentSummary[]
    warning?: string
  }

  interface DocumentDeleteResult extends DocumentContext {
    deletedDocumentId: string
  }

  interface DocumentServiceDependencies {
    repositories: StorageRepositories
    atomic: AtomicOperationsPort
    sessionLibrary: SessionDocumentLibraryStore
    now?: () => number
    generateId?: () => string
  }

  interface DocumentService {
    list(workspace: Workspace): Promise<DocumentSummary[]>
    resolveActive(workspace: Workspace): Promise<DocumentContext>
    create(workspace: Workspace, input?: Partial<Pick<EditableDocument, 'name'|'docType'|'content'>>): Promise<DocumentContext>
    importDocument(workspace: Workspace, input: { name: string; docType: DocumentType; content: string }): Promise<DocumentContext>
    rename(workspace: Workspace, documentId: string, name: string): Promise<DocumentContext>
    switchTo(workspace: Workspace, targetDocumentId: string, currentDocument: EditableDocument): Promise<DocumentContext>
    save(workspace: Workspace, document: EditableDocument): Promise<void>
    delete(workspace: Workspace, documentId: string): Promise<DocumentDeleteResult>
    snapshotWorkspace(workspace: Workspace): Promise<SessionDocumentLibrarySnapshot>
  }

  function createDocumentService(deps: DocumentServiceDependencies): DocumentService
  ```

- [ ] **Step 1: Write failing resolve/repair tests**

  Pin:
  - Local valid selection loads selected doc;
  - Local missing meta repairs to legacy newest (`updatedAt DESC, id ASC`) exactly once;
  - Local invalid meta repairs;
  - Local no documents atomically creates `welcome.md` with `WELCOME_DOCUMENT`;
  - selection persistence failure returns usable selected body + warning and keeps current-session fallback rather than crashing;
  - Private no documents creates memory-only welcome doc and never calls durable document/selection writes.

- [ ] **Step 2: Write failing CRUD/switch/delete tests**

  Pin duplicate names allowed, rename validation exact limits, Private A→B→A lossless, Local switch saves old before selecting target, save failure blocks target selection, non-active delete preserves selection, active delete deterministic next/previous, last delete creates replacement, cross-Workspace target rejected.

- [ ] **Step 3: Run RED**

  Run: `bun run test -- tests/document/document-service.test.ts`

- [ ] **Step 4: Implement service**

  Stable normal order: `createdAt ASC, id ASC`. Only first Local repair without valid meta uses legacy newest ordering. Keep an in-service/session fallback selection for Local meta repair-write failures so subsequent operations in the tab do not repeatedly guess.

- [ ] **Step 5: Run GREEN + lint**

  Run: `bun run test -- tests/document/document-service.test.ts && bun run lint`

- [ ] **Step 6: Commit**

  `git commit -am "feat: add document library service"`

### Task 5: WorkspaceService Responsibility Extraction + Shared Application Runtime

**Files:**
- Create: `src/state/application-runtime.ts`
- Modify: `src/workspace/workspace-service.ts`
- Modify: `src/state/workspace-runtime.ts`
- Delete after migration: `src/workspace/session-document-store.ts`
- Modify/Delete: `tests/workspace/session-document-store.test.ts`
- Modify: `tests/workspace/workspace-service.test.ts`
- Modify: `tests/workspace/workspace-switch.test.ts`
- Modify: `tests/workspace/workspace-delete.test.ts`
- Create: `tests/document/application-runtime.test.ts`

**Interfaces:**
- Consumes: Task 2/4 stores/services.
- Produces:
  ```ts
  interface ApplicationRuntime {
    getStorageContext(): Promise<StorageContext>
    getSessionDocumentLibrary(): SessionDocumentLibraryStore
    getWorkspaceService(): Promise<WorkspaceService>
    getDocumentService(): Promise<DocumentService>
  }
  export const applicationRuntime: ApplicationRuntime
  ```
  `workspace-runtime.ts` temporarily re-exports `workspaceController` only; no second session library/service instances are allowed.

- [ ] **Step 1: Write failing shared-runtime test**

  Assert repeated calls and Workspace/Document consumers receive the exact same session library, storage context promise, and service instances, including Memory fallback.

- [ ] **Step 2: Rewrite WorkspaceService contract tests before implementation**

  New contract:
  - `switchTo(targetWorkspaceId)` changes Workspace selection/context only and accepts no current document;
  - `setStorageMode()` no longer receives a single current document; it delegates mode mutation using library snapshot parameters supplied by controller/application layer or exposes focused `enableLocalLibrary(workspaceId, documents, activeDocumentId)` / `makePrivate(workspaceId)` methods;
  - Workspace delete retains RuleProfile and leaves document body orchestration to atomic layer / controller.

- [ ] **Step 3: Run RED**

  Run: `bun run test -- tests/document/application-runtime.test.ts tests/workspace/workspace-service.test.ts tests/workspace/workspace-switch.test.ts tests/workspace/workspace-delete.test.ts`

- [ ] **Step 4: Implement runtime + extract document routing**

  Remove `newestDocument`, `SessionDocumentStore`, body save/load from WorkspaceService. Do not duplicate DocumentService logic in WorkspaceService.

- [ ] **Step 5: Remove old single-document session store**

  Delete old source/test only after all imports have migrated and `bun run lint` proves no references remain.

- [ ] **Step 6: Run GREEN + lint**

  Run Step 3 tests + `bun run lint`.

- [ ] **Step 7: Commit**

  `git commit -am "refactor: separate workspace and document services"`

### Task 6: Document State + DocumentController + Bootstrap

**Files:**
- Modify: `src/state/app-state.ts`
- Create: `src/state/document-controller.ts`
- Modify: `src/state/workspace-controller.ts`
- Modify: `src/app/App.tsx`
- Create: `tests/document/document-controller.test.ts`
- Modify: `tests/workspace/workspace-controller-ui.test.ts`
- Modify: `tests/workspace/workspace-regression.test.ts`

**Interfaces:**
- Consumes: `applicationRuntime`, `DocumentService`, `WorkspaceService`.
- Adds app state:
  ```ts
  documentSummaries(): DocumentSummary[]
  activeDocumentId(): string | undefined
  documentLibraryReady(): boolean
  documentMutationPending(): boolean
  documentSidebarOpen(): boolean
  documentFilter(): string
  ```
- Produces controller methods:
  ```ts
  interface DocumentController {
    bootstrapForWorkspace(workspace: Workspace): Promise<void>
    refresh(): Promise<void>
    createDocument(): Promise<void>
    renameActiveDocument(name: string): Promise<void>
    switchDocument(documentId: string): Promise<void>
    deleteActiveDocument(): Promise<void>
    importFile(file: File): Promise<void>
    flushActiveDocument(): Promise<void>
    currentEditableDocument(): EditableDocument
  }
  ```

- [ ] **Step 1: Write failing controller/bootstrap tests**

  Assert bootstrap resolves explicit active doc, fills summaries/id/editor projection, resets diagnostics and relints; Private bootstrap does not persist body; list failure opens recovery empty doc with error/warning state rather than throwing app-wide.

- [ ] **Step 2: Write failing CRUD orchestration tests**

  Assert each mutation toggles `documentMutationPending`, updates state only after service success, failures keep previous editor/selection, and switch resets diagnostics before relint.

- [ ] **Step 3: Run RED**

  Run: `bun run test -- tests/document/document-controller.test.ts tests/workspace/workspace-controller-ui.test.ts tests/workspace/workspace-regression.test.ts`

- [ ] **Step 4: Implement app state + DocumentController**

  Add one helper that applies a `DocumentContext` atomically to active ID, summaries and editor projection. Do not expose repositories/services on appState.

- [ ] **Step 5: Integrate App bootstrap**

  Workspace bootstrap resolves Workspace context, then DocumentController resolves active document before `workspaceReady/documentLibraryReady` become true.

- [ ] **Step 6: Run GREEN + lint**

  Run Step 3 tests + `bun run lint`.

- [ ] **Step 7: Commit**

  `git commit -am "feat: add document-aware application state"`

### Task 7: Explicit Workspace + Document Autosave

**Files:**
- Modify: `src/state/actions.ts`
- Modify: `src/components/EditorPane.tsx`
- Create: `tests/document/document-autosave.test.ts`
- Modify: `tests/storage/privacy-timer.test.ts`
- Modify: `tests/workspace/workspace-review-regression.test.ts`

**Interfaces:**
- Consumes: active Workspace ID, active Document ID, `DocumentService.save()`.
- Produces:
  ```ts
  interface DocumentPersistenceSnapshot {
    workspaceId: string
    documentId: string
    name: string
    content: string
    docType: DocumentType
    sourceKind: 'local' | 'file'
    createdAt: number
    updatedAt: number
  }

  persistDocumentDebounced(snapshot: DocumentPersistenceSnapshot): void
  cancelPendingDocumentPersistence(): void
  ```
  Remove active use of Phase 2B `persistWorkspaceDocumentDebounced(workspaceId, document)` and legacy `persistDocumentDebounced()` paths from EditorPane.

- [ ] **Step 1: Write race RED tests**

  With fake timers assert:
  - schedule A, switch editor state to B, fire timer => exact captured A snapshot saved;
  - schedule A then schedule A2 => only A2 saves;
  - schedule A then document/workspace switch cancel => no delayed write;
  - callback never queries current active Workspace/Document;
  - Private mode schedules no durable save.

- [ ] **Step 2: Run RED**

  Run: `bun run test -- tests/document/document-autosave.test.ts tests/storage/privacy-timer.test.ts tests/workspace/workspace-review-regression.test.ts`

- [ ] **Step 3: Implement snapshot-based debounce**

  `EditorPane` captures both IDs and full editable snapshot at edit time. If either active ID is unavailable, do not schedule persistence.

- [ ] **Step 4: Run GREEN + lint**

  Run Step 2 tests + `bun run lint`.

- [ ] **Step 5: Commit**

  `git commit -am "fix: bind autosave to workspace and document identity"`

### Task 8: Workspace Switch / Delete Integration with Active Documents

**Files:**
- Modify: `src/state/workspace-controller.ts`
- Modify: `src/state/application-runtime.ts`
- Modify: `tests/workspace/workspace-switch.test.ts`
- Modify: `tests/workspace/workspace-delete.test.ts`
- Create/Extend: `tests/document/document-regression.test.ts`

**Interfaces:**
- Consumes: `DocumentController.flushActiveDocument()`, `DocumentService.resolveActive()`, shared session library.
- Produces Workspace switch sequence from spec §21.

- [ ] **Step 1: Write failing integration tests**

  Pin Workspace A active A2 → B active B1 → A restores A2 for both Local and Private modes; current save failure prevents Workspace selection change; Workspace delete clears target Private session library only after durable/atomic delete success; active document meta for deleted Workspace is gone.

- [ ] **Step 2: Run RED**

  Run: `bun run test -- tests/workspace/workspace-switch.test.ts tests/workspace/workspace-delete.test.ts tests/document/document-regression.test.ts`

- [ ] **Step 3: Implement WorkspaceController orchestration**

  Exact order: cancel autosave → flush active doc → persist current config → switch Workspace selection/context → resolve target active doc → apply summaries/editor → diagnostics reset → relint.

- [ ] **Step 4: Run GREEN + lint**

  Run Step 2 tests + `bun run lint`.

- [ ] **Step 5: Commit**

  `git commit -am "feat: restore active documents across workspaces"`

### Task 9: Multi-document Storage Mode Transition

**Files:**
- Modify: `src/workspace/workspace-service.ts`
- Modify: `src/state/workspace-controller.ts`
- Modify: `src/document/document-service.ts`
- Modify: `tests/workspace/storage-mode-transition.test.ts`
- Extend: `tests/document/document-regression.test.ts`

**Interfaces:**
- Consumes Task 3 atomic signatures and Task 4 `snapshotWorkspace()`.
- Produces controller behavior:
  - Private→Local persists all session docs + active ID, then deletes session copy after commit.
  - Local→Private explicit flush, reads all Local docs + active ID, atomic scrub, then commits snapshot to session memory.

- [ ] **Step 1: Write failing transition integration tests**

  Assert 3+ documents survive Private→Local and Local→Private with active ID unchanged; unrelated Workspace untouched; failure injection at atomic operation preserves previous canonical source entirely; pending autosave is canceled before both transitions.

- [ ] **Step 2: Run RED**

  Run: `bun run test -- tests/workspace/storage-mode-transition.test.ts tests/document/document-regression.test.ts`

- [ ] **Step 3: Implement Private→Local orchestration**

  Flush current editor into session library first, snapshot library, call atomic `enableLocalLibrary()`, then delete only target Workspace session copy.

- [ ] **Step 4: Implement Local→Private orchestration**

  Flush Local active doc, load all target docs/selection into temporary snapshot, call atomic `makeWorkspacePrivate()`, then `replaceWorkspace()` in session store only on success.

- [ ] **Step 5: Run GREEN + lint**

  Run Step 2 tests + `bun run lint`.

- [ ] **Step 6: Commit**

  `git commit -am "feat: make privacy transitions multi-document safe"`

### Task 10: Open / Export Integration

**Files:**
- Modify: `src/state/actions.ts`
- Modify: `src/components/Header.tsx`
- Extend: `tests/document/document-controller.test.ts`
- Create/Extend: `tests/document/document-regression.test.ts`

**Interfaces:**
- `openDocumentFile(file)` delegates to `DocumentController.importFile(file)`; it no longer directly calls `appState.setDocument()`.
- `exportDocumentFile()` continues exporting only current active document projection.

- [ ] **Step 1: Write failing import tests**

  Assert supported extensions/import normalization, unsupported file rejection, current save/cancel happens before import, imported file becomes a new document (does not replace prior document), sidebar summaries gain one row, imported document becomes active, Private import never touches durable documents.

- [ ] **Step 2: Run RED**

  Run: `bun run test -- tests/document/document-controller.test.ts tests/document/document-regression.test.ts`

- [ ] **Step 3: Route Open through DocumentController**

  Keep existing line-ending normalization and `txt -> text`, other supported extensions -> `markdown` mapping.

- [ ] **Step 4: Verify Export remains active-only**

  Add test that multiple documents exist but generated download uses active document name/content only.

- [ ] **Step 5: Run GREEN + lint**

  Run Step 2 tests + `bun run lint`.

- [ ] **Step 6: Commit**

  `git commit -am "feat: import files into document library"`

### Task 11: Document Sidebar / Responsive / Accessibility

**Files:**
- Create: `src/components/DocumentSidebar.tsx`
- Modify: `src/components/Header.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/styles/global.css`
- Create: `tests/document/document-sidebar.test.ts`
- Modify: `src/state/app-state.ts`

**Interfaces:**
- Consumes DocumentController CRUD/switch and appState document signals.
- UI behavior:
  - Desktop `>=1280px`: 240px sidebar can remain open;
  - `1024-1279px`: default collapsed / left overlay;
  - `<1024px`: left drawer and diagnostics auxiliary panel mutually exclusive;
  - `<768px`: drawer width `min(320px, 90vw)`.

- [ ] **Step 1: Write failing pure UI/state tests**

  Without adding a new DOM test dependency, extract/test pure helpers/state transitions for:
  - case-insensitive name filter;
  - stable summary ordering unchanged by filter;
  - opening Documents below 1024 closes diagnostics;
  - opening diagnostics below 1024 closes Documents;
  - active row state uses document ID, not name.

- [ ] **Step 2: Run RED**

  Run: `bun run test -- tests/document/document-sidebar.test.ts`

- [ ] **Step 3: Implement Sidebar component**

  Use `<nav aria-label="Documents">`, semantic list, native row `<button>`, `aria-current="page"` for active row. Top/bottom controls: filter, New, Rename, Delete. No custom row context menu.

- [ ] **Step 4: Implement drawer/focus behavior**

  Header `Documents` toggle exposes `aria-expanded`. Drawer open moves focus to filter/New; close restores focus to toggle where practical using existing Solid refs. Delete confirmation never initial-focuses destructive control.

- [ ] **Step 5: Implement CSS breakpoints**

  Do not change existing Diagnostics mobile bottom-sheet behavior except mutual exclusion state.

- [ ] **Step 6: Run GREEN + lint + build**

  Run: `bun run test -- tests/document/document-sidebar.test.ts && bun run lint && bun run build`

- [ ] **Step 7: Commit**

  `git commit -am "feat: add responsive document library sidebar"`

### Task 12: Adversarial Regression / Compatibility Cleanup / Exact-head Gate

**Files:**
- Extend: `tests/document/document-regression.test.ts`
- Modify as needed: `tests/storage/storage-facade.test.ts`
- Modify as needed: `tests/workspace/workspace-regression.test.ts`
- Modify as needed: `tests/workspace/workspace-review-regression.test.ts`
- Modify as needed: `src/storage/storage.ts`
- Update: PR #6 body after implementation

**Interfaces:**
- No new public feature interface. This Task closes cross-boundary regressions and removes obsolete one-document compatibility paths from active product flow without breaking required legacy façade tests.

- [ ] **Step 1: Add adversarial tests for all Review Focus items**

  Must include:
  1. stale timer after document and Workspace navigation;
  2. corrupted/missing active-doc meta + repair write failure;
  3. atomic transition failure with 3 documents;
  4. delete active/last/non-active with second Workspace and snapshots present;
  5. Private mode through bootstrap/Open/config import/legacy façade never writes body/list/selection durably.

- [ ] **Step 2: Add Phase 2B compatibility regression**

  Verify existing migrated Local single record `local-recent-document:<workspaceId>` appears as one library document and first active repair chooses the Phase 2B newest record.

- [ ] **Step 3: Run focused regression**

  Run:
  `bun run test -- tests/document tests/storage tests/workspace`

  Expected: all PASS.

- [ ] **Step 4: Run full verification**

  ```bash
  bun ci
  bun run lint
  bun run test
  bun run build
  bun run build:pages
  grep -q '/japanese_text/assets/' dist/index.html
  grep -R -q '/japanese_text/assets/analysis.worker-' dist/assets
  ```

  Expected: every command exits 0.

- [ ] **Step 5: Fresh code review**

  Review full `main...HEAD` diff with focus on:
  - privacy leak;
  - IDB transaction lifetime;
  - stale save races;
  - service responsibility duplication;
  - cross-Workspace deletion;
  - UI focus/responsive regressions.

  For each finding, decide whether it is a true positive or false positive before changing code. Any true positive gets a failing regression test before the fix.

- [ ] **Step 6: Re-run exact-head CI**

  Push final fixes, record exact PR head SHA, and require GitHub Actions CI on that exact SHA to be GREEN before merge-ready declaration.

- [ ] **Step 7: Update PR #6**

  Change PR body from design-only to implemented Phase 2C-A summary, list test count/CI run, and mark remaining Phase 2C-B items explicitly deferred.

- [ ] **Step 8: Final commit if docs/cleanup changed**

  `git commit -am "test: harden multi-document regression coverage"`

## Execution Notes

- Tasks 1–4 establish persistence/domain boundaries; do not start UI work before these are GREEN.
- Task 5 is the architectural cutover point. Remove the old single-document session abstraction only after shared runtime tests prove one singleton library is used everywhere.
- Tasks 6–10 are strongly coupled through controller interfaces; preserve exact signatures from earlier Tasks rather than inventing parallel helpers.
- Task 11 must not add a DOM-testing dependency just for this phase. Test pure state/filter/panel logic with Vitest and rely on typecheck/build plus final manual code review for Solid markup semantics.
- Task 12 is mandatory before merge; no merge based only on task-local tests.
