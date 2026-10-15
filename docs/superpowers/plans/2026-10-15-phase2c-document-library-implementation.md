# Phase 2C-A Document Library / Sidebar / Multi-document Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 1 Workspace 内で複数 document を安全に作成・切替・改名・削除できる Document Library と Sidebar を追加し、Private Session / Local Library の privacy invariant を multi-document 対応へ拡張する。

**Architecture:** `WorkspaceService` から document body / active document selection の責務を分離し、新しい `DocumentService` と `DocumentController` に集約する。Local Library の active document selection は既存 IndexedDB `meta` store、Private Session の library / selection は共有 `SessionDocumentLibraryStore` の memory のみに保持し、autosave は `workspaceId + documentId + payload` を schedule 時点で固定する。Workspace switch / storage transition は controller 層で両 service を明示順序で orchestration する。

**Tech Stack:** SolidJS 1.9, TypeScript 7, Vite 8, Vitest 5, fake-indexeddb 6.2.5, CodeMirror 6, IndexedDB v2, native CSS, Bun 1.4.3

**Spec:** `docs/superpowers/specs/2026-10-15-phase2c-document-library-design.md`

## Global Constraints

- Backend / account / cloud sync / LLM を追加しない。
- 新規 dependency を追加しない。
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
- autosave destination は `workspaceId + documentId` の両方と document payload を capture し、callback 内で active selection / editor state を再解決しない。
- Document switch / Workspace switch / delete / storage mode transition / Open import の前に pending document autosave を cancel する。
- Private -> Local は session documents **全件** + active document ID + storage mode を atomic に commit する。
- Local -> Private は Local documents 全件を memory snapshot として読み取った後、persisted documents / snapshots / active document meta を atomic に scrub し、成功後だけ memory snapshot を canonical 化する。
- Phase 2C-A では snapshot を新規作成しない。既存 snapshot の cascade delete のみ維持する。
- folders / tags / tabs / body full-text search / History UI / file-backed / multi-tab sync は非対象。
- 全 product code は failing test → RED確認 → minimal implementation → GREEN確認 → commit の順で進める。
- 各Task完了時に対象test + `bun run lint` を実行する。Task 12でfull suite / build / Pages verificationを実行する。

## File Structure

### 新規

- `src/document/types.ts` — `EditableDocument`, `DocumentSummary`, `DocumentContext`, delete result 等のapplication projection。
- `src/document/session-document-library.ts` — Private Session 用 multi-document memory store。
- `src/document/document-service.ts` — document CRUD / active selection / body routing / repair。
- `src/state/document-controller.ts` — `appState` と `DocumentService` の orchestration、CRUD/import/switch。
- `src/state/application-runtime.ts` — StorageContext / SessionDocumentLibraryStore / WorkspaceService / DocumentService の共有singleton runtime。
- `src/components/DocumentSidebar.tsx` — document library UI / filter / CRUD controls / drawer。
- `tests/document/session-document-library.test.ts`
- `tests/document/document-service.test.ts`
- `tests/document/application-runtime.test.ts`
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
- `src/storage/db/schema.ts` — active document meta helper（DB version変更なし）。
- `src/storage/db/indexeddb-atomic-operations.ts` — create/delete/replacement/storage transition/workspace cleanup atomicity。
- `src/workspace/workspace-service.ts` — document routing責務を除去し、prepared library payloadを使うstorage policyへ変更。
- `src/state/workspace-controller.ts` — DocumentController/DocumentService と連携してWorkspace switch/delete/storage transitionをorchestrate。
- `src/state/workspace-runtime.ts` — compatibility compositionへ縮小し、共有runtimeは`application-runtime.ts`へ移す。
- `src/state/app-state.ts` — document library signals。
- `src/state/actions.ts` — explicit `workspaceId + documentId + payload` autosave、OpenをDocumentControllerへ委譲。
- `src/storage/storage.ts` — active product flowからsingle-recent document推測を除去し、必要なcompatibility façadeだけ残す。
- `src/components/EditorPane.tsx` — active document IDをschedule時点で取得してautosave。
- `src/components/Header.tsx` — Documents toggle、Open integration。
- `src/app/App.tsx` — DocumentSidebar配置 / bootstrap integration。
- `src/styles/global.css` — Sidebar / drawer / responsive layout。
- 既存 `src/workspace/session-document-store.ts` と対応test — 新runtime移行完了後に削除。
- Phase 2B workspace/storage tests — 新しいmulti-document contractへ更新し回帰を維持。

## Review Focus

1. **Stale save after navigation:** A を編集後に document/workspace を切替えても、遅延timerがBへ保存したりAを古いpayloadで上書きしない。Task 7でrace testを固定する。
2. **Selection corruption / write failure:** Local active-document meta が不存在・不正・書込失敗でも本文を失わず deterministic repair / current-session fallback が成立する。Task 4でfailure injection testを固定する。
3. **Partial privacy transition:** Private→Local / Local→Private の途中失敗で一部documentだけpersist/scrubされた状態を残さない。Task 3とTask 9でatomic failure testを固定する。
4. **Delete boundary:** active/last/non-active document削除で別Workspaceのdocuments/snapshots/selectionを触らず、successor/replacementが一意に決まる。Task 3・4でcross-workspace testを固定する。
5. **Private data leak through compatibility paths:** legacy recent-document façade / generic config save / Open / bootstrap がPrivate document list/body/selectionをdurable storageへ漏らさない。Task 12でadversarial regression testを固定する。

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
- Produces: `StorageRepositories.documentSelection: DocumentSelectionRepository`.
- Produces: `activeDocumentMetaKey(workspaceId: string): string`, exact value `active-document-id:<workspaceId>`.

- [ ] **Step 1: Write failing repository contract tests**

  Assert initial `undefined`, set/get round-trip, Workspace A/B isolation, target-only delete, empty `workspaceId` / `documentId` rejection.

- [ ] **Step 2: Run RED**

  Run: `bun run test -- tests/storage/document-selection.test.ts tests/storage/memory-repositories.test.ts tests/storage/indexeddb-repositories.test.ts`

  Expected: FAIL because `documentSelection` / `activeDocumentMetaKey()` do not exist.

- [ ] **Step 3: Add port + meta key helper**

  Add exact signatures above. Keep `DB_VERSION = 2` unchanged.

- [ ] **Step 4: Implement Memory + IndexedDB adapters**

  Memory uses Workspace-keyed selection map; IndexedDB uses `STORE_META` + `activeDocumentMetaKey(workspaceId)`.

- [ ] **Step 5: Run GREEN + typecheck**

  Run: `bun run test -- tests/storage/document-selection.test.ts tests/storage/memory-repositories.test.ts tests/storage/indexeddb-repositories.test.ts && bun run lint`

  Expected: PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add src/storage/repositories/ports.ts src/storage/repositories/memory.ts src/storage/repositories/indexeddb.ts src/storage/db/schema.ts tests/storage/document-selection.test.ts tests/storage/repository-contract.ts tests/storage/memory-repositories.test.ts tests/storage/indexeddb-repositories.test.ts
  git commit -m "feat: add active document selection storage"
  ```

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

  Expected: module/API missing.

- [ ] **Step 3: Implement types + store**

  Every public read/write boundary clones. `replaceWorkspace()` validates that `activeDocumentId` exists in supplied documents before replacing target Workspace state.

- [ ] **Step 4: Run GREEN + lint**

  Run: `bun run test -- tests/document/session-document-library.test.ts && bun run lint`

- [ ] **Step 5: Commit**

  ```bash
  git add src/document/types.ts src/document/session-document-library.ts tests/document/session-document-library.test.ts
  git commit -m "feat: add private session document library"
  ```

### Task 3: Atomic Document Operations + Multi-document Privacy Transactions

**Files:**
- Modify: `src/storage/repositories/ports.ts`
- Modify: `src/storage/repositories/memory.ts`
- Modify: `src/storage/db/indexeddb-atomic-operations.ts`
- Create: `tests/storage/document-atomic-operations.test.ts`
- Modify: `tests/storage/privacy-deletion-atomic.test.ts`
- Modify: `tests/workspace/storage-mode-transition.test.ts`
- Modify: `tests/workspace/legacy-privacy-scrub.test.ts`
- Modify: `tests/workspace/workspace-delete.test.ts`

**Interfaces:**
- Consumes: Task 1 `documentSelection` / `activeDocumentMetaKey()`.
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
- Existing `deleteWorkspaceCascade()` / `deleteWorkspaceAndSelectNext()` also delete target Workspace active-document meta.

- [ ] **Step 1: Write failing atomic tests**

  Assert create atomicity, active delete + snapshot cascade + successor selection, cross-Workspace successor rejection, last-document replacement, all-document Private→Local, full Local→Private scrub, unrelated Workspace isolation, Workspace delete meta cleanup, and existing migrated legacy recent scrub scope.

- [ ] **Step 2: Run RED**

  Run: `bun run test -- tests/storage/document-atomic-operations.test.ts tests/storage/privacy-deletion-atomic.test.ts tests/workspace/storage-mode-transition.test.ts tests/workspace/legacy-privacy-scrub.test.ts tests/workspace/workspace-delete.test.ts`

- [ ] **Step 3: Update `AtomicOperationsPort`**

  Replace Phase 2B one-document `enableLocalLibrary`; do not keep a one-document overload.

- [ ] **Step 4: Implement Memory atomic semantics**

  Validate into projected copies for workspaces/documents/selections; publish state only after every validation succeeds.

- [ ] **Step 5: Implement IndexedDB atomic semantics**

  Each operation uses one transaction spanning all touched stores. Validate target Workspace, document ownership, successor ownership, and active ID membership before commit.

- [ ] **Step 6: Run GREEN + lint**

  Run Step 2 command + `bun run lint`.

- [ ] **Step 7: Commit**

  ```bash
  git add src/storage/repositories/ports.ts src/storage/repositories/memory.ts src/storage/db/indexeddb-atomic-operations.ts tests/storage/document-atomic-operations.test.ts tests/storage/privacy-deletion-atomic.test.ts tests/workspace/storage-mode-transition.test.ts tests/workspace/legacy-privacy-scrub.test.ts tests/workspace/workspace-delete.test.ts
  git commit -m "feat: add atomic multi-document storage operations"
  ```

### Task 4: DocumentService — Resolve / Repair / CRUD / Switch

**Files:**
- Create: `src/document/document-service.ts`
- Modify: `src/document/types.ts`
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
    create(workspace: Workspace, input?: Partial<Pick<EditableDocument, 'name' | 'docType' | 'content'>>): Promise<DocumentContext>
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

  Pin Local valid selection, missing/invalid meta repair, legacy newest first repair, Local no-doc welcome creation, repair-write failure with usable current-session fallback, and Private no-doc memory-only welcome creation.

- [ ] **Step 2: Write failing CRUD/switch/delete tests**

  Pin duplicate names, exact rename validation, Private A→B→A lossless, Local switch saves old before selection change, save failure blocks switch, cross-Workspace target rejection, deterministic delete successor, last delete replacement, non-active delete selection preservation.

- [ ] **Step 3: Run RED**

  Run: `bun run test -- tests/document/document-service.test.ts`

- [ ] **Step 4: Implement service**

  Normal order is `createdAt ASC, id ASC`. Only first Local repair without valid meta uses `updatedAt DESC, id ASC`. Keep a DocumentService-local selection fallback for Local repair write failures so the same tab does not repeatedly guess active selection.

- [ ] **Step 5: Run GREEN + lint**

  Run: `bun run test -- tests/document/document-service.test.ts && bun run lint`

- [ ] **Step 6: Commit**

  ```bash
  git add src/document/document-service.ts src/document/types.ts tests/document/document-service.test.ts
  git commit -m "feat: add document library service"
  ```

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
- Produces shared runtime:
  ```ts
  interface ApplicationRuntime {
    getStorageContext(): Promise<StorageContext>
    getSessionDocumentLibrary(): SessionDocumentLibraryStore
    getWorkspaceService(): Promise<WorkspaceService>
    getDocumentService(): Promise<DocumentService>
  }

  export const applicationRuntime: ApplicationRuntime
  ```
- Fixes WorkspaceService document-free navigation/storage contract:
  ```ts
  switchTo(targetWorkspaceId: string): Promise<WorkspaceSwitchResult>

  enableLocalLibrary(
    workspaceId: string,
    documents: StoredWorkspaceDocument[],
    activeDocumentId: string
  ): Promise<WorkspaceContext>

  makePrivate(workspaceId: string): Promise<WorkspaceContext>
  ```
- `WorkspaceSwitchResult` contains Workspace context + optional warning only; no document body.

- [ ] **Step 1: Write failing shared-runtime test**

  Assert repeated calls and Workspace/Document consumers receive the exact same session library, storage context promise, WorkspaceService instance and DocumentService instance, including Memory fallback.

- [ ] **Step 2: Rewrite WorkspaceService contract tests**

  Assert `switchTo()` accepts no current document and does no document read/write; `enableLocalLibrary()` accepts prepared whole-library payload; `makePrivate()` performs policy/atomic delegation but no session-memory staging; delete retains RuleProfile.

- [ ] **Step 3: Run RED**

  Run: `bun run test -- tests/document/application-runtime.test.ts tests/workspace/workspace-service.test.ts tests/workspace/workspace-switch.test.ts tests/workspace/workspace-delete.test.ts`

- [ ] **Step 4: Implement runtime + extract document routing**

  Remove `newestDocument`, `SessionDocumentStore`, body save/load and current document parameters from WorkspaceService. Do not duplicate DocumentService routing logic.

- [ ] **Step 5: Remove old single-document session store**

  Delete source/test only after all imports migrate and `bun run lint` proves no references remain.

- [ ] **Step 6: Run GREEN + lint**

  Run Step 3 tests + `bun run lint`.

- [ ] **Step 7: Commit**

  ```bash
  git add -A src/state/application-runtime.ts src/workspace/workspace-service.ts src/state/workspace-runtime.ts src/workspace/session-document-store.ts tests/workspace/session-document-store.test.ts tests/workspace/workspace-service.test.ts tests/workspace/workspace-switch.test.ts tests/workspace/workspace-delete.test.ts tests/document/application-runtime.test.ts
  git commit -m "refactor: separate workspace and document services"
  ```

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
- Adds app state:
  ```ts
  documentSummaries(): DocumentSummary[]
  activeDocumentId(): string | undefined
  documentLibraryReady(): boolean
  documentMutationPending(): boolean
  documentSidebarOpen(): boolean
  documentFilter(): string
  ```
- Produces:
  ```ts
  interface DocumentController {
    bootstrapForWorkspace(workspace: Workspace): Promise<void>
    refresh(workspace: Workspace): Promise<void>
    createDocument(): Promise<void>
    renameActiveDocument(name: string): Promise<void>
    switchDocument(documentId: string): Promise<void>
    deleteActiveDocument(): Promise<void>
    importFile(file: File): Promise<void>
    flushActiveDocument(): Promise<void>
    currentEditableDocument(): EditableDocument
  }
  ```

- [ ] **Step 1: Write failing bootstrap tests**

  Assert Workspace bootstrap then document resolve fills summaries/id/editor projection, resets diagnostics and relints; Private bootstrap performs no durable body/selection write; list/load failure opens a usable empty recovery document and reports warning/error without app-wide crash.

- [ ] **Step 2: Write failing CRUD orchestration tests**

  Assert mutation pending lifecycle, successful context apply, failure preserves previous editor/selection, and document switch resets stale diagnostics before relint.

- [ ] **Step 3: Run RED**

  Run: `bun run test -- tests/document/document-controller.test.ts tests/workspace/workspace-controller-ui.test.ts tests/workspace/workspace-regression.test.ts`

- [ ] **Step 4: Implement state + DocumentController**

  Add one internal `applyDocumentContext()` helper that updates active ID, summaries, document text/name/type/revision and diagnostics context in one controller step. appState stores no repositories/services.

- [ ] **Step 5: Integrate App/Workspace bootstrap**

  Workspace context resolves first; DocumentController resolves active document before ready flags are true and before initial relint.

- [ ] **Step 6: Run GREEN + lint**

  Run Step 3 tests + `bun run lint`.

- [ ] **Step 7: Commit**

  ```bash
  git add src/state/app-state.ts src/state/document-controller.ts src/state/workspace-controller.ts src/app/App.tsx tests/document/document-controller.test.ts tests/workspace/workspace-controller-ui.test.ts tests/workspace/workspace-regression.test.ts
  git commit -m "feat: add document-aware application state"
  ```

### Task 7: Explicit Workspace + Document Autosave

**Files:**
- Modify: `src/state/actions.ts`
- Modify: `src/components/EditorPane.tsx`
- Create: `tests/document/document-autosave.test.ts`
- Modify: `tests/storage/privacy-timer.test.ts`
- Modify: `tests/workspace/workspace-review-regression.test.ts`

**Interfaces:**
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
- Active product path no longer uses Phase 2B `persistWorkspaceDocumentDebounced(workspaceId, document)` / legacy `persistDocumentDebounced()` from EditorPane.

- [ ] **Step 1: Write failing race tests**

  With fake timers assert schedule A → state changes to B → timer saves exact captured A; A then A2 only saves A2; navigation/delete/transition cancellation prevents delayed write; callback never queries current active IDs; Private mode does no durable save.

- [ ] **Step 2: Run RED**

  Run: `bun run test -- tests/document/document-autosave.test.ts tests/storage/privacy-timer.test.ts tests/workspace/workspace-review-regression.test.ts`

- [ ] **Step 3: Implement snapshot-based debounce**

  `EditorPane` captures both active IDs and full document payload at edit time. If either ID is unavailable, do not schedule persistence.

- [ ] **Step 4: Run GREEN + lint**

  Run Step 2 tests + `bun run lint`.

- [ ] **Step 5: Commit**

  ```bash
  git add src/state/actions.ts src/components/EditorPane.tsx tests/document/document-autosave.test.ts tests/storage/privacy-timer.test.ts tests/workspace/workspace-review-regression.test.ts
  git commit -m "fix: bind autosave to workspace and document identity"
  ```

### Task 8: Workspace Switch / Delete Integration with Active Documents

**Files:**
- Modify: `src/state/workspace-controller.ts`
- Modify: `src/state/application-runtime.ts`
- Modify: `tests/workspace/workspace-switch.test.ts`
- Modify: `tests/workspace/workspace-delete.test.ts`
- Create/Modify: `tests/document/document-regression.test.ts`

**Interfaces:**
- Consumes: `DocumentController.flushActiveDocument()`, `DocumentService.resolveActive()`, shared session library.
- Workspace switch exact order: cancel autosave → flush active document → persist current config/profile → WorkspaceService switch → resolve target active document → apply Workspace + document state → diagnostics reset → relint.

- [ ] **Step 1: Write failing integration tests**

  Pin Workspace A active A2 → B active B1 → A restores A2 for Local and Private; current save failure prevents Workspace selection change; Workspace delete clears target Private session library only after durable/atomic delete success; deleted Workspace active-doc meta is gone; other Workspace is untouched.

- [ ] **Step 2: Run RED**

  Run: `bun run test -- tests/workspace/workspace-switch.test.ts tests/workspace/workspace-delete.test.ts tests/document/document-regression.test.ts`

- [ ] **Step 3: Implement WorkspaceController orchestration**

  Remove old single-document `currentEditorDocument()` routing from WorkspaceController where DocumentController now owns it.

- [ ] **Step 4: Run GREEN + lint**

  Run Step 2 tests + `bun run lint`.

- [ ] **Step 5: Commit**

  ```bash
  git add src/state/workspace-controller.ts src/state/application-runtime.ts tests/workspace/workspace-switch.test.ts tests/workspace/workspace-delete.test.ts tests/document/document-regression.test.ts
  git commit -m "feat: restore active documents across workspaces"
  ```

### Task 9: Multi-document Storage Mode Transition

**Files:**
- Modify: `src/workspace/workspace-service.ts`
- Modify: `src/state/workspace-controller.ts`
- Modify: `src/document/document-service.ts`
- Modify: `tests/workspace/storage-mode-transition.test.ts`
- Modify: `tests/document/document-regression.test.ts`

**Interfaces:**
- Consumes Task 3 atomic signatures, Task 4 `snapshotWorkspace()`, Task 5 `WorkspaceService.enableLocalLibrary()` / `makePrivate()`.
- Private→Local: cancel → flush active editor to session → snapshot all session docs → service atomic enable(all docs + active ID) → delete target session Workspace after success.
- Local→Private: cancel → explicit Local save → snapshot all Local docs + active ID → service atomic scrub → publish snapshot to session store after success.

- [ ] **Step 1: Write failing transition integration tests**

  Assert 3+ documents survive both directions with active ID unchanged; unrelated Workspace untouched; atomic failure preserves previous canonical source entirely; pending autosave is canceled before both transitions.

- [ ] **Step 2: Run RED**

  Run: `bun run test -- tests/workspace/storage-mode-transition.test.ts tests/document/document-regression.test.ts`

- [ ] **Step 3: Implement Private→Local orchestration**

  Session Workspace copy is deleted only after atomic Local commit succeeds.

- [ ] **Step 4: Implement Local→Private orchestration**

  Temporary snapshot is not published to session library until atomic scrub succeeds.

- [ ] **Step 5: Run GREEN + lint**

  Run Step 2 tests + `bun run lint`.

- [ ] **Step 6: Commit**

  ```bash
  git add src/workspace/workspace-service.ts src/state/workspace-controller.ts src/document/document-service.ts tests/workspace/storage-mode-transition.test.ts tests/document/document-regression.test.ts
  git commit -m "feat: make privacy transitions multi-document safe"
  ```

### Task 10: Open / Export Integration + Compatibility Façade Cleanup

**Files:**
- Modify: `src/state/actions.ts`
- Modify: `src/components/Header.tsx`
- Modify: `src/storage/storage.ts`
- Modify: `tests/storage/storage-facade.test.ts`
- Modify: `tests/document/document-controller.test.ts`
- Modify: `tests/document/document-regression.test.ts`

**Interfaces:**
- `openDocumentFile(file)` delegates to `DocumentController.importFile(file)` and never directly replaces editor state.
- `exportDocumentFile()` exports current active editor projection only.
- Current App/Header/Editor/runtime path must not call single-recent document helpers or infer active document from `newestDocument()`.

- [ ] **Step 1: Write failing import tests**

  Assert supported extension normalization, unsupported rejection, current flush before import, imported file creates a new document and becomes active, previous document remains, summaries gain one item, Private import never persists library durably.

- [ ] **Step 2: Write compatibility test**

  Assert Export uses only active name/content when multiple documents exist, and required legacy config/storage façade tests still pass.

- [ ] **Step 3: Run RED**

  Run: `bun run test -- tests/document/document-controller.test.ts tests/document/document-regression.test.ts tests/storage/storage-facade.test.ts`

- [ ] **Step 4: Rewire Open and narrow document compatibility façade**

  Keep config façade behavior. Remove only active production dependencies on single-recent document helpers; do not perform unrelated storage refactor.

- [ ] **Step 5: Run GREEN + lint**

  Run Step 3 tests + `bun run lint`.

- [ ] **Step 6: Commit**

  ```bash
  git add src/state/actions.ts src/components/Header.tsx src/storage/storage.ts tests/storage/storage-facade.test.ts tests/document/document-controller.test.ts tests/document/document-regression.test.ts
  git commit -m "feat: import files into document library"
  ```

### Task 11: Document Sidebar / Responsive / Accessibility

**Files:**
- Create: `src/components/DocumentSidebar.tsx`
- Modify: `src/components/Header.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/styles/global.css`
- Modify: `src/state/app-state.ts`
- Create: `tests/document/document-sidebar.test.ts`

**Interfaces:**
- Sidebar consumes only appState projections + DocumentController actions.
- Desktop `>=1280px`: 240px Sidebar can remain open.
- `1024-1279px`: Sidebar default collapsed / left overlay; Diagnostics remains existing right panel behavior.
- `<1024px`: Documents and Diagnostics auxiliary panels are mutually exclusive.
- `<768px`: Sidebar drawer width `min(320px, 90vw)`; Diagnostics remains existing bottom sheet.

- [ ] **Step 1: Write failing pure UI/state tests**

  Without adding a DOM-testing dependency, test case-insensitive name filter, stable order preservation, active row by document ID not name, and panel mutual-exclusion state transitions.

- [ ] **Step 2: Run RED**

  Run: `bun run test -- tests/document/document-sidebar.test.ts`

- [ ] **Step 3: Implement Sidebar markup**

  Use `<nav aria-label="Documents">`, semantic list, native row `<button>`, `aria-current="page"` for active row, filter + New + Rename + Delete controls. Do not add custom row context menu.

- [ ] **Step 4: Implement drawer/focus behavior**

  Header Documents toggle exposes `aria-expanded`; drawer close restores focus to toggle where practical; Delete dialog initial focus is non-destructive.

- [ ] **Step 5: Implement responsive CSS**

  Do not change existing Diagnostics bottom-sheet semantics except mutual exclusion state.

- [ ] **Step 6: Run GREEN + lint + build**

  Run: `bun run test -- tests/document/document-sidebar.test.ts && bun run lint && bun run build`

- [ ] **Step 7: Commit**

  ```bash
  git add src/components/DocumentSidebar.tsx src/components/Header.tsx src/app/App.tsx src/styles/global.css src/state/app-state.ts tests/document/document-sidebar.test.ts
  git commit -m "feat: add responsive document library sidebar"
  ```

### Task 12: Adversarial Regression / Compatibility Cleanup / Exact-head Gate

**Files:**
- Modify: `tests/document/document-regression.test.ts`
- Modify as needed: `tests/storage/storage-facade.test.ts`
- Modify as needed: `tests/storage/migration-v1-v2.test.ts`
- Modify as needed: `tests/storage/migration-failure.test.ts`
- Modify as needed: `tests/workspace/workspace-regression.test.ts`
- Modify as needed: `tests/workspace/workspace-review-regression.test.ts`
- Modify as needed: `src/storage/storage.ts`
- Update PR #6 body/status after implementation.

**Interfaces:**
- No new public feature interface. This Task closes cross-boundary regressions and proves exact branch head readiness.

- [ ] **Step 1: Add adversarial tests for all Review Focus items**

  Must include stale timer after document+Workspace navigation; corrupt/missing active-doc meta + repair write failure; atomic transition failure with 3 documents; active/last/non-active delete with second Workspace and snapshots present; Private mode through bootstrap/Open/config import/legacy compatibility never writes body/list/selection durably.

- [ ] **Step 2: Add Phase 2B compatibility regression**

  Verify existing `local-recent-document:<workspaceId>` remains one library document and missing active meta first repair chooses Phase 2B newest record.

- [ ] **Step 3: Run focused regression**

  Run: `bun run test -- tests/document tests/storage tests/workspace`

  Expected: PASS.

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

  Expected: every command exits `0`.

- [ ] **Step 5: Fresh whole-branch review**

  Review `main...HEAD` for privacy leaks, IDB transaction lifetime, stale save races, duplicated service responsibility, cross-Workspace deletion, accessibility/responsive regressions. Classify every finding as true/false positive before change; every true positive gets a failing regression test before fix.

- [ ] **Step 6: Commit regression fixes if any**

  ```bash
  git add -A
  git commit -m "test: harden multi-document regression coverage"
  ```

  Skip commit only when no file changed.

- [ ] **Step 7: Verify exact-head GitHub CI**

  Record exact PR head SHA; require CI on that exact SHA GREEN, unresolved review threads `0`, and Pages asset-path verification GREEN before merge-ready declaration.

- [ ] **Step 8: Update PR #6**

  Change body from design/plan-only to implemented Phase 2C-A summary, test count, exact head SHA, CI run ID, and explicit Phase 2C-B deferred scope. Mark ready only after evidence. Do not merge without explicit user instruction.

## Execution Notes

- Tasks 1–4 establish persistence/domain boundaries; do not start UI work before they are GREEN.
- Task 5 is the architectural cutover. Remove old single-document session abstraction only after shared runtime tests prove one singleton library is used everywhere.
- Tasks 6–10 are strongly coupled through controller interfaces; preserve exact signatures from prior Tasks rather than creating parallel helpers.
- Task 11 must not add a DOM-testing dependency just for this phase. Test pure filter/panel state with Vitest and rely on typecheck/build plus final code review for Solid markup semantics.
- Task 12 is mandatory before merge; task-local tests alone are insufficient.
- Use `superpowers:test-driven-development` for every product-code Task.
- Use `superpowers:systematic-debugging` for unexpected failures before proposing fixes.
- Use `superpowers:verification-before-completion` before claiming Phase 2C-A complete.
- Merge is a separate side effect and requires explicit user authorization.
