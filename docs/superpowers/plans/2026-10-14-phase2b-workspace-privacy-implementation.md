# Phase 2B Workspace / Privacy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 2A の local-first storage foundation 上に、複数 Workspace の create / switch / rename / delete、Private Session / Local Library の安全な切替、browser storage capability 表示を追加する。

**Architecture:** `Workspace.storageMode` を本文永続化 policy の canonical source とし、`AppConfig.privacy` は互換 view としてのみ扱う。UI は repository / IndexedDB を直接操作せず `WorkspaceService` と state controller を経由する。Private Session 本文は Workspace ごとの `SessionDocumentStore` に同一タブ内だけ保持し、Local Library 本文のみ IndexedDB に保存する。active Workspace ID は既存 `meta` store に保持し、複数 store を跨ぐ create/delete/privacy transition は `AtomicOperationsPort` 内の単一 transaction で確定する。

**Tech Stack:** TypeScript 7、SolidJS 1.9、Vitest 5、IndexedDB、`fake-indexeddb@6.2.5`、Bun 1.4.3、Vite 8、Web StorageManager API（feature detection only）。

**Spec:** `docs/superpowers/specs/2026-10-14-phase2b-workspace-privacy-design.md`

## Global Constraints

- LLM / AI / Backend / Login / Cloud Sync を追加しない。
- 本文を server / external API へ送信しない。
- 新規 Workspace の既定値は必ず `private-session`。
- `local-library` は明示 user gesture / opt-in でのみ有効化する。
- `file-backed` は domain model 上の予約値のまま。Phase 2B UI では選択させない。
- `Workspace.storageMode` を canonical source とし、Settings と Workspace UI に別々の privacy state を持たせない。
- `AppConfig.privacy` は worker / import / legacy compatibility のため残すが、通常 UI から独立 mutation しない。
- DB name/version は Phase 2A の `japanese-writing-toolkit` / v2 を維持する。Phase 2B のためだけに DB version を上げない。
- active Workspace ID は `meta/active-workspace-id` に保存する。
- Private Session document は IndexedDB / localStorage / sessionStorage に保存しない。module-memory のみ。
- origin usage/quota は「このアプリの正確な容量」と表示しない。
- `navigator.storage.persist()` の拒否は Local Library 利用不可を意味しない。
- IndexedDB unavailable/open/migration failure の Memory fallback でも Workspace create/switch/rename/delete は session 内で動作する。
- Memory fallback では Local Library を有効化しない。
- existing v1 migration / Phase 2A repository / privacy regression を壊さない。
- IndexedDB transaction 内で dependent write を `await` 後に新規 enqueue しない。必要な dependent requests は request callback 内で queue する。
- RuleProfile は Workspace delete 時に自動削除しない。
- document library/sidebar、suppression UI、RuleProfile管理UI、multi-tab sync は非対象。
- product code は failing test → minimal implementation → passing test の順で進める。

## Review Focus

1. **StorageContext 分裂:** durable / Memory fallback のどちらでも legacy `storage.ts` と WorkspaceService が同一 context を共有し、別々の in-memory state を作らないこと。
2. **Active selection repair:** missing/corrupt/deleted active ID、0 Workspace、migration直後を安全に修復し、`workspaces[0]` 依存を残さないこと。
3. **Autosave switch race:** debounce schedule 後に Workspace を切り替えても old document が new Workspace に保存されないこと。save先は schedule-time `workspaceId` を capture すること。
4. **Privacy transition:** Local -> Private 時に queued autosave を先に停止し、mode change + document/snapshot scrub が partial commit にならないこと。
5. **Workspace deletion:** 最後の1件を削除せず、active削除時は successor selection + cascade deletionを同一 transaction で確定すること。
6. **Private Session loss:** A→B→A の切替で同一タブ内の Private Session 本文を復元し、IndexedDBには本文が存在しないこと。
7. **StorageManager failure:** `estimate` / `persisted` / `persist` が未対応・throw・rejectしても app を停止せず、origin-level estimate としてだけ表示すること。

---

## File Map

**Create**

- `src/storage/runtime.ts` — single StorageContext runtime。
- `src/workspace/session-document-store.ts` — Private Session transient body store。
- `src/workspace/workspace-service.ts` — Workspace application service。
- `src/workspace/storage-capability.ts` — StorageManager adapter。
- `src/state/workspace-controller.ts` — `WorkspaceService` と Solid state/editor を接続。
- `src/components/WorkspaceSwitcher.tsx` — Header workspace selection/create/manage entry。
- `src/components/WorkspaceManageDialog.tsx` — rename/storage/delete/capability UI。
- `tests/storage/workspace-selection.test.ts`
- `tests/workspace/session-document-store.test.ts`
- `tests/workspace/workspace-service.test.ts`
- `tests/workspace/workspace-switch.test.ts`
- `tests/workspace/workspace-delete.test.ts`
- `tests/workspace/storage-mode-transition.test.ts`
- `tests/workspace/storage-capability.test.ts`
- `tests/workspace/workspace-regression.test.ts`

**Modify**

- `src/storage/repositories/ports.ts`
- `src/storage/repositories/memory.ts`
- `src/storage/repositories/indexeddb.ts`
- `src/storage/db/schema.ts`
- `src/storage/db/indexeddb-atomic-operations.ts`
- `src/storage/bootstrap.ts`
- `src/storage/storage.ts`
- `src/state/app-state.ts`
- `src/state/actions.ts`
- `src/app/App.tsx`
- `src/components/Header.tsx`
- `src/components/SettingsDialog.tsx`
- `src/components/StatusBar.tsx`
- `src/styles/global.css`
- existing `tests/storage/*.test.ts` where regression coverage belongs。

---

### Task 1: Shared Storage Runtime + Active Workspace Selection Port

**Files:**
- Create: `src/storage/runtime.ts`
- Modify: `src/storage/repositories/ports.ts`
- Modify: `src/storage/repositories/memory.ts`
- Modify: `src/storage/repositories/indexeddb.ts`
- Modify: `src/storage/db/schema.ts`
- Modify: `src/storage/bootstrap.ts`
- Modify: `src/storage/storage.ts`
- Test: `tests/storage/workspace-selection.test.ts`
- Test: `tests/storage/storage-facade.test.ts`

**Interfaces:**

```ts
export const META_ACTIVE_WORKSPACE_ID = 'active-workspace-id'

interface WorkspaceSelectionRepository {
  getActiveWorkspaceId(): Promise<string | undefined>
  setActiveWorkspaceId(workspaceId: string): Promise<void>
}

interface StorageRepositories {
  workspaces: WorkspaceRepository
  preferences: PreferencesRepository
  profiles: RuleProfileRepository
  documents: DocumentRepository
  selection: WorkspaceSelectionRepository
}

function getStorageContext(): Promise<StorageContext>
function resetStorageRuntimeForTests(): void
```

- [ ] **Step 1: Write failing tests**

Add contract assertions for Memory + IndexedDB selection repositories:

```ts
expect(await repositories.selection.getActiveWorkspaceId()).toBeUndefined()
await repositories.selection.setActiveWorkspaceId('ws-a')
expect(await repositories.selection.getActiveWorkspaceId()).toBe('ws-a')
```

Add a regression proving `storage.ts` and a second consumer of `getStorageContext()` share the exact same Memory fallback state. Mutate workspace name through the context, then assert `loadConfig()` / active-state helper sees that same workspace instead of a separately seeded context.

- [ ] **Step 2: Run RED**

```bash
bun run test -- tests/storage/workspace-selection.test.ts tests/storage/storage-facade.test.ts
```

Expected: FAIL because selection port/runtime do not exist and façade still owns a private `contextPromise`.

- [ ] **Step 3: Implement minimal selection repositories and singleton runtime**

`src/storage/runtime.ts` owns the only module-level context promise. `storage.ts` must consume it instead of defining its own promise. Memory fallback selection state stays in memory; IndexedDB uses `STORE_META`.

Do not expose `IDBDatabase` to UI components.

- [ ] **Step 4: Verify GREEN**

```bash
bun run test -- tests/storage/workspace-selection.test.ts tests/storage/storage-facade.test.ts
bun run lint
```

- [ ] **Step 5: Commit**

```bash
git add src/storage tests/storage/workspace-selection.test.ts tests/storage/storage-facade.test.ts
git commit -m "feat: add shared storage runtime and workspace selection"
```

---

### Task 2: Active Selection Resolver / Repair

**Files:**
- Create: `src/workspace/workspace-service.ts` (initial resolver only)
- Modify: `src/storage/bootstrap.ts`
- Test: `tests/storage/workspace-selection.test.ts`
- Test: `tests/workspace/workspace-service.test.ts`

**Initial service types:**

```ts
interface WorkspaceContext {
  workspace: Workspace
  profile: RuleProfile
  preferences: GlobalPreferences
  config: AppConfig
}

function createWorkspaceService(deps: WorkspaceServiceDependencies): WorkspaceService
```

Active resolution order:

1. read `selection.getActiveWorkspaceId()`;
2. if ID exists and referenced Workspace validates, use it;
3. otherwise stable-sort Workspace by `createdAt`, then `id`;
4. select first valid Workspace and repair active ID;
5. if none exist, create default private Workspace/profile and select it without crashing app boot.

For the zero-workspace recovery, use a dedicated service helper first; Task 3 will replace sequential create/save with the atomic create-and-activate operation.

- [ ] **Step 1: Write failing tests**

Cover:

- valid active ID is respected even when it is not the first repository record;
- missing active ID repairs to stable-first Workspace;
- active ID referencing deleted Workspace repairs;
- two equal timestamps use `id` as deterministic tie-breaker;
- zero workspaces recover to default `private-session` state;
- recovered `AppConfig.privacy` is private compatibility state.

- [ ] **Step 2: Run RED**

```bash
bun run test -- tests/workspace/workspace-service.test.ts tests/storage/workspace-selection.test.ts
```

- [ ] **Step 3: Implement resolver and change `storage.ts` active lookup**

Remove `workspaces[0]` semantics from `storage.ts`. All active-state reads must resolve through the selection repository/helper.

- [ ] **Step 4: Verify GREEN + migration regression**

```bash
bun run test -- tests/workspace/workspace-service.test.ts tests/storage/storage-facade.test.ts tests/storage/migration-v1-v2.test.ts
bun run lint
```

- [ ] **Step 5: Commit**

```bash
git add src/workspace src/storage tests/workspace tests/storage
git commit -m "feat: resolve and repair active workspace selection"
```

---

### Task 3: SessionDocumentStore + Workspace Create / List / Rename

**Files:**
- Create: `src/workspace/session-document-store.ts`
- Modify: `src/workspace/workspace-service.ts`
- Modify: `src/storage/repositories/ports.ts`
- Modify: `src/storage/repositories/memory.ts`
- Modify: `src/storage/db/indexeddb-atomic-operations.ts`
- Test: `tests/workspace/session-document-store.test.ts`
- Test: `tests/workspace/workspace-service.test.ts`

**Session types:**

```ts
interface SessionDocument {
  name: string
  content: string
  docType: DocumentType
  updatedAt: number
}

interface SessionDocumentStore {
  get(workspaceId: string): SessionDocument | undefined
  set(workspaceId: string, document: SessionDocument): void
  delete(workspaceId: string): void
  clear(): void
}
```

**New atomic operation:**

```ts
createWorkspaceAndActivate(workspace: Workspace, profile: RuleProfile): Promise<void>
```

**Service operations:**

```ts
list(): Promise<WorkspaceSummary[]>
create(input: { name: string }): Promise<WorkspaceContext>
rename(workspaceId: string, name: string): Promise<Workspace>
```

- [ ] **Step 1: Write failing SessionDocumentStore tests**

Verify:

- workspace isolation;
- defensive clone on set/get;
- delete one workspace leaves another intact;
- clear removes all;
- no Web Storage / IndexedDB dependency.

- [ ] **Step 2: Write failing Workspace create/rename tests**

Create must:

- normalize name;
- generate separate workspace/profile IDs;
- clone active profile values without shared references;
- set `storageMode='private-session'`;
- set snapshot disabled/20;
- atomically persist profile + workspace + active ID.

Rename validation:

- trim;
- reject empty;
- reject >80 Unicode code points;
- reject control characters;
- permit duplicate display names;
- preserve ID/profile/storage policy.

Use injected `now()` / ID generator for deterministic tests.

- [ ] **Step 3: Run RED**

```bash
bun run test -- tests/workspace/session-document-store.test.ts tests/workspace/workspace-service.test.ts
```

- [ ] **Step 4: Implement Memory + IndexedDB create atomic**

IndexedDB operation uses `[STORE_RULE_PROFILES, STORE_WORKSPACES, STORE_META]` in one readwrite transaction. Validate both records before transaction creation.

Memory implementation clones maps and swaps only after all validation succeeds.

- [ ] **Step 5: Verify GREEN**

```bash
bun run test -- tests/workspace/session-document-store.test.ts tests/workspace/workspace-service.test.ts tests/storage/memory-repositories.test.ts
bun run lint
```

- [ ] **Step 6: Commit**

```bash
git add src/workspace src/storage tests/workspace tests/storage
git commit -m "feat: add workspace creation and session documents"
```

---

### Task 4: Explicit Workspace Document Save + Safe Switching

**Files:**
- Modify: `src/storage/storage.ts`
- Modify: `src/workspace/workspace-service.ts`
- Modify: `src/state/actions.ts`
- Test: `tests/workspace/workspace-switch.test.ts`
- Test: `tests/storage/storage-facade.test.ts`
- Test: `tests/storage/privacy-timer.test.ts`

**Storage façade API:**

```ts
saveWorkspaceDocument(workspaceId: string, doc: StoredDocument): Promise<void>
loadWorkspaceDocument(workspaceId: string): Promise<StoredDocument | undefined>
```

`saveRecentDocument()` / `loadRecentDocument()` may remain temporary compatibility wrappers, but new Workspace flow must not use them.

**Switch API:**

```ts
switchTo(
  targetWorkspaceId: string,
  currentDocument: SessionDocument
): Promise<WorkspaceSwitchResult>
```

`WorkspaceSwitchResult` includes target `WorkspaceContext`, target document when available, and a recovery warning when target persisted body cannot be read.

- [ ] **Step 1: Write the switch-race RED tests**

Test scenario:

1. Workspace A is Local Library.
2. schedule document save for A.
3. switch active selection to B before debounce callback executes.
4. execute callback.
5. assert A received the document and B did not.

Also cover:

- Private A → Private B → A restores A from SessionDocumentStore;
- Private documents never appear in `workspaceDocuments`;
- Local Library current document flush failure keeps active selection at old workspace;
- switching to Local target loads only target workspace documents;
- switching to a Private target with no session body returns welcome/empty fallback signal.

- [ ] **Step 2: Run RED**

```bash
bun run test -- tests/workspace/workspace-switch.test.ts tests/storage/privacy-timer.test.ts
```

- [ ] **Step 3: Implement explicit save/load and schedule-time workspace capture**

Expose a timer helper in `actions.ts`:

```ts
cancelPendingDocumentSave(): void
persistDocumentDebounced(workspaceId?: string): void
flushDocumentForWorkspace(workspaceId: string): Promise<void>
```

The timer callback must capture the workspace ID passed/snapshotted when scheduled. It must not call `getActiveWorkspaceId()` to decide the destination at callback time.

- [ ] **Step 4: Implement service switch ordering**

Old Workspace state is routed before selection changes:

- Local → cancel queued timer + explicit flush.
- Private → SessionDocumentStore set.
- then active ID update.
- then target context/document load.

If Local flush fails, do not mutate active selection.

- [ ] **Step 5: Verify GREEN**

```bash
bun run test -- tests/workspace/workspace-switch.test.ts tests/storage/storage-facade.test.ts tests/storage/privacy-timer.test.ts
bun run lint
```

- [ ] **Step 6: Commit**

```bash
git add src/storage/storage.ts src/workspace src/state/actions.ts tests/workspace tests/storage
git commit -m "feat: switch workspaces with explicit document routing"
```

---

### Task 5: Atomic Workspace Delete + Successor Selection

**Files:**
- Modify: `src/storage/repositories/ports.ts`
- Modify: `src/storage/repositories/memory.ts`
- Modify: `src/storage/db/indexeddb-atomic-operations.ts`
- Modify: `src/workspace/workspace-service.ts`
- Test: `tests/workspace/workspace-delete.test.ts`

**Atomic API:**

```ts
deleteWorkspaceAndSelectNext(
  workspaceId: string,
  nextWorkspaceId: string
): Promise<void>
```

- [ ] **Step 1: Write failing tests**

Cover:

- deleting last Workspace rejects with a domain/application error;
- active delete chooses stable successor;
- same transaction removes workspace documents, snapshots, workspace/document suppressions, Workspace record, and writes successor active ID;
- RuleProfile remains;
- SessionDocumentStore entry is deleted only after durable atomic operation succeeds;
- failed durable delete leaves session document intact for retry;
- non-active delete preserves active selection.

For IndexedDB, inject records directly for snapshot/suppression checks and assert final stores after transaction complete.

- [ ] **Step 2: Run RED**

```bash
bun run test -- tests/workspace/workspace-delete.test.ts
```

- [ ] **Step 3: Implement browser-safe atomic deletion**

Include `STORE_META` in active-delete transaction. Reuse/refactor existing cascade cursor logic; dependent cursor deletes must remain queued from active request callbacks.

Do not delete profiles.

- [ ] **Step 4: Verify GREEN + Phase 2A privacy/cascade regressions**

```bash
bun run test -- tests/workspace/workspace-delete.test.ts tests/storage/privacy-deletion-atomic.test.ts tests/storage/memory-repositories.test.ts
bun run lint
```

- [ ] **Step 5: Commit**

```bash
git add src/storage src/workspace tests/workspace tests/storage
git commit -m "feat: delete workspaces with atomic successor selection"
```

---

### Task 6: Canonical Storage Mode Transition

**Files:**
- Modify: `src/storage/repositories/ports.ts`
- Modify: `src/storage/repositories/memory.ts`
- Modify: `src/storage/db/indexeddb-atomic-operations.ts`
- Modify: `src/workspace/workspace-service.ts`
- Modify: `src/state/actions.ts`
- Modify: `src/storage/compat/app-config-projection.ts` only if compatibility helper extraction is needed
- Test: `tests/workspace/storage-mode-transition.test.ts`
- Test: `tests/storage/privacy-timer.test.ts`
- Test: `tests/storage/privacy-deletion-atomic.test.ts`

**Required atomic operation:**

```ts
makeWorkspacePrivate(workspaceId: string): Promise<void>
```

Transaction must:

- read/validate target Workspace;
- set `storageMode='private-session'`;
- delete its documents;
- delete snapshots belonging to those documents;
- preserve unrelated Workspace records/documents/snapshots;
- scrub legacy `documents/recent` only when applying the retained migration compatibility rule.

- [ ] **Step 1: Write Local → Private RED tests**

Prove:

- queued autosave is cancelled before atomic privacy operation begins;
- current editor/session document remains in memory;
- persisted document + snapshot are gone;
- Workspace mode is private;
- compatibility config becomes `{autoSave:false, privacyMode:true}`;
- unrelated Workspace persisted body is untouched;
- transaction failure does not leave `storageMode=private-session` with body still persisted or the inverse.

- [ ] **Step 2: Write Private → Local service tests**

Private → Local must reject when `StorageContext.durable === false`.

For durable context:

- requires an explicit service call originating from confirmed UI action;
- changes Workspace mode to local;
- saves current document to the same Workspace ID;
- compatibility config becomes local-library flags.

If initial body save fails, surface error and do not report successful opt-in. Prefer reverting the mode to private on failure; do not claim Local Library is enabled while first persistence failed.

- [ ] **Step 3: Run RED**

```bash
bun run test -- tests/workspace/storage-mode-transition.test.ts tests/storage/privacy-timer.test.ts tests/storage/privacy-deletion-atomic.test.ts
```

- [ ] **Step 4: Implement transition methods**

Expose a service method only for `private-session | local-library`; reject reserved `file-backed` from Phase 2B UI/application action.

Legacy `onPrivacyModeChanged()` becomes a compatibility wrapper or is removed from component usage after Task 9. It must not remain a second source of truth.

- [ ] **Step 5: Verify GREEN**

```bash
bun run test -- tests/workspace/storage-mode-transition.test.ts tests/storage/privacy-timer.test.ts tests/storage/privacy-deletion-atomic.test.ts tests/storage/app-config-projection.test.ts
bun run lint
```

- [ ] **Step 6: Commit**

```bash
git add src/storage src/workspace src/state/actions.ts tests/workspace tests/storage
git commit -m "feat: make workspace storage mode canonical"
```

---

### Task 7: Storage Capability Service

**Files:**
- Create: `src/workspace/storage-capability.ts`
- Test: `tests/workspace/storage-capability.test.ts`

**Interfaces:**

```ts
interface StorageCapability {
  available: boolean
  durableBackend: boolean
  usage?: number
  quota?: number
  persisted?: boolean
  persistenceRequestSupported: boolean
  error?: string
}

interface StorageCapabilityService {
  inspect(durableBackend: boolean): Promise<StorageCapability>
  requestPersistence(durableBackend: boolean): Promise<StorageCapability>
}
```

Implement against an injected minimal `StorageManagerLike` so tests do not need a real browser.

- [ ] **Step 1: Write failing tests**

Cases:

- all APIs supported and resolve;
- `estimate()` only;
- `persisted()` missing;
- `persist()` missing;
- each method throws/rejects;
- durable backend false returns unavailable/best-effort state and never invokes `persist()`;
- persistence denied returns `persisted:false`, not an exception;
- zero/undefined quota handled without division assumptions.

- [ ] **Step 2: Run RED**

```bash
bun run test -- tests/workspace/storage-capability.test.ts
```

- [ ] **Step 3: Implement minimal adapter**

No persistence request on startup. `requestPersistence()` is user-triggered only.

UI-facing labels/helpers, if added, must say `origin` / `推定` and never imply app-exclusive quota.

- [ ] **Step 4: Verify GREEN**

```bash
bun run test -- tests/workspace/storage-capability.test.ts
bun run lint
```

- [ ] **Step 5: Commit**

```bash
git add src/workspace/storage-capability.ts tests/workspace/storage-capability.test.ts
git commit -m "feat: inspect browser storage capability"
```

---

### Task 8: Workspace State Controller + App Bootstrap

**Files:**
- Create: `src/state/workspace-controller.ts`
- Modify: `src/state/app-state.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/state/actions.ts`
- Modify: `src/components/EditorPane.tsx` only if function signature changes require it
- Test: `tests/workspace/workspace-regression.test.ts`

**State additions:**

```ts
interface WorkspaceSummary {
  id: string
  name: string
  storageMode: 'private-session' | 'local-library' | 'file-backed'
}

workspaceReady: Accessor<boolean>
workspaces: Accessor<WorkspaceSummary[]>
activeWorkspaceId: Accessor<string | null>
workspaceManagerOpen: Accessor<boolean>
storageCapability: Accessor<StorageCapability | null>
```

Add explicit methods to replace workspace state atomically from the controller. Do not let components mutate repository-backed workspace state directly.

Add a diagnostic reset helper for workspace switch:

```ts
resetDiagnosticsForDocumentContext(): void
```

which clears selected diagnostic and stale tier results before relint.

- [ ] **Step 1: Write integration-style RED tests around controller/service**

Without rendering DOM, verify controller effects:

- boot resolves active Workspace and compatibility config;
- `storageAvailable` reflects `context.durable`, not merely presence of global `indexedDB`;
- migration/open fallback reports Memory mode even if an IndexedDB global exists but open fails;
- private session document routing survives A→B→A;
- local workspace boot restores its document;
- switch updates config before full relint callback;
- stale diagnostic selection is cleared.

Inject lint callback/toast callbacks where necessary rather than creating a real Worker in tests.

- [ ] **Step 2: Run RED**

```bash
bun run test -- tests/workspace/workspace-regression.test.ts
```

- [ ] **Step 3: Implement controller and simplify `App.tsx` bootstrap**

`App.tsx` should no longer independently perform `loadConfig()` + `loadRecentDocument()` by guessing privacy flags. One Workspace-aware bootstrap operation returns active config/document/state.

The existing config persistence effect remains, but storage-mode changes must not be inferred from arbitrary Settings privacy mutation.

- [ ] **Step 4: Verify GREEN**

```bash
bun run test -- tests/workspace/workspace-regression.test.ts tests/storage/storage-facade.test.ts
bun run lint
bun run build
```

- [ ] **Step 5: Commit**

```bash
git add src/state src/app src/components/EditorPane.tsx tests/workspace
git commit -m "feat: bootstrap workspace-aware application state"
```

---

### Task 9: Header Workspace Switcher / Manage Dialog / Settings Integration

**Files:**
- Create: `src/components/WorkspaceSwitcher.tsx`
- Create: `src/components/WorkspaceManageDialog.tsx`
- Modify: `src/components/Header.tsx`
- Modify: `src/components/SettingsDialog.tsx`
- Modify: `src/components/StatusBar.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/styles/global.css`
- Modify: `src/state/workspace-controller.ts`
- Test: `tests/workspace/workspace-regression.test.ts` for actions/state semantics

**UI implementation decision:** use a native `<select>` for Workspace selection plus compact `+` / manage controls in Header rather than a custom ARIA menu. This preserves the approved Header Workspace Switcher UX while reducing keyboard/focus bugs and keeping Phase 2B dependency-free. `WorkspaceManageDialog` owns rename, storage mode, capability status, persistence request, and delete confirmation.

- [ ] **Step 1: Add action/state tests before TSX changes**

Cover UI-facing controller methods:

- selecting current ID is no-op;
- create activates new private Workspace;
- rename error does not optimistically change list;
- delete disabled/error when one Workspace remains;
- Local Library request fails in Memory fallback;
- Local → Private preserves current editor body in SessionDocumentStore;
- persistence request denial is rendered/state-representable as best effort, not fatal.

- [ ] **Step 2: Run RED**

```bash
bun run test -- tests/workspace/workspace-regression.test.ts
```

- [ ] **Step 3: Implement Header switcher**

Requirements:

- accessible label `ワークスペース`;
- current workspace visible;
- switch disabled while a workspace mutation/switch is in flight;
- Create and Manage controls keyboard reachable;
- narrow header does not force editor horizontal overflow; use existing responsive/overflow model.

- [ ] **Step 4: Implement Manage dialog**

Sections:

- Workspace name + rename;
- Storage mode: Private Session / Local Library;
- explicit Local Library opt-in confirmation copy;
- browser backend: Durable IndexedDB / Memory only;
- persistence: Protected / Best effort / Unknown;
- `origin全体の推定使用量 / 推定上限`;
- user-triggered `[永続ストレージを要求]` when supported and Local Library;
- Delete with name and Local Library data-loss warning.

Do not display `file-backed`.

- [ ] **Step 5: Replace Settings privacy controls**

Remove direct `appState.updateConfig(draft.privacy=...)` behavior. General settings should either:

- display current Workspace storage mode and provide a button/link to Manage Workspace; or
- invoke the exact same workspace-controller storage mode action.

There must be one canonical transition path.

- [ ] **Step 6: Update StatusBar terminology**

Prefer `🔒 Private Session` over the old independent “プライバシーモード” semantics. Memory fallback warning remains separate.

- [ ] **Step 7: Verify compile/build**

```bash
bun run test -- tests/workspace/workspace-regression.test.ts
bun run lint
bun run build
bun run build:pages
```

- [ ] **Step 8: Commit**

```bash
git add src/components src/state src/app src/styles tests/workspace
git commit -m "feat: add workspace and privacy management UI"
```

---

### Task 10: Full Regression / Adversarial Review / CI Gate

**Files:**
- Test: `tests/workspace/workspace-regression.test.ts`
- Modify tests discovered necessary during review only.
- Product code only when a reproduced failure justifies it.

- [ ] **Step 1: Add final cross-boundary regression scenarios**

At minimum:

1. **Private isolation**: create A/B private, edit distinct bodies, switch A→B→A, verify body restoration in-memory and zero IDB body records.
2. **Local routing**: A local + B local, queued autosave on A then switch B, verify A body never lands in B.
3. **Privacy scrub**: local A with snapshot → Private, verify current editor body remains but persisted A body/snapshot gone; B body untouched.
4. **Active delete**: A/B/C, delete active B, verify deterministic successor and full cascade; profile retained.
5. **Last delete**: only A, deletion rejected with no record changes.
6. **Selection corruption**: meta points to missing Workspace, boot repairs to stable valid workspace.
7. **Memory fallback**: same runtime context shared across façade/service; Local Library disabled.
8. **Storage capability failures**: unsupported/rejected APIs do not block Workspace usage.

- [ ] **Step 2: Run full verification**

```bash
bun ci
bun run lint
bun run test
bun run build
bun run build:pages
grep -q '/japanese_text/assets/' dist/index.html
grep -R -q '/japanese_text/assets/analysis.worker-' dist/assets
```

Expected: all exit 0; report exact test file/test counts from current output instead of assuming Phase 2A counts.

- [ ] **Step 3: Review PR diff against spec line-by-line**

Spec checklist:

- Header Workspace switcher present, no sidebar introduced.
- active ID persisted in `meta`.
- `workspaces[0]` active assumption removed.
- Private Session body not persisted.
- SessionDocumentStore survives in-tab switching.
- Local Library requires durable backend + explicit action.
- workspace-specific save destination captured before debounce.
- active delete successor atomic.
- Local → Private atomic body/snapshot scrub.
- AppConfig privacy is compatibility view, not independent UI state.
- StorageManager failures are nonfatal.
- quota wording is origin-level estimate.
- no profile auto-delete.
- no new backend/network/LLM path.

- [ ] **Step 4: Code review with false-positive assessment**

For every finding:

1. reproduce or identify an invariant violation;
2. decide Critical / Important / Minor;
3. verify it is not a test-only artifact or false positive;
4. compare at least one alternative fix when transaction/state semantics are involved;
5. add regression test before modifying product behavior;
6. rerun focused tests and then full verification.

Specific review probes:

- IndexedDB request lifetime after `await`;
- double context creation;
- stale timer after switch/privacy transition;
- selection update before failed flush;
- stale config/profile after switch;
- deleting session cache before durable delete commits;
- unsupported StorageManager methods;
- custom header controls keyboard/focus behavior.

- [ ] **Step 5: Update PR #4 from docs-only to implementation summary**

Include:

- architecture summary;
- meaningful tests added;
- review findings/fixes;
- final CI run ID/head SHA;
- known deferred work (document library, profile UI, multi-tab sync).

- [ ] **Step 6: Mark ready / merge only after fresh head verification**

Before merge:

- PR head SHA must match verified SHA;
- PR must be mergeable;
- no unresolved review thread;
- latest PR CI green.

After squash merge, verify main push CI and GitHub Pages deployment again before claiming Phase 2B complete.

---

## Acceptance Criteria

Phase 2B is complete only when all conditions below are demonstrated by tests/build/review evidence:

- Workspace create/switch/rename/delete works through application service/controller.
- active Workspace does not depend on repository list order.
- active ID repairs safely.
- private workspace bodies stay memory-only but survive in-tab switches.
- local workspace documents are routed strictly by explicit Workspace ID.
- autosave cannot cross Workspace boundaries.
- Local Library cannot be enabled in Memory fallback.
- Local → Private is atomic with body/snapshot deletion and timer cancellation.
- deleting active Workspace atomically selects a successor.
- last Workspace cannot be deleted.
- Settings and Manage UI do not maintain separate privacy truth.
- storage quota/persistence handling is nonfatal and origin-scoped in wording.
- Phase 2A migration/privacy tests remain green.
- TypeScript, all Vitest tests, normal build, Pages build, Pages path verification are green on the exact PR head.
