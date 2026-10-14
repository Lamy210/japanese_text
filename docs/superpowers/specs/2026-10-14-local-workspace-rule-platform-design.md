# Local Workspace / Rule Platform 詳細設計

## 1. 目的

`Lamy210/japanese_text` を、単一文書・単一設定を前提としたブラウザ完結型 Linter / Formatter から、複数 Workspace・複数 Rule Profile・複数文書を安全に扱える local-first 日本語文章品質基盤へ拡張する。

本設計では以下を同時に達成する。

- 文章本文をサーバーへ送信しない既存の privacy-first 方針を維持する。
- LLM、Backend、必須アカウントを追加しない。
- IndexedDB を中心とした永続化を、単一 recent document から multi-document / multi-workspace へ拡張する。
- ルール設定・NG ワード・用語辞書を Rule Profile として独立させる。
- built-in rule / textlint rule / user declarative rule を同じ抽象化で扱える Rule Platform を作る。
- 誤検知を運用可能にする Suppression 基盤を導入する。
- schema / storage migration、export / import、フォールバックを明示し、データ損失を避ける。
- 将来の CLI / VSCode extension / npm core で同じ設定・同じルール判定を再利用できる境界を作る。

## 2. 現状

現在の主な実装は以下。

- `src/storage/storage.ts`
  - IndexedDB database `japanese-writing-toolkit` version 1。
  - object store は `settings` / `documents`。
  - `settings/app-config` に `AppConfig` を保存。
  - `documents/recent` に直近 1 文書のみ保存。
  - IndexedDB が利用できない場合はメモリ運用を想定。
- `src/core/config/schema.ts`
  - `AppConfig` に preset / rule settings / NG words / terminology / citation / formatter / editor / privacy / theme を集約。
  - config schema version は 1。
- `src/core/config/validate.ts`
  - unknown input を検証し、未知キー・未知ルールへの前方互換を持つ。
  - config migration の入口が存在。
- `src/core/rules/registry.ts`
  - built-in rule を `buildRuleRegistry()` 内で直接列挙。
  - textlint rule meta は別 map。
- `src/state/app-state.ts`
  - document / diagnostics / config / worker / UI state を単一 façade で公開。

この構成は MVP として妥当だが、次の制約がある。

1. 保存文書が 1 件のみ。
2. `AppConfig` が global preference と文章品質 profile を混在させている。
3. preset とユーザー設定の境界が弱く、複数用途を切り替えにくい。
4. rule registry が central list で、rule 数増加時に拡張性が落ちる。
5. 誤検知に対する永続的な ignore / suppression がない。
6. IndexedDB migration の実データ移行戦略が未定義。
7. browser storage の quota / eviction / persistence 状態が UI から分からない。

## 3. 基本原則

### 3.1 Privacy-first

- 本文を外部 API へ送信しない。
- 新規ユーザーの既定 storage mode は `private-session`。
- 設定・辞書はローカル保存可能だが、本文永続化は明示 opt-in とする。
- telemetry / analytics は本設計では追加しない。
- 名前、メールアドレス等の個人識別情報を要求しない。

### 3.2 Local-first

IndexedDB を primary local persistence とする。

Cloud sync は本設計の scope 外。将来追加する場合も local data model を正とし、同期層は adapter として追加する。

### 3.3 Derived data は保存しない

以下は保存しない。

- diagnostics
- lint timing
- worker status
- selected diagnostic
- severity filter

これらは本文 + Rule Profile から再計算可能だからである。

### 3.4 Stable IDs

Workspace / Document / RuleProfile / Suppression / CustomRule は immutable ID を持つ。

表示名変更で参照が壊れないことを必須とする。

### 3.5 No arbitrary remote code

ユーザーが URL / npm package を指定して任意 JavaScript rule をロードする機能は提供しない。

ユーザー拡張は schema 検証可能な declarative rule DSL のみに限定する。

## 4. 検討したアプローチ

### A. Backend + User Account

長所:

- 複数端末同期が容易。
- backup を中央管理できる。

短所:

- 認証、DB、運用、個人情報、漏洩リスクが増える。
- 現状の「文章を外部へ送らない」という差別化を弱める。
- conflict resolution / E2EE / account recovery まで必要になる。

採用しない。

### B. localStorage 中心

長所:

- 実装が単純。

短所:

- structured multi-record data に不向き。
- 同期 API。
- 容量・migration・query の面で document library に適さない。

採用しない。

### C. IndexedDB local-first + Export / Import

長所:

- 現行実装を継承できる。
- structured data / multi-store / transaction を利用できる。
- Backend 不要。
- browser-only を維持できる。
- 将来 OPFS / file-backed / cloud sync を adapter として追加できる。

短所:

- ブラウザ削除・storage eviction への backup 対策が必要。
- IndexedDB migration 設計が必要。

本設計で採用する。

## 5. Target Architecture

```text
┌─────────────────────────────────────────────┐
│ UI                                          │
│ SolidJS / CodeMirror                        │
└──────────────────────┬──────────────────────┘
                       │
┌──────────────────────▼──────────────────────┐
│ Application Layer                           │
│ WorkspaceService / DocumentService          │
│ RuleProfileService / SuppressionService     │
└───────────────┬─────────────────┬───────────┘
                │                 │
┌───────────────▼──────────┐  ┌───▼─────────────────────┐
│ Analysis Core            │  │ Persistence Ports        │
│ RuleProvider / Engine    │  │ Repositories             │
│ Formatter / Diagnostics  │  │ AtomicOperationsPort     │
└───────┬────────┬─────────┘  └────────────┬─────────────┘
        │        │                         │
┌───────▼───┐ ┌──▼──────────────┐  ┌──────▼──────────────┐
│ Built-in  │ │ textlint / DSL  │  │ IndexedDB Adapter   │
│ Provider  │ │ Providers       │  │ Memory Fallback     │
└───────────┘ └─────────────────┘  └─────────────────────┘
```

UI は IndexedDB を直接操作しない。

Storage / analysis の browser implementation と domain model を分離する。

## 6. Domain Model

### 6.1 Workspace

```ts
interface Workspace {
  id: string
  name: string
  activeRuleProfileId: string
  storageMode: StorageMode
  snapshotPolicy: SnapshotPolicy
  createdAt: number
  updatedAt: number
}

type StorageMode = 'private-session' | 'local-library' | 'file-backed'
```

初期実装では `private-session` / `local-library` を提供し、`file-backed` は model 上予約して UI では feature detection 後に段階導入する。

### 6.2 GlobalPreferences

`AppConfig` から user / device preference を分離する。

```ts
interface GlobalPreferences {
  schemaVersion: number
  theme: ThemeMode
  editor: EditorPreferences
  defaultStorageMode: Exclude<StorageMode, 'file-backed'>
}
```

新規ユーザーの `defaultStorageMode` は `private-session`。

### 6.3 RuleProfile

```ts
interface RuleProfile {
  id: string
  name: string
  sourcePresetId?: PresetId
  rules: Record<string, RuleSetting>
  ngWords: NgWordEntry[]
  terminology: TermEntry[]
  citation: CitationPolicy
  formatter: FormatterPolicy
  customRules: DeclarativeRule[]
  createdAt: number
  updatedAt: number
}
```

Built-in preset は immutable template とし、ユーザーが変更するときは RuleProfile に clone する。

### 6.4 Document

```ts
interface StoredDocumentV2 {
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

`private-session` の本文は repository に渡さない。

`file-backed` は将来 `FileSystemFileHandle` 等を adapter 内部で管理するが、domain model は browser API 型へ依存させない。

### 6.5 DocumentSnapshot

```ts
interface DocumentSnapshot {
  id: string
  documentId: string
  revision: number
  content: string
  reason: 'autosave' | 'manual' | 'before-format' | 'before-import'
  createdAt: number
}
```

初期 default retention:

- snapshot 機能 OFF。
- ユーザーが ON にした場合のみ保存。
- 保存数上限を設ける。
- pruning は document 保存成功後に best-effort で行う。

無制限履歴は禁止する。

### 6.6 Suppression

```ts
type SuppressionScope = 'document' | 'workspace' | 'profile'
type SuppressionKind = 'rule' | 'message' | 'term'

interface Suppression {
  id: string
  scope: SuppressionScope
  scopeId: string
  kind: SuppressionKind
  ruleId?: string
  match?: string
  reason?: string
  createdAt: number
}
```

`Ignore once` は persisted suppression にせず、current revision に対する一時 state とする。

## 7. IndexedDB v2

DB name は互換性のため `japanese-writing-toolkit` を維持し、DB version を 2 に上げる。

### 7.1 Object stores

```text
meta
workspaces
preferences
ruleProfiles
workspaceDocuments
documentSnapshots
suppressions
```

既存 `settings` / `documents` store は DB v2 では削除しない。

理由:

- upgrade 中断時の復旧余地を残す。
- migration 完了を確認してから将来 DB v3 で legacy store を削除できる。
- 新 store 名へ version number を埋め込まず、将来の schema version と logical name を分離する。

### 7.2 Key / index

- `workspaces`: keyPath `id`
- `preferences`: out-of-line key、key `global`
- `ruleProfiles`: keyPath `id`
- `workspaceDocuments`: keyPath `id`
  - index `workspaceId`
  - index `updatedAt`
- `documentSnapshots`: keyPath `id`
  - index `documentId`
  - index `[documentId, createdAt]`
- `suppressions`: keyPath `id`
  - index `[scope, scopeId]`
  - index `ruleId`
- `meta`: out-of-line string key

永続 record は read 時にも validation を通す。IndexedDB にある値を型 assertion だけで信用しない。

### 7.3 Schema upgrade と data migration を分離

`onupgradeneeded` の責務は store / index 作成だけに限定する。

DB open 成功後、通常 transaction として legacy data migration を実行する。

理由:

- versionchange transaction 内へ複雑な application migration logic を詰め込まない。
- migration retry / error reporting / unit test を容易にする。
- schema creation と user data conversion の failure mode を分離する。

### 7.4 Migration marker

`meta/storage-schema-version = 2`

`meta/v1-migration-status` に以下を持つ。

```ts
type MigrationStatus =
  | { state: 'pending' }
  | { state: 'complete'; migratedAt: number }
  | { state: 'failed'; message: string; failedAt: number }
```

migration は idempotent とする。

## 8. v1 -> v2 Migration

### 8.1 原則

- legacy data を先に削除しない。
- migration 対象 record と completion marker は可能な限り同一 IndexedDB transaction で確定する。
- new records 作成成功前に `complete` を書かない。
- migration が途中で失敗しても次回起動で retry 可能。
- deterministic migration ID と marker により duplicate record を作らない。
- legacy store は Phase 2A では read-only migration source とし、削除しない。

### 8.2 Config migration

既存 `settings/app-config` を読み、`validateAppConfig()` / `migrateConfig()` を通す。

その後以下へ分割する。

```text
AppConfig.editor/theme
  -> GlobalPreferences

AppConfig.rules/ngWords/terminology/citation/formatter
  -> RuleProfile "Migrated profile"

AppConfig.privacy
  -> Workspace.storageMode
```

storage mode mapping:

```text
privacyMode = true
  -> private-session

autoSave = false
  -> private-session

autoSave = true && privacyMode = false
  -> local-library
```

ただし新規 installation の default は常に `private-session`。

既存ユーザーについては既存の保存意図を尊重して migration する。

### 8.3 Recent document migration

`documents/recent` が存在する場合:

1. deterministic migration document ID を使用。
2. migrated workspace に document を作る。
3. v1 record は削除しない。
4. workspace / profile / preferences / document / complete marker を transaction boundary 内で整合させる。

recent document が存在しない場合は document record を作らない。

### 8.4 Corrupt config

v1 config が validation 失敗した場合:

- app 起動を止めない。
- default private workspace + default profile を作る。
- legacy data は保持。
- UI に「旧設定の読み込みに失敗した」warning を表示できる status を返す。

本文 record が読める場合は config failure と独立して救出する。

### 8.5 Migration retry

`failed` marker があっても legacy stores が存在する限り retry を許可する。

retry 前に deterministic IDs の existing records を読み、同一 migration source 由来であれば update、異なる user data と衝突する場合は上書きせず error にする。

## 9. Persistence Interfaces / Atomicity

Browser API を core へ漏らさない。

```ts
interface WorkspaceRepository {
  list(): Promise<Workspace[]>
  get(id: string): Promise<Workspace | undefined>
  save(workspace: Workspace): Promise<void>
  delete(id: string): Promise<void>
}

interface DocumentRepository {
  listByWorkspace(workspaceId: string): Promise<StoredDocumentV2[]>
  get(id: string): Promise<StoredDocumentV2 | undefined>
  save(document: StoredDocumentV2): Promise<void>
  delete(id: string): Promise<void>
}

interface RuleProfileRepository { /* equivalent CRUD */ }
interface SuppressionRepository { /* scope query + CRUD */ }
```

実装:

- `IndexedDb*Repository`
- `Memory*Repository`

ただし、repository を順番に呼ぶだけでは複数 store の atomicity を保証できない。以下の複合操作は storage adapter の `AtomicOperationsPort` を通す。

```ts
interface AtomicOperationsPort {
  migrateV1ToV2(): Promise<MigrationResult>
  deleteWorkspaceCascade(workspaceId: string): Promise<void>
  importWorkspaceBundle(bundle: ValidatedWorkspaceBundle): Promise<void>
}
```

IndexedDB adapter は必要な stores を 1 transaction で開いて実行する。

Memory adapter も同じ observable behavior を contract test で保証する。

IndexedDB unavailable / open failure の場合は memory adapter へ degrade する。

UI / Service は concrete adapter を知らない。

## 10. Application Services

### WorkspaceService

責務:

- workspace create / rename / delete / activate。
- active profile 整合性保証。
- storage mode transition。
- delete など multi-store atomic operation を `AtomicOperationsPort` へ依頼。

### DocumentService

責務:

- create / open / rename / delete / save。
- storage mode に応じた persistence policy 適用。
- snapshot policy 適用。
- formatter 実行前 snapshot hook。

### RuleProfileService

責務:

- preset -> profile clone。
- profile validation。
- profile duplicate / rename / delete。
- workspace active profile の参照整合性。

### SuppressionService

責務:

- diagnostics へ suppression を適用。
- persisted / ephemeral suppression の統合。

Suppression は「最も強い scope を勝たせる」方式ではなく、適用可能な suppression のどれか 1 つでも match すれば diagnostic を suppress する。

`Ignore once` は current revision だけに適用する ephemeral layer とする。

suppression は severity を書き換えず、表示 / report 対象から除外する。

## 11. Existing AppConfig Compatibility Bridge

Phase 2A で storage model を先に v2 化する一方、既存 UI / `appState` は `AppConfig` を前提としている。

ここを big-bang で変更しないため、一時的な compatibility projection を導入する。

```ts
interface AppConfigProjection {
  compose(
    preferences: GlobalPreferences,
    workspace: Workspace,
    profile: RuleProfile
  ): AppConfig

  decompose(next: AppConfig, current: V2Context): V2ConfigChanges
}
```

Phase 2A では:

1. v2 records を canonical persistence とする。
2. app 起動時に active Workspace + RuleProfile + GlobalPreferences から `AppConfig` を合成する。
3. 既存 `appState.updateConfig()` の結果は projection で v2 records へ分解して保存する。
4. UI component は当面 `AppConfig` のまま動く。
5. Phase 2C で UI state を RuleProfile / GlobalPreferences native model へ移行したら bridge を削除する。

projection には round-trip test を必須とする。

```text
v2 -> AppConfig -> v2
```

で、表現可能な field が欠落しないことを保証する。

legacy `settings/app-config` は migration source として保持するが、migration 完了後の canonical write target にはしない。

## 12. State Management

`src/state/app-state.ts` を一度に解体しない。

big-bang refactor を避けるため、互換 façade を維持する。

追加候補:

```text
src/state/workspace-state.ts
src/state/document-state.ts
src/state/profile-state.ts
```

`appState` は既存 component 向け compatibility façade として段階的に delegate する。

これにより UI 全面書き換えを避ける。

## 13. Privacy Modes

### 13.1 Private Session

- default。
- config / dictionary / profile は保存可能。
- document content は IndexedDB に保存しない。
- reload で本文が失われることを UI に明示。

### 13.2 Local Library

- user opt-in。
- document content を IndexedDB に保存。
- opt-in 時に `navigator.storage.persist()` を best-effort で要求可能。
- permission / persistence request failure でも使用可能だが warning を表示。
- `navigator.storage.estimate()` による usage / quota 表示を Settings へ追加する。

### 13.3 File-backed

後続 phase。

- File System Access API 対応環境で user-selected file を source of truth とする。
- 非対応環境は import/download fallback。
- browser-only hard dependency にしない。

## 14. Rule Platform v2

### 14.1 RuleManifest

```ts
interface RuleManifest {
  id: string
  version: string
  name: string
  description: string
  category: string
  tier: RuleTier
  defaultSeverity: Severity
  fixKind: 'safe' | 'suggestion' | 'none'
  optionDefs?: RuleOptionDefinition[]
  documentation?: string
}
```

Rule ID は namespace 形式を維持する。

例:

```text
style/sentence-length
typography/nfd
wording/redundancy
markdown/heading-order
user/<uuid>
```

### 14.2 RuleProvider

```ts
interface RuleProvider {
  readonly id: string
  listManifests(): readonly RuleManifest[]
  createRules(context: RuleProviderContext): readonly CoreRule[]
}
```

Providers:

1. `BuiltinRuleProvider`
2. `TextlintRuleProvider`
3. `DeclarativeRuleProvider`

`buildRuleRegistry()` は provider aggregation に置換する。

### 14.3 RulePack

RulePack は rule implementation を保持しない。

```ts
interface RulePack {
  id: string
  name: string
  description: string
  ruleSettings: Record<string, RuleSetting>
}
```

Built-in preset は将来的に RulePack template として表現できる。

## 15. Declarative Custom Rules

任意 JavaScript 実行は禁止。

初期 DSL:

```ts
type DeclarativeRule =
  | LiteralRule
  | RegexRule
  | RequiredWordRule
  | MaxOccurrenceRule
```

### LiteralRule

- forbidden literal
- replacement optional
- case-sensitive option

### RegexRule

- pattern
- flags whitelist
- replacement optional

制限:

- pattern length 上限。
- flags whitelist (`gimu` 等、必要最小限)。
- compile validation。
- analysis Worker 内のみ実行。
- main thread 側 watchdog で Worker 応答期限を監視する。
- timeout 時は Worker を破棄・再生成する。
- timeout に関与した custom rule ID を session quarantine set に入れ、同じ rule を自動再実行しない。
- quarantine は rule 編集または明示再有効化で解除する。

JS RegExp に完全な実行時間制限はないため、unsafe regex 対策を「pattern validation だけ」で完了扱いにしない。

将来 custom regex 比率が高まった場合に RE2 / WASM 系を再評価する。

## 16. Suppression

### 16.1 UI actions

Diagnostic menu から以下を提供する。

- Ignore once
- Ignore this rule in document
- Ignore this rule in workspace
- Disable rule in active profile

`Disable rule in active profile` は suppression record ではなく RuleProfile の設定変更である。

term / message level suppression は rule ごとに対応可能な場合のみ表示。

### 16.2 Inline directives

後続 phase で Markdown / text document に以下を追加可能とする。

```html
<!-- japanese-text-disable wording/foo -->
<!-- japanese-text-enable wording/foo -->
<!-- japanese-text-disable-next-line wording/foo -->
```

parser は directive 自体を diagnostics の文字 offset 計算から除外しない。既存 text offset と整合する方式を採る。

## 17. Export / Import

### 17.1 Export unit

- Rule Profile export
- Workspace export
- Full local backup

### 17.2 Versioned manifest

```ts
interface ExportManifest {
  format: 'japanese-writing-toolkit'
  version: number
  exportedAt: number
  kind: 'profile' | 'workspace' | 'backup'
}
```

Import は必ず以下を行う。

1. JSON / archive parse。
2. manifest version validation。
3. schema validation。
4. ID collision detection。
5. dry-run summary。
6. user confirmation 後に atomic transaction。

Import 途中で既存データを破壊しない。

暗号化 backup は別 phase とし、導入する場合は password-derived key + authenticated encryption を前提とする。

## 18. Storage Persistence / Quota

Settings に Storage section を追加する。

表示候補:

- Storage mode
- IndexedDB availability
- persistent storage granted / not granted / unsupported
- estimated usage
- estimated quota
- document count
- backup recommendation

quota exceeded 時:

- 保存失敗を握りつぶさない。
- 編集中本文は memory に残す。
- status bar / toast で user に通知。
- snapshot 作成失敗だけで document 本体保存を rollback しない。

## 19. Error Handling

### IndexedDB open failure

- Memory adapter へ fallback。
- editor / lint は継続。
- persistent feature を disabled 表示。

### Transaction failure

- domain state を「保存済み」と表示しない。
- atomic operation は transaction abort により部分反映を残さない。
- retry 可能な error object に正規化。

### Migration failure

- legacy store を保持。
- default workspace でアプリを起動。
- migration status を error として Settings に表示。

### Corrupt document

- 他 document の読み込みを止めない。
- corrupt record 単位で隔離。

### Rule execution failure

- rule 単位で `RuleError` を生成。
- engine 全体を停止しない。
- Worker timeout は custom rule quarantine と Worker recreate で containment する。

## 20. Security

- remote script / remote plugin import 禁止。
- import data / IndexedDB record は unknown input として validation。
- prototype pollution を避けるため plain record の whitelist copy を使用。
- regex は Worker で隔離し、main thread watchdog を設ける。
- HTML rendering は user text を raw HTML として挿入しない。
- export filename に document name を使用する場合は path separator / control character を sanitize。
- file-backed 導入時も user gesture を必要とする browser permission model を迂回しない。

## 21. Performance

### Analysis

- Workspace / profile 保存処理を typing hot path に入れない。
- document autosave は debounce。
- profile 変更時のみ registry を rebuild。
- diagnostics は保存しない。

### Storage

- document list 取得時に content を全件読み込む設計を避ける。
- list UI 用 metadata と本文 read を分離できる repository API を許容する。
- snapshot pruning は idle / post-save で行う。

### Rule registry

RuleManifest 列挙は deterministic であり、同じ provider set + profile から同じ registry を構築する。

## 22. Compatibility / Migration Policy

3 種類の version を分離する。

```text
Config schema version
Storage DB version
Export format version
```

これらを同じ数字として連動させない。

理由:

- UI config 変更だけで IndexedDB schema を上げる必要はない。
- export format の互換性は storage implementation と別問題。

Migration は adjacent version chain とする。

```text
v1 -> v2 -> v3
```

`v1 -> latest` の巨大 migration 関数を作らない。

## 23. File Layout Proposal

段階的に以下へ整理する。

```text
src/
  core/
    config/
    rules/
      providers/
      declarative/
    workspace/
      types.ts
    suppression/
      types.ts
  app/
    services/
      workspace-service.ts
      document-service.ts
      rule-profile-service.ts
      suppression-service.ts
      app-config-projection.ts
  storage/
    db/
      open-database.ts
      migration-v1-v2.ts
      schema.ts
      atomic-operations.ts
    repositories/
      indexeddb/
      memory/
    storage-capabilities.ts
  state/
    app-state.ts
    workspace-state.ts
    document-state.ts
    profile-state.ts
```

最初の PR で全ディレクトリへ移動する必要はない。

機能追加と同時に責務境界を導入し、unrelated refactor は避ける。

## 24. Testing Strategy

変更ごとに regression test を必須とする。

### 24.1 Domain / validation unit tests

- Workspace validation。
- RuleProfile validation。
- DeclarativeRule validation。
- Suppression matching。
- migration mapping。
- AppConfig projection round-trip。

### 24.2 Storage contract tests

同一 contract test suite を以下へ適用する。

- Memory repositories
- IndexedDB repositories

確認項目:

- CRUD
- workspace index query
- document isolation
- transaction failure
- atomic delete cascade
- duplicate ID
- migration idempotency
- corrupt persisted record handling

IndexedDB test environment が必要なら `fake-indexeddb` 等の browser API compatible test dependency を dev-only で導入する。

### 24.3 Migration fixtures

fixture を固定する。

- valid v1 config + recent doc
- valid v1 config + no doc
- privacyMode true
- autoSave false
- corrupt config + valid doc
- missing stores
- migration interrupted marker
- deterministic ID already exists

同じ fixture を複数回 migration して duplicate が発生しないことを検証する。

migration transaction を意図的に fail させ、workspace/profile/document の部分反映が残らないことを検証する。

### 24.4 Rule tests

各 rule に最低限:

- positive detection
- negative detection
- boundary
- Unicode
- fix behavior
- regression case

を用意する。

### 24.5 Browser integration

後続で Playwright 等を導入する場合、最低限:

- Private Session では reload 後に本文が復元されない。
- Local Library では reload 後に本文が復元される。
- workspace/profile switching。
- export/import round-trip。
- storage unavailable fallback。

を対象にする。

## 25. CI Quality Gates

既存 CI:

- `bun ci`
- `bun run lint`
- `bun run test`
- `bun run build`
- `bun run build:pages`
- Pages path validation

を維持する。

Storage / Rule Platform 実装後は test suite を追加するが、GitHub Pages deployment contract を壊さない。

将来 E2E を追加する場合、PR CI と Pages deploy を分離し、deploy は unit/integration gate 成功後のみ許可する。

## 26. Observability

Backend telemetry は追加しない。

ローカル debug information として以下を user がコピー可能にすることは許容する。

- app version
- storage schema version
- config schema version
- enabled rule IDs
- worker capability
- IndexedDB availability
- persistent storage state

本文・NG words・terminology 自体は debug report に含めない。

## 27. Backup / Recovery

Local Library を有効にしたユーザーには backup 導線を用意する。

最低要件:

- manual export。
- import dry-run。
- schema validation。
- overwrite / merge を明示。

自動クラウド backup は行わない。

将来 persistent storage が granted でも、ブラウザデータ削除・端末故障からは保護されないため、export backup は別途必要。

## 28. CLI / VSCode Future Boundary

Core が SolidJS / IndexedDB / DOM に依存しない状態を目標にする。

将来:

```text
@japanese-text/core
@japanese-text/config
japanese-text CLI
VSCode extension
Web application
```

が同じ RuleProfile / RuleManifest / config validation を共有できるようにする。

`.japanese-text.json` 等の file config は将来 export format とは別 contract として設計する。

## 29. 実装フェーズ

### Phase 2A: Storage Foundation

- domain models。
- repository interfaces。
- IndexedDB v2 schema。
- v1 -> v2 migration。
- atomic operations port。
- memory fallback。
- AppConfig compatibility projection。
- migration tests / repository contract tests。
- UI behavior は最小変更。

### Phase 2B: Privacy / Workspace

- Private Session default。
- Local Library opt-in。
- workspace create / switch / rename / delete。
- storage capability / quota UI。

### Phase 2C: Rule Profiles

- GlobalPreferences と RuleProfile を UI state でも native に利用。
- preset clone。
- profile create / duplicate / rename / delete / switch。
- Phase 2A の AppConfig projection bridge を縮退・削除。

### Phase 2D: Multi-document Library

- document list。
- create / open / rename / delete。
- autosave policy。
- optional snapshot。

### Phase 2E: Rule Platform v2

- RuleManifest。
- RuleProvider。
- Builtin/Textlint providers。
- existing rules を provider registry へ移行。
- behavior parity regression tests。

### Phase 2F: Suppression / Declarative Rules

- Ignore once / document / workspace / profile。
- declarative literal rules。
- guarded regex rules。
- worker watchdog / quarantine / failure isolation。

### Phase 2G: Export / Import

- profile export/import。
- workspace backup。
- full local backup。
- dry-run + validation + atomic import。

### Later

- File System Access。
- PWA / stronger offline behavior。
- encrypted backup。
- npm core / CLI。
- VSCode extension。
- optional encrypted cloud sync。

## 30. 最初の実装スコープ

最初の implementation PR は Phase 2A のみに限定する。

理由:

- migration と永続化境界が最もリスクが高い。
- UI と rule refactor を同時に行うと regression 原因が追いにくい。
- Storage foundation が安定すれば後続機能を小さい PR に分割できる。

Phase 2A では見た目の大幅変更をしない。

既存 `appState` / editor / diagnostics behavior を compatibility projection 経由で維持しながら persistence layer を v2 化する。

## 31. Phase 2A Acceptance Criteria

1. DB version 1 の既存データから version 2 へデータ損失なく migration できる。
2. migration を複数回評価しても duplicate workspace/profile/document を生成しない。
3. migration transaction failure 時に v2 records の部分反映を残さない。
4. v1 legacy stores を削除しない。
5. corrupt config でも editor / lint が起動する。
6. IndexedDB unavailable 時に memory repository で editor / lint が継続する。
7. 新規ユーザーは `private-session` が default。
8. 既存ユーザーは旧 `privacy.autoSave/privacyMode` の意図を migration に反映する。
9. AppConfig compatibility projection の round-trip が検証される。
10. profile / workspace / document repository の contract tests がある。
11. existing tests を含む test suite が regression なく通る。
12. typecheck / production build / Pages build が通る。
13. main へ merge する前に PR CI が green。

## 32. Non-goals for Phase 2A

- Login / account。
- Server DB。
- Cloud sync。
- OPFS migration。
- File System Access UI。
- user JavaScript plugin。
- CLI / VSCode。
- new proofreading rule 大量追加。
- existing UI 全面 redesign。
- legacy IndexedDB stores の削除。

## 33. Rollback / Failure Containment

Phase 2A で legacy stores を残すため、v2 migration 前のデータを破壊しない。

ただし migration 完了後の canonical write target は v2 stores であり、legacy stores へ dual-write しない。したがって legacy store は「最新状態の backup」ではなく「migration 前状態の recovery source」である。

DB version 自体はブラウザ側で downgrade できないため、rollback release も DB version 2 を open できなければならない。

重大 regression 時の rollback は:

1. `DB_VERSION=1` へ戻さない。
2. DB v2 schema を理解する compatibility reader を維持する。
3. 必要なら legacy source を読み取り専用 recovery path として利用する。
4. post-migration user changes を失わないため、v2 stores を優先して読む。

単純な Git revert だけで storage rollback が成立するとは考えない。

## 34. 設計判断の要点

- User Account より Workspace を先に導入する。
- default は Private Session。
- Local Library は明示 opt-in。
- IndexedDB を継続利用する。
- OPFS は現時点では YAGNI。
- schema upgrade と data migration を分離する。
- multi-store mutation は atomic operations port を使う。
- config / storage / export version は分離する。
- diagnostics は保存しない。
- arbitrary JavaScript plugin を許可しない。
- custom rule は declarative DSL。
- unsafe regex は Worker watchdog + session quarantine で containment する。
- current app-state を一度に壊さず AppConfig compatibility projection を使う。
- migration を最初の独立 PR とし、UI / rule refactor と分離する。

この設計を Phase 2 の canonical design とし、次に Phase 2A の実装計画を作成してから TDD で開発する。
