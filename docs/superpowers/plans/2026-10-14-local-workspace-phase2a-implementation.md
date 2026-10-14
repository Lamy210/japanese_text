# Phase 2A Storage Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** IndexedDB v1 の既存データを破壊せずに local-first storage model v2 へ移行し、Workspace / RuleProfile / multi-document の後続開発を支える永続化境界を導入する。

**Architecture:** UI と `appState` は Phase 2A では既存 `AppConfig` / recent-document API を維持し、その裏側に domain model、repository ports、IndexedDB v2 adapter、memory fallback、v1→v2 migration、AppConfig compatibility projection を導入する。schema upgrade と data migration は分離し、multi-store 更新は adapter 内の atomic operation で完結させる。

**Tech Stack:** TypeScript 7、SolidJS、Vitest 5、IndexedDB、`fake-indexeddb@6.2.5`（test only）、Bun 1.4.3、Vite 8。

**Spec:** `docs/superpowers/specs/2026-10-14-local-workspace-rule-platform-design.md`

## Global Constraints

- Backend / Login / LLM / Cloud Sync は追加しない。
- 新規 installation の既定 storage mode は `private-session`。
- 本文をサーバーへ送信しない。
- DB name は `japanese-writing-toolkit` を維持し、IndexedDB version は `2`。
- v1 legacy stores `settings` / `documents` は Phase 2A で削除しない。
- 新 stores は `meta`, `workspaces`, `preferences`, `ruleProfiles`, `workspaceDocuments`, `documentSnapshots`, `suppressions`。
- `onupgradeneeded` は store / index 作成だけを行い、user data migration は open 後の通常 transaction で行う。
- Config schema version / Storage DB version / Export format version を連動させない。
- diagnostics / worker state / lint timing は永続化しない。
- UI 全面改修、Rule Platform v2、Suppression UI、Export/Import、File System Access は Phase 2A の非対象。
- DB v2 へ上げた後の rollback で `DB_VERSION=1` に戻してはならない。
- 既存の lint / formatter / editor behavior を変更しない。
- すべての product-code change は failing test → minimal implementation → passing test の順で行う。

## Review Focus

1. **旧 privacy 設定と stale recent document の組み合わせ:** `privacyMode=true` または `autoSave=false` の v1 user に、legacy recent document が残っていても v2 `workspaceDocuments` へ本文をコピーしないこと。
2. **migration 中断 / 再実行:** records 書き込み後・complete marker 前などの失敗を模擬しても、再実行で duplicate workspace/profile/document が増えず、legacy stores を維持すること。
3. **corrupt v1 config + valid legacy document:** app を起動不能にせず private-session defaults を作り、legacy document を破壊・自動永続化せず recovery path を残すこと。
4. **IndexedDB record corruption:** v2 store に不正 object が混入しても repository read で型 assertion だけを行わず、その record 単位で validation failure として扱うこと。
5. **IndexedDB unavailable / open failure:** `loadConfig()` / bootstrap が reject 連鎖で editor 起動を止めず、memory/default path へ degrade すること。

---

## File Structure

### New domain files

- `src/core/workspace/types.ts` — Workspace / preferences / profile / document / snapshot / suppression の persistence-independent types。
- `src/core/workspace/defaults.ts` — 新規 installation 用 private-session defaults と deterministic migrated IDs。
- `src/core/workspace/validate.ts` — persisted v2 records の whitelist validation。

### New storage ports / adapters

- `src/storage/repositories/ports.ts` — repository interfaces と Phase 2A atomic operation interfaces。
- `src/storage/repositories/memory.ts` — memory fallback + contract-test reference implementation。
- `src/storage/repositories/indexeddb.ts` — IndexedDB repositories。
- `src/storage/db/schema.ts` — DB / store / index constants。
- `src/storage/db/idb-utils.ts` — IDBRequest / transaction helper。
- `src/storage/db/open-database.ts` — schema v2 creation only。
- `src/storage/db/migration-v1-v2.ts` — legacy data migration execution。
- `src/storage/db/indexeddb-atomic-operations.ts` — multi-store atomic mutations。
- `src/storage/bootstrap.ts` — IndexedDB or memory context の生成と migration 起動。
- `src/storage/compat/app-config-projection.ts` — v2 model ↔ existing `AppConfig` bridge。

### Existing integration files

- `src/storage/storage.ts` — public legacy-compatible façade を v2 context へ接続。
- `src/app/App.tsx` — Phase 2A では必要最小限の bootstrap warning / restore behavior のみ調整。
- `src/state/actions.ts` — public storage function signatures が維持できれば原則変更しない。
- `package.json`, `bun.lock` — `fake-indexeddb@6.2.5` dev dependency。

### New tests

- `tests/storage/workspace-domain.test.ts`
- `tests/storage/repository-contract.ts`
- `tests/storage/memory-repositories.test.ts`
- `tests/storage/indexeddb-schema.test.ts`
- `tests/storage/indexeddb-repositories.test.ts`
- `tests/storage/migration-v1-v2.test.ts`
- `tests/storage/app-config-projection.test.ts`
- `tests/storage/storage-facade.test.ts`

---

### Task 1: Domain model と private-session defaults

**Files:**
- Create: `src/core/workspace/types.ts`
- Create: `src/core/workspace/defaults.ts`
- Create: `src/core/workspace/validate.ts`
- Test: `tests/storage/workspace-domain.test.ts`

**Interfaces:**
- Consumes: existing `ThemeMode`, `EditorPreferences`, `PresetId`, `RuleSetting`, `NgWordEntry`, `TermEntry`, `CitationPolicy`, `FormatterPolicy`, `DocumentType`。
- Produces:
  - `type StorageMode = 'private-session' | 'local-library' | 'file-backed'`
  - `interface SnapshotPolicy { enabled: boolean; maxSnapshots: number }`
  - `interface Workspace`
  - `interface GlobalPreferences`
  - `interface RuleProfile`
  - `interface StoredWorkspaceDocument`
  - `interface DocumentSnapshot`
  - `interface Suppression`
  - `createDefaultWorkspaceState(now: number): { workspace: Workspace; preferences: GlobalPreferences; profile: RuleProfile }`
  - `validateWorkspaceRecord(raw: unknown): Workspace`
  - `validatePreferencesRecord(raw: unknown): GlobalPreferences`
  - `validateRuleProfileRecord(raw: unknown): RuleProfile`
  - `validateDocumentRecord(raw: unknown): StoredWorkspaceDocument`

- [ ] **Step 1: Write failing domain/default tests**

Add tests asserting:

```ts
expect(createDefaultWorkspaceState(1000).workspace.storageMode).toBe('private-session')
expect(createDefaultWorkspaceState(1000).preferences.defaultStorageMode).toBe('private-session')
expect(createDefaultWorkspaceState(1000).profile.sourcePresetId).toBe('general')
expect(createDefaultWorkspaceState(1000).workspace.snapshotPolicy.enabled).toBe(false)
```

Also assert that validators reject arrays, missing IDs, invalid storage modes, invalid timestamps, and non-empty `customRules` during Phase 2A. `customRules` exists in the persisted shape but Phase 2A only accepts `[]`; executable/custom DSL support remains Phase 2F.

- [ ] **Step 2: Run the new test file and verify failure**

Run: `bun run test -- tests/storage/workspace-domain.test.ts`

Expected: FAIL because workspace domain modules do not exist.

- [ ] **Step 3: Implement domain types, defaults, and validators**

Use `general` preset + existing default terminology/citation/formatter behavior when creating the default profile. Set `SnapshotPolicy` default to `{ enabled: false, maxSnapshots: 20 }`; the limit is inert while snapshots are disabled.

Use stable constant IDs for the single bootstrap entities created in Phase 2A:

```text
local-default-workspace
local-default-profile
```

Migration-specific IDs are separate constants added in Task 6.

- [ ] **Step 4: Run domain tests**

Run: `bun run test -- tests/storage/workspace-domain.test.ts`

Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run: `bun run lint`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/workspace tests/storage/workspace-domain.test.ts
git commit -m "feat: add workspace storage domain model"
```

---

### Task 2: Repository ports と Memory implementation

**Files:**
- Create: `src/storage/repositories/ports.ts`
- Create: `src/storage/repositories/memory.ts`
- Create: `tests/storage/repository-contract.ts`
- Create: `tests/storage/memory-repositories.test.ts`

**Interfaces:**
- Consumes: Task 1 domain models and validators。
- Produces:

```ts
interface WorkspaceRepository {
  list(): Promise<Workspace[]>
  get(id: string): Promise<Workspace | undefined>
  save(value: Workspace): Promise<void>
  delete(id: string): Promise<void>
}

interface PreferencesRepository {
  get(): Promise<GlobalPreferences | undefined>
  save(value: GlobalPreferences): Promise<void>
}

interface RuleProfileRepository {
  list(): Promise<RuleProfile[]>
  get(id: string): Promise<RuleProfile | undefined>
  save(value: RuleProfile): Promise<void>
  delete(id: string): Promise<void>
}

interface DocumentRepository {
  listByWorkspace(workspaceId: string): Promise<StoredWorkspaceDocument[]>
  get(id: string): Promise<StoredWorkspaceDocument | undefined>
  save(value: StoredWorkspaceDocument): Promise<void>
  delete(id: string): Promise<void>
}

interface MigrationResult {
  state: 'not-needed' | 'migrated' | 'recovered-with-warning' | 'failed'
  warning?: string
  recoveredLegacyDocument?: LegacyStoredDocument
}

interface AtomicOperationsPort {
  migrateV1ToV2(): Promise<MigrationResult>
  deleteWorkspaceCascade(workspaceId: string): Promise<void>
}
```

`importWorkspaceBundle()` is deliberately not added in Phase 2A because the validated import bundle contract belongs to Phase 2G. Add it when that contract exists rather than introduce an unused placeholder method now.

- [ ] **Step 1: Write a reusable repository contract suite**

The contract must assert for workspace/profile/document repositories:

- save → get round-trip
- save same ID replaces rather than duplicates
- delete removes only the requested record
- workspace document query never returns another workspace's documents
- returned objects are not shared mutable references with internal memory state

- [ ] **Step 2: Run memory repository tests and verify failure**

Run: `bun run test -- tests/storage/memory-repositories.test.ts`

Expected: FAIL because memory repositories do not exist.

- [ ] **Step 3: Implement ports and memory repositories**

Memory repositories must run persisted-record validators on write and clone on read/write boundaries. Implement `deleteWorkspaceCascade()` atomically from the caller's perspective by applying changes to cloned maps and swapping them only after all validation succeeds.

`migrateV1ToV2()` in the memory adapter returns `not-needed`; memory fallback never pretends to migrate persistent v1 data.

- [ ] **Step 4: Run memory contract tests**

Run: `bun run test -- tests/storage/memory-repositories.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/storage/repositories tests/storage/repository-contract.ts tests/storage/memory-repositories.test.ts
git commit -m "feat: add storage repository ports and memory adapter"
```

---

### Task 3: IndexedDB v2 schema creation

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`
- Create: `src/storage/db/schema.ts`
- Create: `src/storage/db/idb-utils.ts`
- Create: `src/storage/db/open-database.ts`
- Test: `tests/storage/indexeddb-schema.test.ts`

**Interfaces:**
- Produces:
  - `DB_NAME = 'japanese-writing-toolkit'`
  - `DB_VERSION = 2`
  - store-name constants for all 7 v2 stores and 2 legacy stores
  - `openDatabase(factory: IDBFactory = indexedDB): Promise<IDBDatabase>`
  - `requestToPromise<T>(request: IDBRequest<T>): Promise<T>`
  - `transactionDone(tx: IDBTransaction): Promise<void>`

- [ ] **Step 1: Add `fake-indexeddb@6.2.5` as a dev dependency**

Run: `bun add -d fake-indexeddb@6.2.5`

Expected: `package.json` and `bun.lock` change only for the test dependency graph.

- [ ] **Step 2: Write schema upgrade tests before implementation**

Create a v1 fixture database containing:

```text
settings/app-config
 documents/recent
```

Then open it through the new v2 opener and assert:

- DB version is `2`.
- legacy `settings` / `documents` still exist.
- all v2 stores exist.
- `workspaceDocuments` has indexes `workspaceId` and `updatedAt`.
- `documentSnapshots` has indexes `documentId` and `[documentId, createdAt]`.
- `suppressions` has indexes `[scope, scopeId]` and `ruleId`.
- legacy values are byte-for-byte/deep-equal unchanged after schema upgrade.
- no migrated workspace/profile/document is created by `onupgradeneeded` itself.

- [ ] **Step 3: Run schema test and verify failure**

Run: `bun run test -- tests/storage/indexeddb-schema.test.ts`

Expected: FAIL because the v2 opener does not exist.

- [ ] **Step 4: Implement schema-only `openDatabase()`**

`onupgradeneeded` must create missing stores/indexes idempotently and must not read/transform application data.

- [ ] **Step 5: Run schema test**

Run: `bun run test -- tests/storage/indexeddb-schema.test.ts`

Expected: PASS.

- [ ] **Step 6: Run full existing suite**

Run: `bun run test`

Expected: existing tests still PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json bun.lock src/storage/db tests/storage/indexeddb-schema.test.ts
git commit -m "feat: add IndexedDB v2 schema"
```

---

### Task 4: IndexedDB repository implementations

**Files:**
- Create: `src/storage/repositories/indexeddb.ts`
- Test: `tests/storage/indexeddb-repositories.test.ts`
- Reuse: `tests/storage/repository-contract.ts`

**Interfaces:**
- Consumes: Task 2 ports, Task 3 `IDBDatabase`, Task 1 validators。
- Produces:
  - `createIndexedDbRepositories(db: IDBDatabase): StorageRepositories`
  - where `StorageRepositories` contains `workspaces`, `preferences`, `profiles`, `documents`.

- [ ] **Step 1: Apply the same contract suite to IndexedDB repositories**

Use a fresh `fake-indexeddb` database per test and delete it after each test.

Add a corruption test that inserts an invalid raw record directly into `workspaces`, then asserts `workspaces.get(id)` rejects with a storage validation error rather than returning the raw object.

- [ ] **Step 2: Run IndexedDB repository tests and verify failure**

Run: `bun run test -- tests/storage/indexeddb-repositories.test.ts`

Expected: FAIL because IndexedDB repositories do not exist.

- [ ] **Step 3: Implement IndexedDB repositories**

Use one transaction per single-repository operation. Reads must validate persisted records before returning them. `listByWorkspace()` must use the `workspaceId` index rather than loading/filtering the entire store.

- [ ] **Step 4: Run IndexedDB repository contract tests**

Run: `bun run test -- tests/storage/indexeddb-repositories.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/storage/repositories/indexeddb.ts tests/storage/indexeddb-repositories.test.ts
git commit -m "feat: add IndexedDB storage repositories"
```

---

### Task 5: AppConfig compatibility projection

**Files:**
- Create: `src/storage/compat/app-config-projection.ts`
- Test: `tests/storage/app-config-projection.test.ts`

**Interfaces:**
- Consumes: existing `AppConfig`, Task 1 `GlobalPreferences`, `Workspace`, `RuleProfile`。
- Produces:

```ts
interface ProjectedStorageState {
  preferences: GlobalPreferences
  workspace: Workspace
  profile: RuleProfile
}

function composeAppConfig(state: ProjectedStorageState): AppConfig
function splitAppConfig(config: AppConfig, current: ProjectedStorageState, now: number): ProjectedStorageState
```

Mapping rules:

```text
local-library -> privacy.autoSave=true, privacy.privacyMode=false
private-session -> privacy.autoSave=false, privacy.privacyMode=true

privacyMode=true -> private-session
autoSave=false -> private-session
autoSave=true && privacyMode=false -> local-library
```

`file-backed` is not produced by existing `AppConfig` in Phase 2A.

- [ ] **Step 1: Write projection tests**

Assert:

- theme/editor live in `GlobalPreferences`.
- rules/ngWords/terminology/citation/formatter live in `RuleProfile`.
- preset maps to/from `sourcePresetId`; `custom` stays `custom` semantics.
- storage mapping follows the table above.
- `split(compose(domainState))` preserves all Phase 2A domain semantics.
- `compose(split(appConfig))` preserves lint/rule/editor/theme semantics; privacy booleans may normalize to the canonical pair for their storage mode.
- nested arrays/maps are cloned; mutating the composed `AppConfig` does not mutate the persisted domain records.

- [ ] **Step 2: Run projection test and verify failure**

Run: `bun run test -- tests/storage/app-config-projection.test.ts`

Expected: FAIL because projection functions do not exist.

- [ ] **Step 3: Implement projection functions**

Do not call IndexedDB or browser APIs from this module.

- [ ] **Step 4: Run projection tests**

Run: `bun run test -- tests/storage/app-config-projection.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/storage/compat tests/storage/app-config-projection.test.ts
git commit -m "feat: add AppConfig storage compatibility projection"
```

---

### Task 6: v1 → v2 migration mapping and atomic execution

**Files:**
- Create: `src/storage/db/migration-v1-v2.ts`
- Create: `src/storage/db/indexeddb-atomic-operations.ts`
- Test: `tests/storage/migration-v1-v2.test.ts`

**Interfaces:**
- Consumes: Task 1 defaults/validators, Task 3 DB, existing `validateAppConfig()` / `migrateConfig()`, existing v1 `StoredDocument` shape。
- Produces:
  - `MIGRATED_WORKSPACE_ID = 'migrated-v1-workspace'`
  - `MIGRATED_PROFILE_ID = 'migrated-v1-profile'`
  - `MIGRATED_DOCUMENT_ID = 'migrated-v1-recent-document'`
  - `migrateV1ToV2(db: IDBDatabase, now?: () => number): Promise<MigrationResult>`
  - `createIndexedDbAtomicOperations(db: IDBDatabase): AtomicOperationsPort`

- [ ] **Step 1: Write v1 fixture helpers and mapping tests**

Cover at minimum:

1. valid config + recent doc + `autoSave=true`, `privacyMode=false` → local-library workspace and copied v2 document.
2. valid config + no recent doc → no v2 document.
3. `privacyMode=true` + stale recent doc → private-session workspace; do **not** copy document content into `workspaceDocuments`; legacy record remains.
4. `autoSave=false` + stale recent doc → same privacy-preserving behavior.
5. corrupt config + valid recent doc → create default private-session preferences/workspace/profile; do not persist legacy body into v2; return `recovered-with-warning` with in-memory `recoveredLegacyDocument` reference/value.
6. migration called twice → exactly one workspace, one profile, at most one migrated document.
7. pre-existing `complete` marker → return `not-needed` without rewriting domain records.
8. forced transaction abort before complete → no partial new records from that transaction, legacy stores remain, subsequent retry succeeds.
9. migration failure → write `failed` marker in a separate best-effort meta transaction without deleting legacy data.

- [ ] **Step 2: Run migration tests and verify failure**

Run: `bun run test -- tests/storage/migration-v1-v2.test.ts`

Expected: FAIL because migration implementation does not exist.

- [ ] **Step 3: Implement atomic migration**

The main migration transaction must include all legacy source stores needed and all target stores/`meta` updated by migration. Write migrated domain records and the `complete` marker in the same successful transaction.

Do not delete or mutate legacy source records.

When config is absent entirely (fresh installation), create the Task 1 default private-session state and mark migration complete without manufacturing a recent document.

- [ ] **Step 4: Implement `deleteWorkspaceCascade()` transactionally**

In one `readwrite` transaction across `workspaces`, `workspaceDocuments`, `documentSnapshots`, and `suppressions`, remove the workspace and records scoped to it. Do not delete a RuleProfile in Phase 2A because profiles are independently referencable and multi-workspace sharing is a future concern.

- [ ] **Step 5: Run migration tests**

Run: `bun run test -- tests/storage/migration-v1-v2.test.ts`

Expected: PASS.

- [ ] **Step 6: Run repository + schema tests together**

Run: `bun run test -- tests/storage/indexeddb-schema.test.ts tests/storage/indexeddb-repositories.test.ts tests/storage/migration-v1-v2.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/storage/db/migration-v1-v2.ts src/storage/db/indexeddb-atomic-operations.ts tests/storage/migration-v1-v2.test.ts
git commit -m "feat: migrate legacy storage to IndexedDB v2"
```

---

### Task 7: Storage bootstrap と memory fallback

**Files:**
- Create: `src/storage/bootstrap.ts`
- Modify: `src/storage/repositories/memory.ts`
- Test: `tests/storage/storage-facade.test.ts` (bootstrap section)

**Interfaces:**
- Produces:

```ts
interface StorageContext {
  durable: boolean
  repositories: StorageRepositories
  atomic: AtomicOperationsPort
  migration: MigrationResult
}

function createStorageContext(options?: {
  factory?: IDBFactory
  now?: () => number
}): Promise<StorageContext>
```

- [ ] **Step 1: Write bootstrap failure/fallback tests**

Assert:

- normal fake IndexedDB → `durable=true`, migration runs once.
- `IDBFactory.open()` failure → resolves with `durable=false`, memory repositories, default private-session state.
- no global IndexedDB path can be injected as unavailable without throwing during module import.
- fallback context remains usable for repository reads/writes during the current session.

- [ ] **Step 2: Run bootstrap tests and verify failure**

Run: `bun run test -- tests/storage/storage-facade.test.ts`

Expected: FAIL because bootstrap does not exist.

- [ ] **Step 3: Implement bootstrap**

Never reject solely because persistent storage is unavailable. Reject only programmer/invariant errors that cannot be represented as fallback; normal IDB open/migration failure must produce a memory context with `MigrationResult.state='failed'` and a warning string.

- [ ] **Step 4: Run bootstrap tests**

Run: `bun run test -- tests/storage/storage-facade.test.ts`

Expected: PASS for bootstrap cases.

- [ ] **Step 5: Commit**

```bash
git add src/storage/bootstrap.ts src/storage/repositories/memory.ts tests/storage/storage-facade.test.ts
git commit -m "feat: add storage bootstrap and memory fallback"
```

---

### Task 8: Replace legacy `storage.ts` internals without changing its public API

**Files:**
- Modify: `src/storage/storage.ts`
- Test: `tests/storage/storage-facade.test.ts`

**Interfaces:**
- Preserve these existing exports/signatures:

```ts
interface StoredDocument {
  name: string
  content: string
  docType: DocumentType
  updatedAt: number
}

function isStorageAvailable(): boolean
function saveConfig(config: AppConfig): Promise<void>
function loadConfig(): Promise<AppConfig | undefined>
function saveRecentDocument(doc: StoredDocument): Promise<void>
function loadRecentDocument(): Promise<StoredDocument | undefined>
function deleteRecentDocument(): Promise<void>
```

Add only test/debug-safe reset injection if necessary, e.g. `__resetStorageForTests()` guarded as a non-product behavior; do not expose storage internals to UI components.

- [ ] **Step 1: Write façade compatibility tests**

Assert:

- fresh installation `loadConfig()` returns a valid canonical AppConfig whose privacy representation is private-session (`autoSave=false`, `privacyMode=true`).
- `saveConfig()` splits fields across preferences/profile/workspace and `loadConfig()` recomposes equivalent semantics.
- in local-library mode, `saveRecentDocument()` writes one `workspaceDocuments` record using the active workspace.
- in private-session mode, `saveRecentDocument()` resolves without persisting content.
- `deleteRecentDocument()` removes the active migrated/default workspace document but never deletes legacy `documents/recent` during Phase 2A.
- corrupt v2 record does not make `loadConfig()` return unvalidated data.
- IDB failure path returns defaults / memory behavior without throwing through `loadConfig()`.

- [ ] **Step 2: Run façade tests and verify failure**

Run: `bun run test -- tests/storage/storage-facade.test.ts`

Expected: FAIL against the old direct-v1 implementation.

- [ ] **Step 3: Reimplement `storage.ts` as a lazy compatibility façade**

Use one cached `Promise<StorageContext>` so concurrent calls share initialization/migration.

Active entities in Phase 2A are the single migrated/default workspace and its active profile. Do not add workspace switching UI yet.

`isStorageAvailable()` retains its UI meaning: return whether the browser exposes IndexedDB synchronously. Durable-open failure discovered later is surfaced through fallback context, not by changing the synchronous signature.

- [ ] **Step 4: Run façade tests**

Run: `bun run test -- tests/storage/storage-facade.test.ts`

Expected: PASS.

- [ ] **Step 5: Run all storage tests**

Run: `bun run test -- tests/storage`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/storage/storage.ts tests/storage/storage-facade.test.ts
git commit -m "refactor: route legacy storage API through v2 repositories"
```

---

### Task 9: Minimal app bootstrap integration and regression protection

**Files:**
- Modify: `src/app/App.tsx`
- Modify only if required: `src/state/actions.ts`
- Test: extend `tests/storage/storage-facade.test.ts` or add focused pure helper tests; do not introduce DOM-heavy E2E in Phase 2A.

**Interfaces:**
- Consumes existing `loadConfig()`, `loadRecentDocument()`, `isStorageAvailable()` façade only。
- Produces no new UI-facing subsystem API.

- [ ] **Step 1: Add regression tests for startup semantics that can be tested without mounting the full Solid app**

Pin these expectations through façade/projection tests:

- fresh user does not restore/persist document body by default.
- migrated local-library user still restores the migrated recent document.
- migrated private-session user does not restore stale legacy body automatically.
- corrupt config recovery never blocks loading a valid default AppConfig.

- [ ] **Step 2: Adjust `App.tsx` only where old defaults conflict with the new canonical projection**

Keep existing startup order: storage feature detection → config restore → configLoaded → eligible recent document restore → initial lint.

Do not add workspace UI, storage quota UI, or new dialogs.

If existing `App.tsx` already behaves correctly solely through the façade's canonical AppConfig, leave it unchanged.

- [ ] **Step 3: Keep `src/state/actions.ts` unchanged unless a failing test proves a compatibility break**

The existing checks:

```text
privacyMode || !autoSave -> do not autosave
```

must continue to enforce private-session after projection. Avoid speculative refactoring.

- [ ] **Step 4: Run existing and new tests**

Run: `bun run test`

Expected: all existing tests plus Phase 2A tests PASS.

- [ ] **Step 5: Run typecheck**

Run: `bun run lint`

Expected: PASS.

- [ ] **Step 6: Commit only if app/action files actually changed**

```bash
git add src/app/App.tsx src/state/actions.ts tests/storage
git commit -m "fix: preserve startup behavior on storage v2"
```

Skip the commit if no product file change is required.

---

### Task 10: Verification, review, and PR preparation

**Files:**
- No planned product-code changes unless verification exposes a defect.
- Update: PR description/checklist after implementation.

**Interfaces:**
- Consumes all previous tasks.
- Produces a Phase 2A branch ready for whole-branch review.

- [ ] **Step 1: Run the full test suite from a clean dependency install**

Run:

```bash
bun ci
bun run test
```

Expected: all tests PASS. Record the final test count in the PR; do not assume it remains 125 after adding Phase 2A tests.

- [ ] **Step 2: Run static/build gates**

Run:

```bash
bun run lint
bun run build
bun run build:pages
```

Expected: all commands exit 0.

- [ ] **Step 3: Verify Pages asset paths exactly as CI does**

Run:

```bash
grep -q '/japanese_text/assets/' dist/index.html
grep -R -q '/japanese_text/assets/analysis.worker-' dist/assets
```

Expected: both commands exit 0.

- [ ] **Step 4: Review the complete diff against Phase 2A non-goals**

Reject/remove any accidental implementation of:

- workspace management UI
- RuleProvider/RuleManifest refactor
- Suppression UI
- File System Access
- Cloud Sync / backend
- new proofreading rules
- legacy store deletion

- [ ] **Step 5: Review migration safety manually from tests and code**

Confirm:

- `onupgradeneeded` contains no application data conversion.
- complete marker and migrated records commit atomically.
- failed migration does not delete legacy records.
- retry is idempotent.
- private-session never writes document content to v2 stores.
- no code path downgrades DB version to 1.

- [ ] **Step 6: Push and inspect GitHub Actions PR CI**

Expected checks:

- Install dependencies ✅
- Typecheck ✅
- Unit tests ✅
- Production build ✅
- GitHub Pages build ✅
- Pages asset-path verification ✅

- [ ] **Step 7: Request whole-branch code review**

Review focus:

1. migration atomicity / retry
2. privacy regressions
3. IndexedDB transaction lifecycle mistakes
4. validation at persistence boundaries
5. compatibility projection semantic loss
6. fallback behavior
7. unnecessary Phase 2B+ scope leakage

- [ ] **Step 8: For every review finding, classify before editing**

For each finding record:

- true issue / false positive / design disagreement
- evidence
- at least one alternative fix when non-trivial
- chosen fix and regression risk

Then add a regression test before fixing true behavior bugs.

- [ ] **Step 9: Final verification after review fixes**

Run again:

```bash
bun run lint
bun run test
bun run build
bun run build:pages
```

Expected: all PASS and PR CI green before merge.

---

## Planned Commit Sequence

1. `feat: add workspace storage domain model`
2. `feat: add storage repository ports and memory adapter`
3. `feat: add IndexedDB v2 schema`
4. `feat: add IndexedDB storage repositories`
5. `feat: add AppConfig storage compatibility projection`
6. `feat: migrate legacy storage to IndexedDB v2`
7. `feat: add storage bootstrap and memory fallback`
8. `refactor: route legacy storage API through v2 repositories`
9. optional `fix: preserve startup behavior on storage v2`
10. review-fix commits only when justified by tests/evidence

## Definition of Done

Phase 2A is complete only when all of the following are true:

- Existing DB v1 data can open as DB v2 without deleting legacy stores.
- Migration is idempotent and atomic for target records + completion marker.
- New installations use private-session by default.
- Existing `autoSave=true && privacyMode=false` users retain local-library intent.
- Existing private users do not have stale legacy body silently copied into v2 persistent document storage.
- Corrupt v1 config cannot brick the editor/linter.
- IndexedDB unavailable/open failure degrades to usable memory/default state.
- Persisted v2 records are validated on read.
- Existing `AppConfig`-based UI/state continues to function through compatibility projection.
- Existing `storage.ts` public API remains callable by `App.tsx` / `actions.ts`.
- Full test suite, typecheck, ordinary build, Pages build, and Pages path checks pass.
- Whole-branch review has no unresolved Critical/Important issue.
- Phase 2B+ features have not leaked into this PR.
