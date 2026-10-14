# Phase 2A Storage Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** IndexedDB v1 の既存データを破壊せず local-first storage model v2 へ移行し、Workspace / RuleProfile / multi-document の後続開発を支える永続化境界を導入する。

**Architecture:** UI と `appState` は Phase 2A では既存 `AppConfig` / recent-document API を維持し、その裏側に domain model、repository ports、IndexedDB v2 adapter、memory fallback、v1→v2 migration、AppConfig compatibility projection を導入する。schema upgrade と data migration を分離し、multi-store mutation は storage adapter 内の atomic operation で完結させる。

**Tech Stack:** TypeScript 7、SolidJS、Vitest 5、IndexedDB、`fake-indexeddb@6.2.5`（test only）、Bun 1.4.3、Vite 8。

**Spec:**
- `docs/superpowers/specs/2026-10-14-local-workspace-rule-platform-design.md`
- `docs/superpowers/specs/2026-10-14-local-workspace-phase2a-clarifications.md`

## Global Constraints

- Backend / Login / LLM / Cloud Sync は追加しない。
- 新規 installation の canonical default は `private-session`。
- compatibility `AppConfig` の fresh default は `privacy: { autoSave: false, privacyMode: true }`。
- 本文をサーバーへ送信しない。
- DB name は `japanese-writing-toolkit`、IndexedDB version は `2`。
- v1 legacy **stores** `settings` / `documents` は Phase 2A で削除しない。
- migration 自体は legacy records を削除・更新しない。
- ただし migration 完了後の明示的 Privacy deletion は user intent を優先し、対応する legacy `documents/recent` record も削除する。
- 新 stores は `meta`, `workspaces`, `preferences`, `ruleProfiles`, `workspaceDocuments`, `documentSnapshots`, `suppressions`。
- `onupgradeneeded` は store / index 作成だけ。user data migration は open 後の通常 transaction。
- Config schema version / Storage DB version / Export format version を連動させない。
- diagnostics / worker state / lint timing は永続化しない。
- UI 全面改修、Rule Platform v2、Suppression UI、Export/Import、File System Access は Phase 2A の非対象。
- DB v2 へ上げた後の rollback で `DB_VERSION=1` に戻さない。
- 既存 lint / formatter / editor behavior を変更しない。
- `customRules` は field を保持するが Phase 2A では `[]` のみ有効。non-empty は reject。
- product-code change は failing test → minimal implementation → passing test の順。

## Review Focus

1. **旧 privacy 設定 + stale recent document:** `privacyMode=true` または `autoSave=false` の v1 user について stale body を v2 にコピーしない。
2. **migration 中断 / retry:** retry で duplicate workspace/profile/document を作らず、legacy records を migration 中に破壊しない。
3. **corrupt v1 config + valid document:** app を起動不能にせず private-session defaults を作り、本文は自動永続化せず recovery data としてのみ扱う。
4. **corrupt v2 record:** repository read は型 assertion で信用せず record validation failure にする。
5. **IndexedDB unavailable/open failure:** import/boot 時に crash せず memory/default path へ degrade する。

---

## File Map

**Create**

- `src/core/workspace/types.ts` — persistence-independent domain types。
- `src/core/workspace/defaults.ts` — defaults / stable bootstrap IDs。
- `src/core/workspace/validate.ts` — persisted v2 record validation。
- `src/storage/repositories/ports.ts` — repositories / atomic operation ports。
- `src/storage/repositories/memory.ts` — memory fallback。
- `src/storage/repositories/indexeddb.ts` — IndexedDB repositories。
- `src/storage/db/schema.ts` — DB/store/index constants。
- `src/storage/db/idb-utils.ts` — request/transaction helpers。
- `src/storage/db/open-database.ts` — schema upgrade only。
- `src/storage/db/migration-v1-v2.ts` — migration execution。
- `src/storage/db/indexeddb-atomic-operations.ts` — atomic multi-store operations。
- `src/storage/bootstrap.ts` — IDB/memory context bootstrap。
- `src/storage/compat/app-config-projection.ts` — v2 model ↔ existing AppConfig。
- `tests/storage/repository-contract.ts`
- `tests/storage/workspace-domain.test.ts`
- `tests/storage/memory-repositories.test.ts`
- `tests/storage/indexeddb-schema.test.ts`
- `tests/storage/indexeddb-repositories.test.ts`
- `tests/storage/app-config-projection.test.ts`
- `tests/storage/migration-v1-v2.test.ts`
- `tests/storage/storage-facade.test.ts`

**Modify**

- `src/core/config/schema.ts` — fresh privacy default only。
- `src/storage/storage.ts` — public API-compatible façade。
- `src/app/App.tsx` — only if façade alone cannot preserve startup semantics。
- `src/state/actions.ts` — only if a failing regression test requires a change。
- `package.json`, `bun.lock` — `fake-indexeddb@6.2.5`。

---

### Task 1: Domain model と fresh private-session default

**Files:**
- Create: `src/core/workspace/types.ts`
- Create: `src/core/workspace/defaults.ts`
- Create: `src/core/workspace/validate.ts`
- Modify: `src/core/config/schema.ts`
- Test: `tests/storage/workspace-domain.test.ts`

**Interfaces:**

```ts
type StorageMode = 'private-session' | 'local-library' | 'file-backed'

interface SnapshotPolicy {
  enabled: boolean
  maxSnapshots: number
}

interface Workspace {
  id: string
  name: string
  activeRuleProfileId: string
  storageMode: StorageMode
  snapshotPolicy: SnapshotPolicy
  createdAt: number
  updatedAt: number
}

interface GlobalPreferences {
  schemaVersion: number
  theme: ThemeMode
  editor: EditorPreferences
  defaultStorageMode: 'private-session' | 'local-library'
}

interface RuleProfile {
  id: string
  name: string
  sourcePresetId?: PresetId
  rules: Record<string, RuleSetting>
  ngWords: NgWordEntry[]
  terminology: TermEntry[]
  citation: CitationPolicy
  formatter: FormatterPolicy
  customRules: unknown[]
  createdAt: number
  updatedAt: number
}

interface StoredWorkspaceDocument {
  id: string
  workspaceId: string
  name: string
  docType: DocumentType
  content?: string
  sourceKind: 'local' | 'file'
  createdAt: number
  updatedAt: number
}
```

Produces:

```ts
const WORKSPACE_MODEL_SCHEMA_VERSION = 1
function createDefaultWorkspaceState(now: number): {
  workspace: Workspace
  preferences: GlobalPreferences
  profile: RuleProfile
}
function validateWorkspaceRecord(raw: unknown): Workspace
function validatePreferencesRecord(raw: unknown): GlobalPreferences
function validateRuleProfileRecord(raw: unknown): RuleProfile
function validateDocumentRecord(raw: unknown): StoredWorkspaceDocument
```

- [ ] **Step 1: Write failing tests**

Assert fresh defaults:

```ts
expect(DEFAULT_PRIVACY).toEqual({ autoSave: false, privacyMode: true })
expect(createDefaultWorkspaceState(1000).workspace.storageMode).toBe('private-session')
expect(createDefaultWorkspaceState(1000).preferences.defaultStorageMode).toBe('private-session')
expect(createDefaultWorkspaceState(1000).profile.sourcePresetId).toBe('general')
expect(createDefaultWorkspaceState(1000).workspace.snapshotPolicy).toEqual({ enabled: false, maxSnapshots: 20 })
```

Validators must reject arrays, missing IDs, invalid storage modes/timestamps, malformed rule/profile structures, and `customRules.length > 0`.

- [ ] **Step 2: Run and confirm RED**

Run: `bun run test -- tests/storage/workspace-domain.test.ts`

Expected: FAIL because the new domain modules/default are not implemented.

- [ ] **Step 3: Implement types/defaults/validators and change `DEFAULT_PRIVACY`**

Use stable fresh IDs:

```text
local-default-workspace
local-default-profile
```

Use existing General preset/default terminology/citation/formatter when constructing the default profile.

- [ ] **Step 4: Run and confirm GREEN**

Run:

```bash
bun run test -- tests/storage/workspace-domain.test.ts
bun run lint
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/workspace src/core/config/schema.ts tests/storage/workspace-domain.test.ts
git commit -m "feat: add workspace storage domain model"
```

---

### Task 2: Repository ports + Memory adapter

**Files:**
- Create: `src/storage/repositories/ports.ts`
- Create: `src/storage/repositories/memory.ts`
- Create: `tests/storage/repository-contract.ts`
- Test: `tests/storage/memory-repositories.test.ts`

**Interfaces:**

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

interface RecoveredDocument {
  name: string
  content: string
  docType: DocumentType
  updatedAt: number
}

interface MigrationResult {
  state: 'not-needed' | 'migrated' | 'recovered-with-warning' | 'failed'
  warning?: string
  recoveredDocument?: RecoveredDocument
}

interface AtomicOperationsPort {
  migrateV1ToV2(): Promise<MigrationResult>
  deleteWorkspaceCascade(workspaceId: string): Promise<void>
}
```

Phase 2G の `importWorkspaceBundle()` は import schema と同時に追加する。

- [ ] **Step 1: Write reusable contract tests**

For workspace/profile/document repositories assert save/get, overwrite same ID, delete isolation, workspace query isolation, and defensive cloning.

- [ ] **Step 2: Run and confirm RED**

Run: `bun run test -- tests/storage/memory-repositories.test.ts`

- [ ] **Step 3: Implement ports + memory adapter**

Validate on write; clone on write/read. `deleteWorkspaceCascade()` uses cloned maps and swaps only after the full operation succeeds. Memory `migrateV1ToV2()` returns `not-needed`.

- [ ] **Step 4: Verify**

Run: `bun run test -- tests/storage/memory-repositories.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/storage/repositories tests/storage/repository-contract.ts tests/storage/memory-repositories.test.ts
git commit -m "feat: add storage repository ports and memory adapter"
```

---

### Task 3: IndexedDB v2 schema-only upgrade

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`
- Create: `src/storage/db/schema.ts`
- Create: `src/storage/db/idb-utils.ts`
- Create: `src/storage/db/open-database.ts`
- Test: `tests/storage/indexeddb-schema.test.ts`

**Interfaces:**

```ts
const DB_NAME = 'japanese-writing-toolkit'
const DB_VERSION = 2
function openDatabase(factory: IDBFactory): Promise<IDBDatabase>
function requestToPromise<T>(request: IDBRequest<T>): Promise<T>
function transactionDone(tx: IDBTransaction): Promise<void>
```

Store constants include all 7 v2 stores plus legacy `settings` / `documents` names. `openDatabase()` must not have `indexedDB` as a default parameter; caller injects the factory after feature detection.

- [ ] **Step 1: Add test dependency**

Run: `bun add -d fake-indexeddb@6.2.5`

- [ ] **Step 2: Write schema fixture tests**

Start from a v1 DB with legacy records. After v2 open assert:

- DB version `2`。
- existing legacy stores/records remain unchanged。
- all v2 stores exist。
- indexes:
  - `workspaceDocuments`: `workspaceId`, `updatedAt`
  - `documentSnapshots`: `documentId`, compound `[documentId, createdAt]`
  - `suppressions`: compound `[scope, scopeId]`, `ruleId`
- no workspace/profile/document data conversion occurs in `onupgradeneeded`。
- a fresh database without legacy stores also opens correctly; migration code must therefore tolerate missing legacy stores。

- [ ] **Step 3: Run RED**

Run: `bun run test -- tests/storage/indexeddb-schema.test.ts`

- [ ] **Step 4: Implement schema-only opener**

Create v2 stores/indexes idempotently. Do not create legacy stores on a fresh v2 installation merely for compatibility; preserve them only when already present.

- [ ] **Step 5: Verify**

Run:

```bash
bun run test -- tests/storage/indexeddb-schema.test.ts
bun run test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock src/storage/db tests/storage/indexeddb-schema.test.ts
git commit -m "feat: add IndexedDB v2 schema"
```

---

### Task 4: IndexedDB repositories

**Files:**
- Create: `src/storage/repositories/indexeddb.ts`
- Test: `tests/storage/indexeddb-repositories.test.ts`
- Reuse: `tests/storage/repository-contract.ts`

**Interfaces:**

```ts
interface StorageRepositories {
  workspaces: WorkspaceRepository
  preferences: PreferencesRepository
  profiles: RuleProfileRepository
  documents: DocumentRepository
}

function createIndexedDbRepositories(db: IDBDatabase): StorageRepositories
```

- [ ] **Step 1: Apply repository contract suite to IndexedDB**

Add direct-corruption test: insert malformed raw workspace and verify repository `get()` rejects with validation error rather than returning asserted data.

- [ ] **Step 2: Run RED**

Run: `bun run test -- tests/storage/indexeddb-repositories.test.ts`

- [ ] **Step 3: Implement repositories**

One transaction per single-repository mutation. `listByWorkspace()` must use the `workspaceId` index. Validate every persisted object on read.

- [ ] **Step 4: Verify**

Run: `bun run test -- tests/storage/indexeddb-repositories.test.ts`

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

```ts
interface ProjectedStorageState {
  preferences: GlobalPreferences
  workspace: Workspace
  profile: RuleProfile
}

function composeAppConfig(state: ProjectedStorageState): AppConfig
function splitAppConfig(
  config: AppConfig,
  current: ProjectedStorageState,
  now: number
): ProjectedStorageState
```

Canonical privacy mapping:

```text
local-library  -> autoSave=true,  privacyMode=false
private-session -> autoSave=false, privacyMode=true

privacyMode=true                         -> private-session
autoSave=false                           -> private-session
autoSave=true && privacyMode=false       -> local-library
```

- [ ] **Step 1: Write projection tests**

Assert theme/editor → preferences; rules/ngWords/terminology/citation/formatter → profile; preset ↔ `sourcePresetId`; deep clone boundaries; storage mapping; `split(compose(domain))` preserves domain semantics; `compose(split(config))` preserves lint/editor/theme semantics while privacy booleans normalize canonically.

- [ ] **Step 2: Run RED**

Run: `bun run test -- tests/storage/app-config-projection.test.ts`

- [ ] **Step 3: Implement pure projection**

No browser/IndexedDB calls in this module.

- [ ] **Step 4: Verify and commit**

```bash
bun run test -- tests/storage/app-config-projection.test.ts
git add src/storage/compat tests/storage/app-config-projection.test.ts
git commit -m "feat: add AppConfig storage compatibility projection"
```

---

### Task 6: Atomic v1 → v2 migration

**Files:**
- Create: `src/storage/db/migration-v1-v2.ts`
- Create: `src/storage/db/indexeddb-atomic-operations.ts`
- Test: `tests/storage/migration-v1-v2.test.ts`

**Interfaces:**

```ts
const MIGRATED_WORKSPACE_ID = 'migrated-v1-workspace'
const MIGRATED_PROFILE_ID = 'migrated-v1-profile'
const MIGRATED_DOCUMENT_ID = 'migrated-v1-recent-document'

function migrateV1ToV2(
  db: IDBDatabase,
  now?: () => number
): Promise<MigrationResult>

function createIndexedDbAtomicOperations(db: IDBDatabase): AtomicOperationsPort
```

Meta keys:

```text
storage-schema-version
v1-migration-status
```

- [ ] **Step 1: Write migration fixtures/tests**

Must cover:

1. valid config + recent doc + local-library intent → migrated workspace/profile/document。
2. valid config + no doc → no migrated document。
3. `privacyMode=true` + stale doc → private-session; no v2 body copy; legacy record remains during migration。
4. `autoSave=false` + stale doc → same。
5. config missing `privacy` → privacy-safe private-session default。
6. corrupt config + valid doc → default private state, no v2 body copy, `recovered-with-warning` + `recoveredDocument`。
7. fresh DB with no legacy stores → default private state + complete marker。
8. migration called twice → no duplicates。
9. `complete` marker → `not-needed` and no rewrites。
10. `pending`/`failed` marker → retry allowed。
11. forced transaction abort → target records + complete marker do not partially commit; retry succeeds。
12. failure path writes best-effort `failed` marker separately while legacy records remain。
13. success sets `meta/storage-schema-version = 2` and complete status atomically with migrated target records。

- [ ] **Step 2: Run RED**

Run: `bun run test -- tests/storage/migration-v1-v2.test.ts`

- [ ] **Step 3: Implement migration**

Write `pending` status before the main migration transaction. Build the main transaction's store list dynamically so missing legacy stores on a fresh DB do not fail transaction creation. When legacy config exists, validate using existing config migration/validation; persisted explicit privacy values win. New target records + `storage-schema-version=2` + `complete` marker commit in one transaction.

Do not delete/update legacy source records in this migration function.

- [ ] **Step 4: Implement `deleteWorkspaceCascade()`**

One readwrite transaction across `workspaces`, `workspaceDocuments`, `documentSnapshots`, `suppressions`. Do not automatically delete RuleProfile in Phase 2A.

- [ ] **Step 5: Verify**

Run:

```bash
bun run test -- tests/storage/migration-v1-v2.test.ts
bun run test -- tests/storage/indexeddb-schema.test.ts tests/storage/indexeddb-repositories.test.ts tests/storage/migration-v1-v2.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/storage/db/migration-v1-v2.ts src/storage/db/indexeddb-atomic-operations.ts tests/storage/migration-v1-v2.test.ts
git commit -m "feat: migrate legacy storage to IndexedDB v2"
```

---

### Task 7: Storage bootstrap + memory fallback

**Files:**
- Create: `src/storage/bootstrap.ts`
- Modify: `src/storage/repositories/memory.ts`
- Test: `tests/storage/storage-facade.test.ts` (bootstrap cases)

**Interfaces:**

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

- [ ] **Step 1: Write fallback tests**

Assert fake IDB normal path → durable; missing factory/open failure → memory context + fresh private defaults; module import does not require global `indexedDB`; memory context works for current-session reads/writes.

- [ ] **Step 2: Run RED**

Run: `bun run test -- tests/storage/storage-facade.test.ts`

- [ ] **Step 3: Implement bootstrap**

Normal IndexedDB open/migration failures must degrade to memory/default state rather than brick the editor. Return `MigrationResult.state='failed'` + warning for degraded persistent path.

- [ ] **Step 4: Verify and commit**

```bash
bun run test -- tests/storage/storage-facade.test.ts
git add src/storage/bootstrap.ts src/storage/repositories/memory.ts tests/storage/storage-facade.test.ts
git commit -m "feat: add storage bootstrap and memory fallback"
```

---

### Task 8: Rewire legacy `storage.ts` façade

**Files:**
- Modify: `src/storage/storage.ts`
- Test: `tests/storage/storage-facade.test.ts`

**Preserve public API:**

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

- [ ] **Step 1: Write façade tests**

Assert:

- fresh `loadConfig()` → valid private-session canonical AppConfig。
- `saveConfig()` splits and `loadConfig()` recomposes equivalent semantics。
- local-library `saveRecentDocument()` persists under active workspace。
- private-session `saveRecentDocument()` resolves without persistent body write。
- migrated local-library `loadRecentDocument()` restores migrated v2 document。
- migrated private-session does not restore stale legacy body automatically。
- explicit `deleteRecentDocument()` removes v2 active document **and**, after migration is complete, legacy `documents/recent` record if present; legacy store remains。
- corrupt v2 records are not returned unvalidated。
- IDB failure does not escape from `loadConfig()` as an app-breaking error。

- [ ] **Step 2: Run RED**

Run: `bun run test -- tests/storage/storage-facade.test.ts`

- [ ] **Step 3: Implement lazy façade**

Use one cached `Promise<StorageContext>`. Phase 2A active entities are the migrated/default workspace + active profile; no workspace switching UI.

`isStorageAvailable()` remains synchronous feature detection. Durable-open failure is handled later by the fallback context.

For explicit privacy deletion, remove persisted v2 body and legacy `recent` body. This is the only Phase 2A path allowed to mutate the legacy document record, because it is direct user intent rather than migration cleanup.

- [ ] **Step 4: Verify**

Run:

```bash
bun run test -- tests/storage/storage-facade.test.ts
bun run test -- tests/storage
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/storage/storage.ts tests/storage/storage-facade.test.ts
git commit -m "refactor: route legacy storage API through v2 repositories"
```

---

### Task 9: Startup regression integration

**Files:**
- Modify if required: `src/app/App.tsx`
- Modify only if required by failing test: `src/state/actions.ts`
- Tests: existing suite + storage tests

- [ ] **Step 1: Verify the compatibility façade is sufficient before changing UI/state code**

Run all tests and inspect startup logic against canonical AppConfig privacy values.

- [ ] **Step 2: If a regression exists, write its failing test first**

Required startup semantics:

- fresh user does not persist/restore body by default。
- migrated local-library user restores migrated recent doc。
- migrated private user does not restore stale legacy body。
- corrupt config still yields valid default app config and lint startup。

- [ ] **Step 3: Make the smallest integration change**

Keep existing startup order: storage detection → config restore → `configLoaded` → eligible doc restore → initial lint. Do not add Phase 2B UI.

Keep `src/state/actions.ts` unchanged if its existing `privacyMode || !autoSave` check already enforces private-session correctly.

- [ ] **Step 4: Verify**

Run:

```bash
bun run test
bun run lint
```

Expected: PASS.

- [ ] **Step 5: Commit only if product integration files changed**

```bash
git add src/app/App.tsx src/state/actions.ts tests/storage
git commit -m "fix: preserve startup behavior on storage v2"
```

Skip if no integration change is necessary.

---

### Task 10: Full verification + review gate

**Files:** no planned product changes unless verification/review exposes a real defect.

- [ ] **Step 1: Clean verification**

```bash
bun ci
bun run test
bun run lint
bun run build
bun run build:pages
grep -q '/japanese_text/assets/' dist/index.html
grep -R -q '/japanese_text/assets/analysis.worker-' dist/assets
```

Expected: all exit 0. Record actual final test count; do not hard-code 125.

- [ ] **Step 2: Scope review**

Remove accidental Phase 2B+ work: workspace UI, RuleProvider refactor, Suppression UI, File System Access, backend/sync, new proofreading rules, legacy store deletion.

- [ ] **Step 3: Migration safety review**

Confirm:

- `onupgradeneeded` has no user-data conversion。
- complete marker + migrated target records commit atomically。
- pending/failed retry is idempotent。
- migration never removes legacy source records。
- explicit privacy deletion does remove body from both active v2 persistence and legacy recent record。
- private-session never writes document body to v2 storage。
- rollback never sets DB version back to 1。

- [ ] **Step 4: Whole-branch code review**

Review migration atomicity, IndexedDB transaction lifetime, privacy regression, persisted-record validation, projection semantic loss, fallback behavior, and scope leakage.

For every finding classify: true issue / false positive / design disagreement; collect evidence; for non-trivial fixes compare alternatives; add regression test before behavior fixes.

- [ ] **Step 5: Re-run full verification after review fixes**

Same command set as Step 1. All must pass and PR CI must be green before merge.

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
10. evidence-backed review fixes only

## Definition of Done

- v1 DB opens as v2 without migration-time deletion of legacy stores/records。
- migration is idempotent and target records + completion marker are atomic。
- fresh users are private-session even when IndexedDB is unavailable。
- explicit persisted old privacy settings retain their intent。
- private legacy users do not get stale body silently copied to v2 persistence。
- explicit privacy deletion does not leave a recoverable legacy recent body behind。
- corrupt v1 config cannot brick editor/linter and does not cause automatic body persistence。
- IndexedDB unavailable/open failure degrades to usable memory/default state。
- v2 records are validated on read。
- existing AppConfig UI/state continues through compatibility projection。
- existing `storage.ts` public API remains usable by `App.tsx` / `actions.ts`。
- full tests, typecheck, normal build, Pages build, Pages path checks, and PR CI pass。
- whole-branch review has no unresolved Critical/Important issue。
- Phase 2B+ functionality is not implemented in this PR。
