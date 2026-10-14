# Phase 2B Workspace / Privacy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 2A の local-first storage foundation 上に、複数 Workspace の create / switch / rename / delete、Private Session / Local Library の安全な切替、browser storage capability 表示を追加する。

**Architecture:** `Workspace.storageMode` を本文永続化 policy の canonical source とし、`AppConfig.privacy` は互換 view としてのみ扱う。UI は repository / IndexedDB を直接操作せず `WorkspaceService` と state controller を経由する。Private Session 本文は Workspace ごとの `SessionDocumentStore` に同一タブ内だけ保持し、Local Library 本文のみ IndexedDB に保存する。active Workspace ID は既存 `meta` store に保持し、複数 store を跨ぐ create/delete/storage-mode transition は `AtomicOperationsPort` 内の単一 transaction で確定する。

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
- IndexedDB transaction 内で dependent write を `await` 後に新規 enqueue しない。dependent requests は request callback 内で queue する。
- RuleProfile は Workspace delete 時に自動削除しない。
- document library/sidebar、suppression UI、RuleProfile管理UI、multi-tab sync は非対象。
- product code は failing test → minimal implementation → passing test の順で進める。

## Review Focus

1. **StorageContext 分裂:** durable / Memory fallback のどちらでも legacy `storage.ts` と WorkspaceService が同一 context を共有する。
2. **Active selection repair:** missing/corrupt/deleted active ID、0 Workspace、migration直後を安全に修復し、`workspaces[0]` 依存を残さない。
3. **Autosave switch race:** debounce 後に Workspace を切り替えても old document が new Workspace に保存されない。保存先 `workspaceId` は schedule 時点で固定する。
4. **Storage-mode transition:** Local→Private は timer cancel + mode change + document/snapshot scrub、Private→Local は mode change + 初回本文保存を partial commit にしない。
5. **Workspace deletion:** 最後の1件を削除せず、active削除時は successor selection + cascade deletionを同一 transaction で確定する。
6. **Private Session loss:** A→B→A の切替で同一タブ内の本文を復元し、IndexedDBには本文が存在しない。
7. **StorageManager failure:** `estimate` / `persisted` / `persist` が未対応・throw・rejectしても app を停止せず、origin-level estimate としてだけ表示する。

---

## File Map

**Create**

- `src/storage/runtime.ts` — single StorageContext runtime。
- `src/workspace/session-document-store.ts` — Private Session transient body store。
- `src/workspace/workspace-service.ts` — Workspace application service。
- `src/workspace/storage-capability.ts` — StorageManager adapter。
- `src/state/workspace-controller.ts` — service と Solid state/editor を接続。
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
- `src/components/EditorPane.tsx`
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

Memory + IndexedDB selection contract:

```ts
expect(await repositories.selection.getActiveWorkspaceId()).toBeUndefined()
await repositories.selection.setActiveWorkspaceId('ws-a')
expect(await repositories.selection.getActiveWorkspaceId()).toBe('ws-a')
```

Add a Memory fallback regression proving `storage.ts` and another `getStorageContext()` consumer see the same mutated Workspace rather than separately seeded state.

- [ ] **Step 2: Run RED**

```bash
bun run test -- tests/storage/workspace-selection.test.ts tests/storage/storage-facade.test.ts
```

- [ ] **Step 3: Implement selection repositories + singleton runtime**

`runtime.ts` owns the only module-level context promise. `storage.ts` consumes it. Memory selection is in-memory; IndexedDB selection uses `STORE_META`.

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

### Task 2: Active Selection Resolver + Atomic Zero-Workspace Repair

**Files:**
- Create: `src/workspace/workspace-service.ts` (resolver/bootstrap slice)
- Modify: `src/storage/repositories/ports.ts`
- Modify: `src/storage/repositories/memory.ts`
- Modify: `src/storage/db/indexeddb-atomic-operations.ts`
- Modify: `src/storage/storage.ts`
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

**Atomic repair/create primitive:**

```ts
createWorkspaceAndActivate(
  workspace: Workspace,
  profile: RuleProfile
): Promise<void>
```

Active resolution order:

1. read active ID;
2. use it only if referenced Workspace exists and validates;
3. otherwise stable-sort Workspace by `createdAt`, then `id`;
4. repair to first valid Workspace;
5. if zero Workspace, atomically create default private Workspace + default profile + active ID.

- [ ] **Step 1: Write failing tests**

Cover valid active ID not-first, missing ID repair, deleted target repair, deterministic tie-break, zero-workspace atomic recovery, and private compatibility config.

Add failure injection for zero-workspace recovery and assert it never leaves only profile/workspace/selection partially committed.

- [ ] **Step 2: Run RED**

```bash
bun run test -- tests/workspace/workspace-service.test.ts tests/storage/workspace-selection.test.ts
```

- [ ] **Step 3: Implement atomic create-and-activate**

IndexedDB uses one transaction over `ruleProfiles`, `workspaces`, `meta`. Memory validates/clones all state then swaps maps/selection together.

- [ ] **Step 4: Remove `workspaces[0]` active semantics from `storage.ts`**

All active config/document compatibility reads resolve via the selection repository/service helper.

- [ ] **Step 5: Verify GREEN + migration regression**

```bash
bun run test -- tests/workspace/workspace-service.test.ts tests/storage/storage-facade.test.ts tests/storage/migration-v1-v2.test.ts
bun run lint
```

- [ ] **Step 6: Commit**

```bash
git add src/workspace src/storage tests/workspace tests/storage
git commit -m "feat: resolve and repair active workspace selection"
```

---

### Task 3: SessionDocumentStore + Workspace Create / List / Rename

**Files:**
- Create: `src/workspace/session-document-store.ts`
- Modify: `src/workspace/workspace-service.ts`
- Test: `tests/workspace/session-document-store.test.ts`
- Test: `tests/workspace/workspace-service.test.ts`

**Session API:**

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

**Service operations:**

```ts
list(): Promise<WorkspaceSummary[]>
create(input: { name: string }): Promise<WorkspaceContext>
rename(workspaceId: string, name: string): Promise<Workspace>
```

- [ ] **Step 1: Write failing SessionDocumentStore tests**

Workspace isolation, defensive clone, delete isolation, clear, and zero Web Storage/IndexedDB dependency.

- [ ] **Step 2: Write failing create/rename tests**

Create clones the active profile under a new profile ID, creates a private Workspace with snapshots disabled/20, and reuses Task 2 `createWorkspaceAndActivate()`.

Rename validation: trim, nonempty, <=80 Unicode code points, no control chars, duplicate display names allowed, identity fields unchanged.

Use injected `now()` / ID generator for deterministic tests.

- [ ] **Step 3: Run RED**

```bash
bun run test -- tests/workspace/session-document-store.test.ts tests/workspace/workspace-service.test.ts
```

- [ ] **Step 4: Implement minimal service methods**

No profile ownership/deletion policy is added. Create uses deep clones so Workspace rule edits cannot mutate the source profile by reference.

- [ ] **Step 5: Verify GREEN**

```bash
bun run test -- tests/workspace/session-document-store.test.ts tests/workspace/workspace-service.test.ts tests/storage/memory-repositories.test.ts
bun run lint
```

- [ ] **Step 6: Commit**

```bash
git add src/workspace tests/workspace
git commit -m "feat: add workspace creation and session documents"
```

---

### Task 4: Explicit Workspace Document Save + Safe Switching

**Files:**
- Modify: `src/storage/storage.ts`
- Modify: `src/workspace/workspace-service.ts`
- Modify: `src/state/actions.ts`
- Modify: `src/components/EditorPane.tsx`
- Test: `tests/workspace/workspace-switch.test.ts`
- Test: `tests/storage/storage-facade.test.ts`
- Test: `tests/storage/privacy-timer.test.ts`

**Storage API:**

```ts
saveWorkspaceDocument(workspaceId: string, doc: StoredDocument): Promise<void>
loadWorkspaceDocument(workspaceId: string): Promise<StoredDocument | undefined>
```

**Switch API:**

```ts
switchTo(
  targetWorkspaceId: string,
  currentDocument: SessionDocument
): Promise<WorkspaceSwitchResult>
```

- [ ] **Step 1: Write the switch-race RED tests**

Scenario: schedule save for Local Workspace A → switch active ID to B before timer fires → execute timer → assert A receives body and B receives nothing.

Also cover Private A→B→A memory restore, no private IDB body, Local flush failure preserving old active ID, and target-local document isolation.

- [ ] **Step 2: Run RED**

```bash
bun run test -- tests/workspace/workspace-switch.test.ts tests/storage/privacy-timer.test.ts
```

- [ ] **Step 3: Implement explicit save/load**

`saveWorkspaceDocument()` validates the target Workspace and writes only when that Workspace is `local-library`.

- [ ] **Step 4: Make debounced save destination mandatory**

```ts
persistDocumentDebounced(workspaceId: string): void
cancelPendingDocumentSave(): void
flushDocumentForWorkspace(workspaceId: string): Promise<void>
```

`workspaceId` is never optional. `EditorPane` gets current active ID from state; if not ready, it does not schedule persistence. Timer callback never re-resolves active Workspace to choose a destination.

- [ ] **Step 5: Implement switch ordering**

Old Local: cancel timer + explicit flush before selection update. Old Private: save to SessionDocumentStore. Then change selection and load target context/body.

- [ ] **Step 6: Verify GREEN**

```bash
bun run test -- tests/workspace/workspace-switch.test.ts tests/storage/storage-facade.test.ts tests/storage/privacy-timer.test.ts
bun run lint
```

- [ ] **Step 7: Commit**

```bash
git add src/storage/storage.ts src/workspace src/state/actions.ts src/components/EditorPane.tsx tests/workspace tests/storage
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

Cover last Workspace rejection, stable active successor, atomic removal of documents/snapshots/workspace+document suppressions/Workspace + active-ID update, profile retention, session entry removal after durable success only, and non-active delete preserving active ID.

- [ ] **Step 2: Run RED**

```bash
bun run test -- tests/workspace/workspace-delete.test.ts
```

- [ ] **Step 3: Implement browser-safe atomic deletion**

Include `meta` in active-delete transaction. Reuse/refactor cascade cursor logic; dependent writes stay in active request callbacks.

- [ ] **Step 4: Verify GREEN + Phase 2A regressions**

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
- Test: `tests/workspace/storage-mode-transition.test.ts`
- Test: `tests/storage/privacy-timer.test.ts`
- Test: `tests/storage/privacy-deletion-atomic.test.ts`

**Atomic APIs:**

```ts
enableLocalLibrary(
  workspaceId: string,
  document: StoredWorkspaceDocument
): Promise<void>

makeWorkspacePrivate(workspaceId: string): Promise<void>
```

`enableLocalLibrary` prevents a partial state where mode says Local Library but the first user-confirmed body was not persisted. `makeWorkspacePrivate` prevents a partial state where mode/body disagree.

- [ ] **Step 1: Write Local→Private RED tests**

Queued autosave cancelled first; editor/session body retained; target persisted document/snapshot gone; unrelated Workspace untouched; compatibility config private; failure injection leaves both policy/data in pre-operation state.

- [ ] **Step 2: Write Private→Local RED tests**

Memory fallback rejects. Durable context atomically sets mode local + persists current document to same Workspace; compatibility config local. Failure injection leaves Workspace private and no new body.

- [ ] **Step 3: Run RED**

```bash
bun run test -- tests/workspace/storage-mode-transition.test.ts tests/storage/privacy-timer.test.ts tests/storage/privacy-deletion-atomic.test.ts
```

- [ ] **Step 4: Implement transitions**

Both operations validate Workspace/document before opening the transaction. Phase 2B service only accepts private/local; reserved `file-backed` is rejected.

Legacy `documents/recent` scrub remains scoped to the retained migration compatibility rule and must not erase another Workspace’s unrelated v2 body.

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

- [ ] **Step 1: Write failing tests**

All APIs supported, estimate-only, missing persisted/persist, each method throw/reject, durable=false, persist denied, zero/undefined quota.

- [ ] **Step 2: Run RED**

```bash
bun run test -- tests/workspace/storage-capability.test.ts
```

- [ ] **Step 3: Implement injected StorageManager adapter**

No startup `persist()` call. Request is user-triggered only. Helpers use `origin` / `推定` wording and never app-exclusive quota wording.

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
- Test: `tests/workspace/workspace-regression.test.ts`

**State additions:**

```ts
workspaceReady: Accessor<boolean>
workspaces: Accessor<WorkspaceSummary[]>
activeWorkspaceId: Accessor<string | null>
workspaceManagerOpen: Accessor<boolean>
storageCapability: Accessor<StorageCapability | null>
```

Add `resetDiagnosticsForDocumentContext()` to clear stale selected diagnostic/tier results before relint.

- [ ] **Step 1: Write controller RED tests**

Boot resolves active Workspace/config; `storageAvailable` follows `context.durable` rather than presence of global IndexedDB; open/migration fallback reports Memory mode; private A→B→A restores text; local boot restores body; switch clears stale diagnostics.

Inject lint/toast callbacks rather than creating a real Worker in unit tests.

- [ ] **Step 2: Run RED**

```bash
bun run test -- tests/workspace/workspace-regression.test.ts
```

- [ ] **Step 3: Implement controller and simplify App bootstrap**

`App.tsx` stops independently guessing active config/document via `loadConfig()` + `loadRecentDocument()`. Workspace-aware bootstrap returns one coherent active context.

- [ ] **Step 4: Verify GREEN**

```bash
bun run test -- tests/workspace/workspace-regression.test.ts tests/storage/storage-facade.test.ts
bun run lint
bun run build
```

- [ ] **Step 5: Commit**

```bash
git add src/state src/app tests/workspace
git commit -m "feat: bootstrap workspace-aware application state"
```

---

### Task 9: Header Switcher / Manage Dialog / Settings Integration

**Files:**
- Create: `src/components/WorkspaceSwitcher.tsx`
- Create: `src/components/WorkspaceManageDialog.tsx`
- Modify: `src/components/Header.tsx`
- Modify: `src/components/SettingsDialog.tsx`
- Modify: `src/components/StatusBar.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/styles/global.css`
- Modify: `src/state/workspace-controller.ts`
- Test: `tests/workspace/workspace-regression.test.ts`

**UI decision:** use native `<select>` for Workspace selection plus compact Create / Manage controls. This preserves the approved Header switcher while avoiding a custom ARIA menu/focus implementation in Phase 2B.

- [ ] **Step 1: Add UI-facing controller RED tests**

Selecting current ID is no-op; create activates new private Workspace; rename failure does not optimistically mutate list; last delete rejected; Local Library disabled in Memory fallback; Local→Private preserves editor body; persistence denial is nonfatal/best-effort state.

- [ ] **Step 2: Run RED**

```bash
bun run test -- tests/workspace/workspace-regression.test.ts
```

- [ ] **Step 3: Implement Header switcher**

Accessible label `ワークスペース`; current workspace visible; controls disabled during mutation; keyboard reachable; responsive header remains usable.

- [ ] **Step 4: Implement Manage dialog**

Sections: rename; Private/Local mode; explicit Local opt-in; Durable/Memory status; persistence state; `origin全体の推定使用量 / 推定上限`; user-triggered persistence request; delete confirmation.

Never expose `file-backed` in Phase 2B.

- [ ] **Step 5: Replace Settings privacy controls**

No direct `appState.updateConfig(draft.privacy=...)`. General settings show current Workspace storage mode and route to the same controller transition path (or open Manage dialog).

- [ ] **Step 6: Update StatusBar**

Use `🔒 Private Session` terminology; Memory fallback warning stays separate.

- [ ] **Step 7: Verify**

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
- Modify product/tests only for reproduced findings.

- [ ] **Step 1: Add final cross-boundary scenarios**

1. Private A/B distinct bodies survive A→B→A only in memory; IDB body stores stay empty.
2. Local A queued autosave + switch B never writes A body into B.
3. Local A + snapshot → Private retains editor memory but removes A persisted body/snapshot; B untouched.
4. A/B/C active B delete chooses deterministic successor, cascades data, retains profile.
5. Single A delete rejected with no state changes.
6. meta points to missing Workspace → boot repair.
7. Memory fallback shares one runtime context across façade/service; Local disabled.
8. StorageManager unsupported/rejected methods do not block Workspace use.

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

Report exact current test counts from output; do not reuse Phase 2A’s 180 count.

- [ ] **Step 3: Spec checklist review**

Verify Header switcher/no sidebar, meta active ID, no `workspaces[0]` active assumption, memory-only Private bodies, explicit-workspace Local save, atomic active delete, atomic storage transitions, compatibility-only AppConfig privacy, nonfatal StorageManager, origin-level quota wording, no profile auto-delete, no backend/network/LLM path.

- [ ] **Step 4: Code review with false-positive assessment**

For every finding: reproduce/invariant → severity → false-positive check → alternative fix comparison for transaction/state issues → regression test → focused test → full verification.

Specific probes: IDB lifetime after `await`; duplicate context creation; stale autosave timer; selection update before failed flush; stale config/profile after switch; session cache removal before durable delete commit; unsupported StorageManager; keyboard/focus behavior.

- [ ] **Step 5: Update PR #4 implementation summary**

Include architecture, meaningful tests, review findings/fixes, exact verified head SHA/CI run, and deferred work.

- [ ] **Step 6: Merge gate**

PR head equals verified SHA, mergeable, no unresolved review threads, latest CI green. After squash merge, verify main CI and GitHub Pages deployment before claiming Phase 2B complete.

---

## Acceptance Criteria

Phase 2B is complete only when evidence demonstrates:

- Workspace create/switch/rename/delete works through service/controller.
- active Workspace no longer depends on repository list order and repairs safely.
- private bodies stay memory-only but survive same-tab Workspace switching.
- Local documents are routed strictly by explicit Workspace ID.
- autosave cannot cross Workspace boundaries.
- Local Library cannot be enabled in Memory fallback.
- Private→Local and Local→Private transitions do not partial-commit policy/data mismatches.
- Local→Private cancels queued autosave and deletes persisted body/snapshot while keeping current editor memory.
- deleting active Workspace atomically selects successor; last Workspace cannot be deleted.
- Settings/Manage UI share one storage-mode transition path.
- storage quota/persistence handling is nonfatal and origin-scoped in wording.
- Phase 2A migration/privacy tests remain green.
- TypeScript, all Vitest tests, normal build, Pages build, Pages path verification are green on the exact PR head.
