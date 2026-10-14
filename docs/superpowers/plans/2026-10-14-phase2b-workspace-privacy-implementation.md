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
- `AppConfig.privacy` は worker / export / legacy compatibility のため残すが、通常 config save/import から `Workspace.storageMode` を変更しない。
- config import に `{autoSave:true, privacyMode:false}` が含まれていても Local Library を自動有効化しない。明示 Workspace action のみが storage mode を変更できる。
- v1→v2 migration だけは旧ユーザーの既存保存意図を復元するため、legacy `AppConfig.privacy` → storage mode mapping を維持する。
- DB name/version は Phase 2A の `japanese-writing-toolkit` / v2 を維持する。
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
4. **Config privacy backdoor:** regular `saveConfig()` / config import が storage mode を変更せず、explicit Workspace actionだけが Local Library opt-in を成立させる。
5. **Storage-mode transition:** Local→Private は timer cancel + mode change + document/snapshot scrub、Private→Local は mode change + 初回本文保存を partial commit にしない。
6. **Workspace deletion:** 最後の1件を削除せず、active削除時は successor selection + cascade deletionを同一 transaction で確定する。
7. **Private Session loss:** A→B→A の切替で同一タブ内の本文を復元し、IndexedDBには本文が存在しない。
8. **StorageManager failure:** `estimate` / `persisted` / `persist` が未対応・throw・rejectしても app を停止せず、origin-level estimate としてだけ表示する。

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
- `src/storage/compat/app-config-projection.ts`
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

**Files:** `src/storage/runtime.ts`, repository ports/adapters, `schema.ts`, `bootstrap.ts`, `storage.ts`, `tests/storage/workspace-selection.test.ts`, `tests/storage/storage-facade.test.ts`。

**Interfaces:**

```ts
export const META_ACTIVE_WORKSPACE_ID = 'active-workspace-id'

interface WorkspaceSelectionRepository {
  getActiveWorkspaceId(): Promise<string | undefined>
  setActiveWorkspaceId(workspaceId: string): Promise<void>
}

function getStorageContext(): Promise<StorageContext>
function resetStorageRuntimeForTests(): void
```

- [ ] Write RED tests for Memory/IndexedDB selection save/read and a Memory fallback regression proving `storage.ts` and another runtime consumer see the same mutated context.
- [ ] Run `bun run test -- tests/storage/workspace-selection.test.ts tests/storage/storage-facade.test.ts` and confirm RED.
- [ ] Implement one module-level context promise in `runtime.ts`; remove the private context singleton from `storage.ts`.
- [ ] IndexedDB selection uses `STORE_META`; Memory selection stays in-memory.
- [ ] Run focused tests + `bun run lint` and confirm GREEN.
- [ ] Commit `feat: add shared storage runtime and workspace selection`.

---

### Task 2: Active Selection Resolver + Atomic Zero-Workspace Repair

**Files:** `src/workspace/workspace-service.ts`, `ports.ts`, Memory/IndexedDB atomic adapters, `storage.ts`, selection/service tests。

**Atomic primitive:**

```ts
createWorkspaceAndActivate(
  workspace: Workspace,
  profile: RuleProfile
): Promise<void>
```

Resolution order: valid selected ID → stable sort by `createdAt,id` → repair first valid → if zero Workspace, atomically create default private Workspace/profile/selection。

- [ ] RED tests: valid not-first active ID, missing ID, deleted target, tie-breaker, zero-workspace recovery, atomic failure injection, private compatibility config.
- [ ] Run service/selection tests and confirm RED.
- [ ] Implement IndexedDB create-and-activate as one transaction over `ruleProfiles/workspaces/meta`; Memory validates/clones then swaps state together.
- [ ] Remove every `workspaces[0]` active assumption from `storage.ts`.
- [ ] Run service + storage façade + migration tests and lint.
- [ ] Commit `feat: resolve and repair active workspace selection`.

---

### Task 3: SessionDocumentStore + Workspace Create / List / Rename

**Files:** `src/workspace/session-document-store.ts`, `workspace-service.ts`, session/service tests。

```ts
interface SessionDocumentStore {
  get(workspaceId: string): SessionDocument | undefined
  set(workspaceId: string, document: SessionDocument): void
  delete(workspaceId: string): void
  clear(): void
}
```

- [ ] RED tests: workspace isolation, defensive clone, delete isolation, clear, no Web Storage dependency.
- [ ] RED create tests: independent workspace/profile IDs, deep-cloned active profile, private mode, snapshots disabled/20, atomic activation via Task 2 primitive.
- [ ] RED rename tests: trim, nonempty, <=80 Unicode code points, control-char rejection, duplicate display names allowed, identity unchanged.
- [ ] Implement with injected clock/ID generator for deterministic testing.
- [ ] Run focused tests + Memory repository regression + lint.
- [ ] Commit `feat: add workspace creation and session documents`.

---

### Task 4: Explicit Workspace Document Save + Safe Switching

**Files:** `storage.ts`, `workspace-service.ts`, `state/actions.ts`, `EditorPane.tsx`, switch/storage/privacy-timer tests。

```ts
saveWorkspaceDocument(workspaceId: string, doc: StoredDocument): Promise<void>
loadWorkspaceDocument(workspaceId: string): Promise<StoredDocument | undefined>

persistDocumentDebounced(workspaceId: string): void
cancelPendingDocumentSave(): void
flushDocumentForWorkspace(workspaceId: string): Promise<void>
```

- [ ] RED race test: schedule Local A save → active becomes B → timer executes → body belongs only to A.
- [ ] RED tests: Private A→B→A restores memory body; Private body absent from IDB; Local flush failure leaves active ID unchanged; target Local loads only its own body.
- [ ] Run switch/privacy tests and confirm RED.
- [ ] Implement explicit save/load; `saveWorkspaceDocument` writes only when the specified Workspace is Local Library.
- [ ] Make `workspaceId` mandatory at debounce schedule time. `EditorPane` reads active ID before scheduling; no callback-time active lookup.
- [ ] Switch ordering: route old body/flush → only then mutate active ID → load target context/body.
- [ ] Run focused tests + lint.
- [ ] Commit `feat: switch workspaces with explicit document routing`.

---

### Task 5: Atomic Workspace Delete + Successor Selection

**Files:** atomic ports/adapters, `workspace-service.ts`, `tests/workspace/workspace-delete.test.ts`。

```ts
deleteWorkspaceAndSelectNext(
  workspaceId: string,
  nextWorkspaceId: string
): Promise<void>
```

- [ ] RED tests: last Workspace rejected; deterministic active successor; docs/snapshots/workspace+document suppressions/Workspace removed + active ID changed atomically; profile retained; session entry deleted only after durable success; non-active delete preserves active ID.
- [ ] Implement browser-safe transaction including `meta`; dependent cursor work remains in active request callbacks.
- [ ] Run delete + Phase 2A privacy/cascade regressions + lint.
- [ ] Commit `feat: delete workspaces with atomic successor selection`.

---

### Task 6: Canonical Config Persistence + Atomic Storage Mode Transitions

**Files:** `app-config-projection.ts`, `storage.ts`, atomic ports/adapters, `workspace-service.ts`, `state/actions.ts`, projection/facade/privacy/storage-mode tests。

**Config projection split:**

```ts
// migration/import compatibility parser can understand legacy privacy,
// but ordinary persistence preserves current Workspace.storageMode.
splitAppConfigForMigration(config, current, now): ProjectedStorageState
splitAppConfigPreservingStorageMode(config, current, now): ProjectedStorageState
```

Naming may differ, but call sites must make intent explicit: v1 migration may map legacy privacy; normal `saveConfig()` must preserve the active Workspace mode.

**Atomic transition APIs:**

```ts
enableLocalLibrary(
  workspaceId: string,
  document: StoredWorkspaceDocument
): Promise<void>

makeWorkspacePrivate(workspaceId: string): Promise<void>
```

- [ ] RED backdoor tests: private Workspace + `saveConfig()` containing `{autoSave:true, privacyMode:false}` remains private; config import with Local flags does not enable Local Library; v1 migration still maps old Local intent correctly.
- [ ] RED Local→Private: queued autosave cancelled first; editor/session body retained; persisted body/snapshot removed; unrelated Workspace untouched; transaction failure leaves pre-operation policy/data intact.
- [ ] RED Private→Local: Memory fallback rejects; durable transaction atomically changes mode + saves first body; transaction failure leaves Workspace private and body absent.
- [ ] Run storage-mode + projection + façade + migration + privacy tests and confirm RED.
- [ ] Implement ordinary config persistence using the preserve-mode projection. Explicit Workspace service actions are the only regular path that changes storage mode.
- [ ] Implement both atomic transitions with validation before transaction creation. `file-backed` remains rejected in Phase 2B actions.
- [ ] Run focused suite + lint and confirm GREEN.
- [ ] Commit `feat: make workspace storage mode canonical`.

---

### Task 7: Storage Capability Service

**Files:** `src/workspace/storage-capability.ts`, capability tests。

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
```

- [ ] RED cases: all supported, estimate-only, missing methods, each API throw/reject, durable=false, persist denied, zero/undefined quota.
- [ ] Implement against injected minimal `StorageManagerLike`; never call `persist()` at startup.
- [ ] Ensure UI-facing helpers use `origin` / `推定` wording.
- [ ] Run capability tests + lint.
- [ ] Commit `feat: inspect browser storage capability`.

---

### Task 8: Workspace State Controller + App Bootstrap

**Files:** `src/state/workspace-controller.ts`, `app-state.ts`, `App.tsx`, `state/actions.ts`, workspace regression tests。

State adds Workspace summaries, active ID, readiness, manager state, capability, mutation state. Add `resetDiagnosticsForDocumentContext()` to clear selected diagnostic + stale tier results before relint.

- [ ] RED controller tests: boot active context/config; `storageAvailable` follows `context.durable` rather than mere IndexedDB global; open/migration fallback shows Memory mode; Private A→B→A restores body; Local boot restores body; switch clears stale diagnostics/config context.
- [ ] Inject lint/toast callbacks in unit tests; do not construct real Worker.
- [ ] Implement one Workspace-aware bootstrap. `App.tsx` stops independently calling `loadConfig()` + `loadRecentDocument()` based on privacy flags.
- [ ] Run regression + storage façade tests, lint, normal build.
- [ ] Commit `feat: bootstrap workspace-aware application state`.

---

### Task 9: Header Switcher / Manage Dialog / Settings Integration

**Files:** `WorkspaceSwitcher.tsx`, `WorkspaceManageDialog.tsx`, Header/Settings/StatusBar/App/styles/controller, workspace regression tests。

**UI implementation:** native `<select>` for Workspace selection plus compact Create / Manage controls. This keeps the approved Header Workspace Switcher while avoiding custom menu keyboard/focus risk.

- [ ] RED UI-facing controller tests: current selection no-op, create activates private Workspace, rename failure no optimistic mutation, last delete rejected, Local disabled in Memory fallback, Local→Private preserves editor memory, persistence denial nonfatal.
- [ ] Implement Header switcher with accessible `ワークスペース` label and mutation-disabled controls.
- [ ] Implement Manage dialog: rename; Private/Local; explicit Local opt-in; Durable/Memory; persistence status; `origin全体の推定使用量 / 推定上限`; user-triggered persistence request; delete confirmation.
- [ ] Replace Settings direct privacy mutation. Settings must invoke the same Workspace controller transition or open Manage dialog.
- [ ] Update StatusBar wording to `🔒 Private Session`; Memory warning stays separate.
- [ ] Run regression tests, lint, normal build, Pages build.
- [ ] Commit `feat: add workspace and privacy management UI`.

---

### Task 10: Full Regression / Adversarial Review / CI Gate

- [ ] Add cross-boundary tests:
  1. Private A/B distinct bodies survive A→B→A in memory only.
  2. Local A queued autosave never lands in B.
  3. Local A + snapshot → Private removes A persisted data but retains current editor memory; B untouched.
  4. A/B/C active B delete picks deterministic successor, cascades data, retains profile.
  5. Single A delete rejected without mutation.
  6. missing active meta repaired on boot.
  7. Memory fallback shares one runtime context and refuses Local.
  8. config import/normal save cannot bypass explicit Local opt-in.
  9. StorageManager unsupported/rejected methods do not block Workspace usage.
- [ ] Run full verification:

```bash
bun ci
bun run lint
bun run test
bun run build
bun run build:pages
grep -q '/japanese_text/assets/' dist/index.html
grep -R -q '/japanese_text/assets/analysis.worker-' dist/assets
```

- [ ] Report exact current test counts; do not reuse Phase 2A’s 180 count.
- [ ] Review spec checklist: Header/no sidebar, meta selection, no `workspaces[0]`, memory-only Private, explicit Local routing, no config privacy backdoor, atomic delete/transitions, nonfatal StorageManager, origin wording, no profile delete, no backend/network/LLM.
- [ ] For every review finding: reproduce/invariant → severity → false-positive check → alternative fix for transaction/state issues → regression test → focused test → full verification.
- [ ] Probe specifically: IDB lifetime after `await`, duplicate context creation, stale autosave timer, selection update before failed flush, stale config/profile after switch, session cache deletion before durable commit, unsupported StorageManager, keyboard/focus behavior.
- [ ] Update PR #4 with implementation summary, tests, review fixes, exact verified head SHA/run ID, deferred work.
- [ ] Merge only when head SHA equals verified SHA, mergeable, no unresolved review threads, latest CI green. After squash merge verify main CI + Pages deployment before claiming completion.

---

## Acceptance Criteria

Phase 2B is complete only when evidence demonstrates:

- Workspace create/switch/rename/delete works through service/controller.
- active Workspace no longer depends on repository list order and repairs safely.
- private bodies stay memory-only but survive same-tab switching.
- Local documents are routed strictly by explicit Workspace ID; autosave cannot cross Workspace boundaries.
- normal config save/import cannot enable Local Library; only explicit Workspace action can.
- v1 migration still respects legacy save intent.
- Local Library cannot be enabled in Memory fallback.
- Private→Local and Local→Private do not partial-commit policy/data mismatches.
- Local→Private cancels queued autosave and deletes persisted body/snapshot while keeping current editor memory.
- deleting active Workspace atomically selects successor; last Workspace cannot be deleted.
- Settings/Manage UI share one storage-mode transition path.
- storage quota/persistence handling is nonfatal and origin-scoped in wording.
- Phase 2A migration/privacy tests remain green.
- TypeScript, all Vitest tests, normal build, Pages build, Pages path verification are green on the exact PR head.
