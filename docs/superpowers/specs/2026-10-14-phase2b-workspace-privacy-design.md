# Phase 2B Workspace / Privacy 詳細設計

## 1. 目的

Phase 2A で導入した local-first storage foundation を利用し、複数 Workspace を安全に作成・切替・改名・削除できる application layer と UI を追加する。

本文永続化は引き続き privacy-first とし、新規 Workspace の既定値を `private-session` に固定する。本文を IndexedDB に保存する `local-library` はユーザーが明示的に opt-in した場合だけ有効化する。

同時に、ブラウザ storage の利用可否、origin 全体の推定 usage / quota、persistent storage 状態を可視化する。

本フェーズでは document library/sidebar を導入せず、後続フェーズで multi-document UI を安全に載せるための active Workspace 境界を確立する。

## 2. 前提

Phase 2A で以下は実装済みである。

- Workspace / RuleProfile / GlobalPreferences / WorkspaceDocument domain model
- IndexedDB v2 schema
- v1 -> v2 migration
- repository ports
- Memory fallback
- AppConfig compatibility projection
- atomic projected config save
- privacy document/snapshot scrub
- private-session default

Phase 2B はこの境界を利用し、UI から IndexedDB を直接触らない。

## 3. 成功条件

- Header から active Workspace を確認・切替できる。
- Workspace create / switch / rename / delete が可能。
- 新規 Workspace は必ず `private-session`。
- 最後の 1 Workspace は削除できない。
- active Workspace 削除時も active selection が壊れない。
- Private Session の本文は IndexedDB に書き込まれない。
- Private Session の本文は同一タブ・同一アプリセッション内では Workspace ごとに memory 上で保持できる。
- Workspace 切替だけで Private Session 本文を黙って失わない。
- Local Library は明示 opt-in のみ。
- Local -> Private 変更時は queued autosave を停止し、対象 Workspace の persisted document / snapshot を削除する。
- `Workspace.storageMode` を本文永続化 policy の canonical source とする。
- 既存 `AppConfig.privacy` は compatibility view として残す。
- IndexedDB unavailable / open failure / migration failure 時も Workspace 操作は Memory fallback で継続できる。
- Memory fallback では Local Library を有効化できない。
- storage capability API の未対応・拒否・例外で app を停止しない。
- Phase 2A migration / repository / privacy regression test を維持する。

## 4. Non-goals

Phase 2B では以下を実装しない。

- document library sidebar
- document create / rename / delete UI
- folder / tree
- Rule Profile 管理画面
- profile share / clone UI
- suppression UI
- File System Access API UI
- `file-backed` UI
- OPFS への backend 変更
- cloud sync
- backend
- account / authentication
- multi-tab realtime sync
- storage quota warning threshold

## 5. UI 方針

### 5.1 採用: Header Workspace Switcher

現在の 3-area layout を維持し、Header 左側に compact な Workspace switcher を追加する。

例:

```text
Japanese Writing Toolkit   [ Default Workspace ▾ ]
```

menu:

```text
✓ Default Workspace
  Docs
  Support Reply
---------------------
+ New Workspace
Manage Workspace…
```

`Manage Workspace…` から以下を操作する。

- rename
- storage mode
- storage status
- delete

### 5.2 Sidebar を Phase 2B で導入しない理由

常設 Sidebar は将来の document library に適しているが、現時点で導入すると以下まで同時変更になる。

- editor width
- diagnostics layout
- mobile drawer
- keyboard focus order
- responsive breakpoints

Phase 2B は Workspace 管理の domain/application boundary に集中し、document library UI は Phase 2C へ分離する。

## 6. Canonical State

### 6.1 Workspace.storageMode

本文永続化 policy の canonical source は `Workspace.storageMode` とする。

```ts
type StorageMode = 'private-session' | 'local-library' | 'file-backed'
```

Phase 2B UI では以下のみ選択可能。

```text
private-session
local-library
```

### 6.2 AppConfig.privacy

既存 Settings / actions / compatibility code のため `AppConfig.privacy` は残すが、独立した永続 state として扱わない。

active Workspace から以下のように導出する。

```text
private-session
  -> privacyMode=true
  -> autoSave=false

local-library
  -> privacyMode=false
  -> autoSave=true
```

既存 Settings の Privacy controls は Phase 2B で Workspace storage mode action を呼ぶよう変更する。

Workspace Manage UI と Settings が別々に privacy state を保存してはならない。

## 7. Active Workspace Selection

### 7.1 問題

Phase 2A compatibility façade は `workspaces[0]` を active とみなしている。

multi-workspace では repository の list order に navigation state を依存させられない。

### 7.2 WorkspaceSelectionRepository

新しい persistence port を追加する。

```ts
interface WorkspaceSelectionRepository {
  getActiveWorkspaceId(): Promise<string | undefined>
  setActiveWorkspaceId(workspaceId: string): Promise<void>
}
```

IndexedDB adapter は既存 `meta` store に保存する。

```text
meta/active-workspace-id = <workspace id>
```

active selection は user data schema ではなく device-local navigation state とみなし、このためだけに `GlobalPreferences` schema version は上げない。

Memory fallback は同じ port の in-memory implementation を持つ。

### 7.3 Active selection repair

起動時に以下を検証する。

- active ID が存在するか。
- 対象 Workspace が存在するか。

不正な場合:

1. Workspace を `createdAt`, `id` で stable sort。
2. 最初の Workspace を active とする。
3. durable backend なら repaired ID を保存。
4. Workspace が 0 件なら default private Workspace + profile を再生成する。

repair failure は app 起動停止理由にしない。Memory fallback へ移行可能な failure は fallback する。

## 8. Application Layer

UI component から repository / IDBDatabase を直接操作しない。

`WorkspaceService` を導入する。

概念 API:

```ts
interface WorkspaceService {
  list(): Promise<WorkspaceSummary[]>
  getActive(): Promise<WorkspaceContext>
  create(input: CreateWorkspaceInput): Promise<WorkspaceContext>
  rename(workspaceId: string, name: string): Promise<Workspace>
  switchTo(workspaceId: string): Promise<WorkspaceSwitchResult>
  delete(workspaceId: string): Promise<WorkspaceDeleteResult>
  setStorageMode(
    workspaceId: string,
    mode: 'private-session' | 'local-library'
  ): Promise<StorageModeChangeResult>
}
```

Service の責務:

- active Workspace resolve / repair
- ID generation
- create時 profile clone
- current document route
- active selection mutation
- delete successor selection
- storage mode transition
- AppConfig compatibility compose

UI は transaction detail を知らない。

## 9. SessionDocumentStore

### 9.1 目的

`private-session` は「本文を永続化しない」モードであり、「Workspaceを切り替えたら本文を捨てる」モードではない。

同一タブのアプリ実行中は、Workspace ごとの transient document を memory 上で保持する。

新しい application-memory abstraction:

```ts
interface SessionDocumentStore {
  get(workspaceId: string): SessionDocument | undefined
  set(workspaceId: string, document: SessionDocument): void
  delete(workspaceId: string): void
  clear(): void
}
```

これは IndexedDB repository ではない。

page reload / tab close で消えることを仕様とする。

### 9.2 利点

- Private Workspace A -> B -> A の切替で A の本文を保持できる。
- Private Session の privacy guarantee を崩さない。
- 不要な discard confirmation を Workspace switch ごとに出さずに済む。

### 9.3 Dirty tracking

Private Session では同一タブ内 switch が lossless になるため、通常 switch に discard dialog は不要。

ただし以下では確認が必要。

- Workspace delete
- browser reload/navigation で未export本文がある場合の UX

Phase 2B では `beforeunload` による強制 dialog を既定では追加しない。

理由:

- browser制約が強い。
-頻繁な警告は editor UX を悪化させる。
- Private Session の非永続性は UI に常時明示する。

将来必要なら dirty-state と beforeunload を別フェーズで追加する。

## 10. Workspace 作成

### 10.1 Default

新 Workspace:

- immutable unique ID
- user入力 name
- `storageMode = private-session`
- `snapshotPolicy = { enabled: false, maxSnapshots: 20 }`
- active RuleProfile を別 ID へ clone

create 後は新 Workspace を active にする。

### 10.2 RuleProfile clone

既存 profile ID を共有すると、一方の Workspace で rules / NG words を変更した際に別 Workspaceへ即反映される。

Phase 2B には shared profile を説明・管理する UI がないため、create時は profileをcloneする。

clone対象:

- sourcePresetId
- rules
- ngWords
- terminology
- citation
- formatter
- customRules

新しい値:

- id
- name
- createdAt
- updatedAt

### 10.3 Profile ownership

Phase 2B では Workspace delete 時に profile を自動削除しない。

理由:

- RuleProfile に ownerWorkspaceId がない。
- 将来 profile sharing が入る可能性がある。
- profile削除には reference count / ownership policy が必要。

orphan cleanup は Rule Profile 管理フェーズで扱う。

### 10.4 Atomic creation

新 AtomicOperationsPort operation:

```ts
createWorkspaceAndActivate(
  workspace: Workspace,
  profile: RuleProfile
): Promise<void>
```

IndexedDB では同一 transaction 内で:

- profile put
- workspace put
- active-workspace-id put

を行う。

途中 failure で partial record を残さない。

Memory implementation も projected-copy commit で同じ atomic semantics を再現する。

## 11. Workspace Switch

### 11.1 Sequence

1. current active Workspace を取得。
2. current editor document を current Workspace に route。
3. Local Library なら queued autosave を cancel し old Workspace ID を明示して flush。
4. Private Session なら SessionDocumentStore に current document を保存。
5. activeWorkspaceId を targetへ変更。
6. target Workspace + profile を取得。
7. target document をロード。
8. compatibility AppConfig を compose。
9. diagnostics selection / stale tier stateをclear。
10. full relint。

### 11.2 Target document load

`local-library`:

- target Workspace の latest persisted document をロード。
- document がなければ welcome/empty document。

`private-session`:

- SessionDocumentStore に target Workspace の document があれば復元。
- なければ welcome/empty document。

### 11.3 Explicit workspaceId save

既存 `saveRecentDocument()` のように save実行時に active Workspace を再取得する方式は switch race を起こし得る。

Phase 2B では save先を明示する。

```ts
saveWorkspaceDocument(
  workspaceId: string,
  document: StoredDocument
): Promise<void>
```

debounce callback は schedule 時点の `workspaceId` を capture する。

switch 後に old document が new Workspace へ誤保存されないことを test する。

### 11.4 Switch failure

Local Library flush が失敗した場合:

- active selection を変更しない。
- error toast。
- editor state を維持。

active selection 書込後に target load が失敗した場合:

- active Workspace 自体は target とする。
- targetを welcome document + valid default compatibility state で開ける recovery pathを持つ。
- storage corruptionを app crash にしない。

## 12. Workspace Rename

validation:

- trim後に空文字禁止
- 最大 80 Unicode code points
- control character禁止
- 重複名は許可

ID が identity なので表示名重複は repository collision を起こさない。

rename失敗時は optimistic UI を確定しない。

## 13. Workspace Delete

### 13.1 Safety

- Workspace が1件のみなら delete disabled。
- delete dialog に Workspace name を表示。
- Local Library の場合、persisted document / snapshot 削除を明示。
- SessionDocumentStore の対象本文も削除対象。

### 13.2 Active Workspace deletion

active Workspace を削除する場合、削除前に successor を stable order で決定する。

新 atomic operation:

```ts
deleteWorkspaceAndSelectNext(
  workspaceId: string,
  nextWorkspaceId: string
): Promise<void>
```

同一 IndexedDB transaction 内で:

- workspaceDocuments delete
- documentSnapshots delete
- workspace/document scoped suppressions delete
- workspace delete
- active-workspace-id update

RuleProfile は削除しない。

transaction成功後に SessionDocumentStore の対象 entry を削除する。

### 13.3 Non-active deletion

activeでない Workspace削除では active ID を変更しない。

既存 Phase 2A `deleteWorkspaceCascade()` を利用または共通内部実装へ統合する。

## 14. Storage Mode Transition

### 14.1 Private -> Local Library

必ず user gesture + explicit confirmation を必要とする。

説明:

- 本文をこの browser origin の IndexedDB に保存する。
- 本文を server / external API へ送信しない。
- browser data clear で消える可能性がある。
- persistent storageでない場合、storage pressure時にbrowserが削除する可能性がある。

Confirm 後:

1. Workspace.storageMode を `local-library` に変更。
2. SessionDocumentStore の current document を Workspace ID 指定で IndexedDB に保存。
3. compatibility AppConfig を更新。
4. autosave を有効化。
5. successful persist 後、SessionDocumentStore は同じ内容のcacheを保持してもよいが canonical bodyは IndexedDB とする。

mode変更 + first document save は partial stateを避ける。

可能なら AtomicOperationsPort に:

```ts
enableLocalLibrary(
  workspace: Workspace,
  document?: StoredWorkspaceDocument
): Promise<void>
```

を設け、同一 transaction で確定する。

### 14.2 Local Library -> Private

privacy-sensitive destructive persistence operation とする。

UI confirmation label:

```text
保存データを削除して Private Session へ戻す
```

sequence:

1. queued autosave timer cancel。
2. current editor bodyを SessionDocumentStoreへcopy。
3. atomic privacy transition 実行。
4. compatibility AppConfig 更新。

AtomicOperationsPort:

```ts
makeWorkspacePrivate(workspaceId: string): Promise<void>
```

同一 transaction 内で:

- Workspace.storageMode = private-session
- workspaceDocuments delete
- documentSnapshots delete

migration互換 legacy `documents/recent` は、`workspaceId === MIGRATED_WORKSPACE_ID` の場合のみ scrubする。

これにより別 Workspace の privacy切替で legacy migrated body を無関係に消さない。

editor上の本文は memory に残る。

page reload後は復元されない。

### 14.3 Failure semantics

privacy transition が失敗した場合:

- `storageMode=private-session` だけ成功して body が残る状態を禁止。
- body削除だけ成功して mode が Local のままになる状態を禁止。
- IndexedDBでは単一 transaction。
- Memory implementationも all-or-nothing projected commit。

## 15. Storage Capability Service

### 15.1 Interface

```ts
interface StorageCapability {
  durableBackend: boolean
  storageManagerAvailable: boolean
  usage?: number
  quota?: number
  persisted?: boolean
  persistenceRequestSupported: boolean
  error?: string
}
```

browser API adapterを `StorageCapabilityService` として分離する。

### 15.2 使用API

feature-detectして以下を利用する。

- `navigator.storage.estimate()`
- `navigator.storage.persisted()`
- `navigator.storage.persist()`

未対応 / reject / exception は capability resultへ落とし、app operationを止めない。

### 15.3 Origin 単位であること

重要:

`estimate()` が返す usage / quota と、persistent storage の status は path / Workspace / IndexedDB store 単位ではなく origin storage bucket 単位である。

したがって UI では以下のように表示する。

```text
このサイトのオリジン全体の推定使用量
このサイトのオリジン全体の推定上限
```

`japanese_text` 単体の保存サイズと断定しない。

GitHub Pages のように同一 origin 配下へ複数アプリを置く場合、他アプリのorigin storageが usageに含まれ得る。

### 15.4 Estimate の意味

usage / quota は browser の推定値である。

以下をしない。

- 厳密なdisk使用量として表示
- byte単位の正確性を保証
- quotaの全量を使用可能と保証

表示例:

```text
推定使用量: 約 1.2 MB
推定上限: 約 3.4 GB
```

### 15.5 Persistent storage request

`persist()` は自動実行しない。

Local Library使用時の明示 action とする。

```text
[ブラウザに永続保存を要求]
```

結果:

- true -> `Protected`
- false -> `Best effort`
- unsupported/error -> `Unknown / Unsupported`

false は Local Library failure ではない。

persistent status も origin単位であり、このアプリだけに適用される設定ではないことを説明する。

## 16. Workspace Manage UI

Dialog sections:

### General

- Workspace name
- Rename

### Storage

```text
Storage mode        Private Session / Local Library
Backend             IndexedDB / Memory only
Persistence         Protected / Best effort / Unknown
Origin usage        約 1.2 MB
Origin quota        約 3.4 GB
```

Local Library時のみ persistence request button を表示可能。

### Danger Zone

- Delete Workspace

last Workspaceではdisabled +理由表示。

## 17. Memory Fallback

IndexedDB unavailable / open failure / migration failure時:

- Workspace create / switch / rename / delete は同一tab session内で動作。
- active selectionはmemoryのみ。
- SessionDocumentStoreは通常どおり利用。
- Local Library optionはdisabled。
- UIに `Memory only` を表示。
- origin quotaが取得できても「durable app backendが使える」とは扱わない。

`navigator.storage` feature availability と `StorageContext.durable` は別概念。

Phase 2B の Local Library可否は `StorageContext.durable` を正とする。

## 18. State Management

`appState` には browser persistence object を入れない。

追加する UI projection 例:

```ts
activeWorkspaceId(): string
workspaces(): WorkspaceSummary[]
workspaceLoading(): boolean
workspaceMenuOpen(): boolean
workspaceDialogOpen(): boolean
storageCapability(): StorageCapability | null
```

repository / DB handle / service instance は state object の外に置く。

current editor document は引き続き既存 signalsを利用する。

Workspace switch時に SessionDocumentStore / persisted document から既存 document signalsへhydrateする。

## 19. App Bootstrap

新しい bootstrap順序:

1. StorageContext initialize。
2. schema/data migration。
3. active Workspace resolve / repair。
4. active Workspace + profile + preferences load。
5. compatibility AppConfig compose。
6. target Workspace document resolve。
   - local-library -> IndexedDB
   - private-session -> SessionDocumentStore or welcome
7. Workspace UI state hydrate。
8. configLoaded / workspaceReady。
9. initial lint。

`isStorageAvailable()` だけで durable persistence可否を判断しない。

## 20. Existing Settings Integration

Settings の既存 privacy controls は直接:

```ts
appState.updateConfig(...privacy...)
```

しない。

新 Workspace storage actionへ委譲する。

表示上は既存 terminology を維持してもよいが、内部mappingは以下に一本化する。

```text
Privacy Mode ON
  == private-session

Auto Save ON + Privacy Mode OFF
  == local-library
```

矛盾状態:

```text
autoSave=false + privacyMode=false
```

を UI から新規生成しない。

legacy config migration時のみ compatibility mappingで吸収する。

## 21. Autosave / Race Safety

### 21.1 Captured workspace ID

debounce schedule時に:

```ts
const workspaceId = activeWorkspaceId()
```

を capture し、timer callbackはその ID へ保存する。

callback時に active Workspace を再解決してはいけない。

### 21.2 Switch

switch開始時:

- old Workspace の pending timer cancel。
- Localなら explicit flush。
- Privateなら SessionDocumentStoreへstash。

### 21.3 Privacy transition

Local -> Private開始時:

- pending timer cancel。
- atomic privacy scrub完了後に新timer schedule可。

### 21.4 Delete

Workspace delete開始時:

- 対象 Workspace向け pending timer があれば cancel。
- delete transaction完了後に対象 SessionDocumentStore entryを削除。

## 22. Multi-tab Policy

Phase 2B では BroadcastChannel / Web Locks による multi-tab synchronization は導入しない。

ただし operations は IndexedDB transaction-safe にする。

別tabが同時に active Workspaceを削除した場合:

- stale recordを型assertだけで信用しない。
- operation failure後に Workspace listをreload。
- active selection repairを実行。
- app crashを避ける。

multi-tab live syncは将来フェーズ候補。

## 23. Accessibility

- Workspace switcherはkeyboard操作可能。
- menu triggerは `button`。
- menu / dialogに適切な accessible name。
- dialog open時 focus移動。
- Escapeでclose。
- close後 triggerへfocus restore。
- destructive dialogで最初からDelete buttonへfocusしない。
- storage statusは色のみで表現しない。
- button labelは具体的にする。

例:

```text
Local Libraryを有効にする
保存データを削除してPrivate Sessionへ戻す
Workspaceを削除
```

## 24. Error Handling

分類例:

- workspace-read-failed
- workspace-write-failed
- active-selection-repair-failed
- document-flush-failed
- workspace-delete-failed
- privacy-transition-failed
- storage-estimate-failed
- persistence-request-denied

原則:

- destructive operation失敗を success扱いしない。
- privacy scrub失敗は明示 error。
- quota取得失敗は Workspace操作を止めない。
- persist() falseはerrorではなく best-effort state。
- corrupted recordは validation failureとして扱い、app全体のuncaught exceptionにしない。

## 25. Test Strategy

### 25.1 Active selection

- no active ID -> first workspace repair。
- invalid active ID -> repair。
- active ID valid -> rewriteしない。
- zero workspaces -> default private workspace再生成。

### 25.2 Create

- always private-session。
- profile cloneは別ID。
- profile content preserved。
- workspace/profile/active ID atomic。

### 25.3 Switch

- Private A -> B -> A で A本文をsession memoryから復元。
- Private本文をIndexedDBへ書かない。
- Local old workspaceはswitch前にflush。
- save先workspaceId raceを起こさない。
- target local latest doc restore。
- target private session cache restore。

### 25.4 Rename

- trim。
- empty reject。
- length reject。
- control character reject。
- duplicate display name allowed。

### 25.5 Delete

- last workspace reject。
- active deleteでnext active selection atomic。
- documents削除。
- snapshots削除。
- workspace/document suppressions削除。
- profileは残す。
- session cache削除。

### 25.6 Storage transition

- Private -> Local はconfirm前にbody persistしない。
- enable transaction failureでpartial mode changeなし。
- Local -> Privateでtimer cancel。
- current editor bodyはsession cacheへ保持。
- persisted documents/snapshots削除。
- migrated Workspace以外のtransitionでlegacy recentを削除しない。

### 25.7 Storage capability

- estimate success。
- estimate reject。
- persisted true/false/reject。
- persist true/false/reject。
- navigator.storage unavailable。
- origin-wide表示model。
- durable=falseならLocal Library disabled。

### 25.8 Regression

Phase 2A testsを全維持。

CI:

```text
bun ci
bun run lint
bun run test
bun run build
bun run build:pages
Pages asset path verification
Web Worker asset path verification
```

## 26. 実装順序

Phase 2B は taskごとに RED -> GREEN -> review で進める。

1. WorkspaceSelectionRepository + active repair。
2. SessionDocumentStore。
3. WorkspaceService list/create/rename。
4. explicit-workspace document save + switch flow。
5. atomic active Workspace delete。
6. atomic storage mode transitions。
7. StorageCapabilityService。
8. Workspace switcher。
9. Workspace Manage dialog。
10. existing Settings privacy integration。
11. responsive / accessibility review。
12. final code review / regression / CI / merge。

## 27. 代替案

### A. GlobalPreferences.activeWorkspaceId

利点:

- user preferenceとしてmodelが明確。

欠点:

- preferences schema変更が必要。
- Phase 2A record migrationが増える。

Phase 2Bでは採用しない。

### B. workspaces[0]をactive扱い継続

実装は最小だが repository orderへ依存し、rename/delete/create後にactiveが不定になるため不採用。

### C. Private Sessionをswitch時に破棄

実装は簡単だが、Workspace切替がdata-loss操作になる。

SessionDocumentStoreにより同一tab中の本文を保持する案を採用する。

### D. Sidebarを先行導入

将来 document libraryでは有力だが Phase 2B scopeを広げすぎるため不採用。

## 28. 将来フェーズ

### Phase 2C

- document library sidebar
- multi-document create/open/rename/delete
- document search
- snapshots history UI

### Phase 2D

- Rule Profile manager
- profile share / clone / delete
- suppression UI
- declarative custom rules

### Later

- file-backed adapter
- OPFS evaluation
- BroadcastChannel multi-tab sync
- export/import workspace bundle

## 29. 設計判断まとめ

- Header Workspace Switcherを採用。
- SidebarはPhase 2Cへ延期。
- `Workspace.storageMode` がcanonical privacy/storage policy。
- `AppConfig.privacy` はcompatibility view。
- active Workspace IDは`meta` storeへ保存。
- Workspace createはactive profileを別IDへclone。
- Private Session本文はWorkspaceごとのSessionDocumentStoreでtab内保持。
- Private Session本文をIndexedDBへ渡さない。
- document saveはexplicit workspaceIdを必須化。
- Local Libraryは明示opt-in。
- Local -> Privateはmode変更 + body/snapshot scrubをatomic化。
- legacy recent scrubはmigrated Workspaceに限定。
- Local Library可否は`StorageContext.durable`で判断。
- quota/persistenceはorigin単位・推定値として表示。
- persistent storage requestは自動実行しない。
- multi-tab live syncはPhase 2B scope外。
