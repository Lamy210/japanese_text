# Phase 2B Workspace / Privacy 詳細設計

## 1. 目的

Phase 2A で導入した local-first storage foundation を利用し、ユーザーが複数 Workspace を安全に作成・切替・改名・削除できる UI / application layer を追加する。

同時に、本文永続化を明示 opt-in の `Local Library` として扱い、既定の `Private Session` を維持する。ブラウザ storage の利用可否・推定 quota・persistent storage 状態を可視化する。

本フェーズでは既存の Linter / Formatter / AppConfig UI を壊さず、後続の multi-document library UI に必要な active workspace 境界を確立する。

## 2. 成功条件

- 新規 Workspace は必ず `private-session` で作成される。
- Header から active Workspace を確認・切替できる。
- Workspace の create / switch / rename / delete が可能。
- 最後の 1 Workspace は削除できない。
- active Workspace 削除時も activeWorkspaceId が不整合にならない。
- Private Session の未保存本文を Workspace switch で黙って破棄しない。
- Local Library への変更は明示 opt-in でのみ行う。
- Private Session へ戻した場合、queued autosave を停止し、その Workspace の保存本文と snapshots を削除する。
- `Workspace.storageMode` を storage policy の canonical source とし、既存 `AppConfig.privacy` は compatibility view とする。
- IndexedDB が使えない場合も in-memory Workspace 操作は可能。ただし durable / quota UI は正しく degraded 表示する。
- `navigator.storage.estimate()` / `persisted()` / `persist()` の未対応・例外で app を壊さない。
- Phase 2A migration / repository contract / privacy invariants を回帰させない。

## 3. Non-goals

Phase 2B では以下を実装しない。

- document library/sidebar
- document create / rename / delete UI
- folder/tree
- Rule Profile 管理画面
- profile共有・複製UI
- suppression UI
- File System Access API / `file-backed` UI
- cloud sync / backend / account
- OPFS への storage backend 変更
- persistent storage を必須条件にすること

## 4. 採用する UI 方針

### 採用: Header Workspace Switcher

Header 左側の App title 周辺に compact な Workspace switcher を配置する。

表示例:

```text
Japanese Writing Toolkit   [ Default Workspace ▾ ]
```

Popover / menu 内:

```text
✓ Default Workspace
  Docs
  Support Reply
---------------------
+ New Workspace
Manage Workspace…
```

`Manage Workspace…` から rename / storage mode / storage status / delete を行う。

### 採用理由

- 現在の 3-area layout を崩さない。
- Phase 2B の Workspace 管理だけを追加できる。
- document library sidebar は後続 Phase 2C として独立できる。
- mobile でも Header menu / dialog へ縮退しやすい。

### 不採用: 常設左 Sidebar

将来の document library には有力だが、Phase 2B で導入すると layout / responsive / editor width / accessibility の変更範囲が大きすぎる。

## 5. Canonical State

### 5.1 Workspace.storageMode

本文永続化 policy の canonical source は `Workspace.storageMode` とする。

```ts
type StorageMode = 'private-session' | 'local-library' | 'file-backed'
```

Phase 2B の UI では `private-session` / `local-library` のみ選択可能。

### 5.2 AppConfig.privacy

既存 UI / worker / code path の互換性のため残すが、永続化上の独立 source of truth にはしない。

active Workspace から以下を導出する。

```text
private-session
  -> privacyMode=true, autoSave=false

local-library
  -> privacyMode=false, autoSave=true
```

既存 Settings の Privacy controls は直接 `AppConfig` を mutation せず、Workspace storage mode action を呼ぶよう移行する。

これにより Workspace menu と Settings の二重 source of truth を防ぐ。

## 6. Active Workspace Selection

### 6.1 Active Workspace ID

Phase 2A の `getActiveState()` は `workspaces[0]` を active とみなしているため、multi-workspace では利用できない。

Phase 2B で explicit active workspace selection を導入する。

新 port:

```ts
interface WorkspaceSelectionRepository {
  getActiveWorkspaceId(): Promise<string | undefined>
  setActiveWorkspaceId(workspaceId: string): Promise<void>
}
```

IndexedDB adapter は既存 `meta` store に以下を保存する。

```text
meta/active-workspace-id = <workspace id>
```

active selection は domain record そのものではなく device-local navigation state なので、`GlobalPreferences` schema version をこの目的だけで上げない。

### 6.2 Bootstrap fallback

active ID が存在しない・壊れている・対象 Workspace がない場合:

1. Workspace を `createdAt`, `id` で安定 sort。
2. 最初の Workspace を active とする。
3. durable storage が利用可能なら active ID を repair 保存。
4. Workspace が 0 件なら default private Workspace + default profile を再作成する。

## 7. Application Layer

UI から repository を直接操作しない。

新規 `WorkspaceService` を設ける。

概念 API:

```ts
interface WorkspaceService {
  list(): Promise<WorkspaceSummary[]>
  getActive(): Promise<WorkspaceContext>
  create(input: CreateWorkspaceInput): Promise<WorkspaceContext>
  rename(workspaceId: string, name: string): Promise<Workspace>
  switchTo(workspaceId: string, decision?: SwitchDecision): Promise<WorkspaceSwitchResult>
  delete(workspaceId: string): Promise<WorkspaceDeleteResult>
  setStorageMode(workspaceId: string, mode: 'private-session' | 'local-library'): Promise<void>
}
```

Service が以下を所有する。

- active Workspace validation / repair
- create時の ID generation
- default profile作成
- switch前の document policy
- delete時の successor選択
- storage mode transition
- app compatibility config projection

UI component は repository transaction detail を知らない。

## 8. Workspace 作成

### 8.1 Default

新 Workspace:

- unique immutable Workspace ID
- name: user input
- storageMode: `private-session`
- snapshotPolicy: `{ enabled: false, maxSnapshots: 20 }`
- Rule Profile: active profile の内容を clone した新 profile

### 8.2 Profile clone の理由

既存 profile ID をそのまま共有すると、片方の Workspace で rules / NG words を編集した変更が別 Workspace にも即反映される。

Phase 2B の UI には「shared profile」であることを説明・管理する機能がないため、create時は独立 profileへ cloneする。

Phase 2B では Workspace delete 時に profile を自動削除しない。

理由:

- RuleProfile に ownerWorkspaceId がない。
- 将来 profile sharing が入る可能性がある。
- orphan profile cleanup は profile管理フェーズで参照数を確認して行う。

### 8.3 Atomicity

Workspace / cloned profile / activeWorkspaceId を create-and-activate する場合は単一 AtomicOperationsPort operation とする。

```ts
createWorkspaceAndActivate(workspace, profile): Promise<void>
```

途中 failure で profileだけ / workspaceだけが残らないこと。

## 9. Workspace Switch

Workspace switch は単なる select value 更新にしない。

### 9.1 Switch sequence

1. 現 active Workspace と editor state を取得。
2. switch-loss guard を評価。
3. 必要なら old Workspace の Local Library save を flush。
4. activeWorkspaceId を変更。
5. target Workspace + profile をロード。
6. target Workspace が `local-library` なら最新 document をロード。
7. target Workspace が `private-session` なら transient welcome/empty document をロード。
8. AppConfig compatibility view を target profile / preferences / storage mode から再構成。
9. diagnostics selection を clear。
10. full relint。

### 9.2 Private Session loss guard

Private Session の本文は永続化されないため、dirty document を保持したまま switch すると data loss になる。

`appState` に以下を導入する。

```ts
sessionDocumentBaselineRevision: number
isDocumentDirty(): boolean
```

Workspace load / file open / successful local save 時点で baseline を更新する。

Private Session で dirty な本文がある場合、switch を一旦止め、確認 dialog を表示する。

選択肢:

- `Cancel` — switchしない。
- `Export` — 現文書を書き出してから再度switch可能。
- `Discard and switch` — 明示破棄してswitch。

silent discard は禁止。

### 9.3 Local Library switch

Local Library では Workspace switch 前に queued debounce save を cancel し、現在本文を old Workspace ID を明示指定して flush する。

重要:

既存 `saveRecentDocument()` のように「保存実行時に active Workspace を再取得する」方式は switch race を起こし得る。

Phase 2B では document save API に明示 `workspaceId` を渡す。

```ts
saveCurrentDocument(workspaceId, document): Promise<void>
```

これにより switch 後に old document が new Workspaceへ保存される race を防ぐ。

## 10. Workspace Rename

- 前後 whitespace trim。
- 空文字禁止。
- 最大 80 Unicode code points。
- 重複名は許可する。ID が identity のため。
- rename は active workspace / documents / profile ID を変更しない。
- rename失敗時は UI state を optimistic確定しない。

## 11. Workspace Delete

### 11.1 Safety rules

- Workspace が1件のみなら Delete action disabled。
- 削除 dialog に Workspace name と保存 document 件数を表示。
- Local Library の場合、「保存本文とsnapshotsが削除される」ことを明示。
- active Workspace 削除時は successor Workspace を先に決定。

### 11.2 Atomic operation

新 AtomicOperationsPort operation:

```ts
deleteWorkspaceAndSelectNext(
  workspaceId: string,
  nextWorkspaceId: string
): Promise<void>
```

同一 IndexedDB transaction 内で:

- workspaceDocuments削除
- documentSnapshots削除
- workspace/document scoped suppressions削除
- Workspace削除
- active-workspace-id更新

RuleProfile は自動削除しない。

activeでない Workspace 削除時も、active ID は保持したまま cascade deletion する。

## 12. Storage Mode Transition

### 12.1 Private Session -> Local Library

必ず user gesture による明示 opt-in。

確認 dialog:

- 本文がこのブラウザの local storage / IndexedDB に保存される。
- server / external API へ本文を送らない。
- browser data clear で消える可能性がある。
- persistent storage が未付与なら storage pressure で削除される可能性がある。

Confirm 後:

1. Workspace.storageMode を `local-library` に変更。
2. current document をその Workspace に保存。
3. AppConfig compatibility view を更新。
4. autosave を有効化。

### 12.2 Local Library -> Private Session

privacy-sensitive operation とする。

1. queued autosave timer cancel。
2. Workspace.storageMode を private に変更。
3. 当該 Workspace の documents + snapshots を削除。
4. AppConfig compatibility view更新。
5. current editor本文は memory 上に残す。

「Privateへ戻す」操作で editor 本文そのものを画面から消さない。

ただし page reload / Workspace switch 後には復元されない。

### 12.3 Transaction ordering

Local -> Private は policy変更と persisted body削除を可能な限り同一 AtomicOperationsPort operation にする。

```ts
makeWorkspacePrivate(workspaceId): Promise<void>
```

transaction内で:

- workspace.storageMode = private-session
- documents delete
- snapshots delete

legacy `documents/recent` は migration互換期間中、active migrated Workspaceに紐づく場合のみ privacy scrub 対象とする。

## 13. Storage Capability / Quota

新 `StorageCapabilityService` を browser adapter として用意する。

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

### 13.1 APIs

利用可能なら:

- `navigator.storage.estimate()`
- `navigator.storage.persisted()`
- `navigator.storage.persist()`

を使用する。

`usage` / `quota` は browser が返す推定値であり、正確な disk size として表示しない。

UI文言は「推定使用量」「推定上限」とする。

### 13.2 Persistence request

`persist()` は Local Library利用時の任意actionとして提供する。

自動で呼ばない。

理由:

- browserごとに grant criteria が異なる。
- user gesture と意図を明確にする。
- grant失敗を Local Library利用不可の意味にしない。

状態:

```text
Persistent: Yes
Persistent: No
Persistent: Unsupported / Unknown
```

### 13.3 UI

Workspace Manage dialog の Storage section:

```text
Storage mode        Private Session / Local Library
Browser storage     Available / Memory fallback
Persistence         Protected / Best effort / Unknown
Estimated usage     1.2 MB
Estimated quota     3.4 GB
[Request persistent storage]
```

quota percent が算出可能でも alarm threshold は Phase 2B では導入しない。

## 14. Memory Fallback

IndexedDB unavailable/open/migration failure時:

- Workspace create / switch / rename は session内で動作。
- `Local Library` option は disabled。
- UI に `Memory only` と表示。
- quota / persistence は `Unavailable`。
- local-library persisted dataがあるように見せない。

既存 `isStorageAvailable()` の単純 feature detection と `StorageContext.durable` を区別する。

Phase 2B UI の durable判定は `StorageContext.durable` を正とする。

## 15. State Management

`appState` に Workspace domain object 全体を詰め込まず、UIに必要な projection のみ追加する。

例:

```ts
activeWorkspaceId(): string
workspaces(): WorkspaceSummary[]
workspaceLoading(): boolean
workspaceDialogOpen(): boolean
pendingWorkspaceSwitch(): PendingSwitch | null
storageCapability(): StorageCapability | null
```

repository object / IDBDatabase は state に入れない。

## 16. Concurrency / Race Safety

### 16.1 Autosave

- document timer callback は captured `workspaceId` を使用。
- Workspace switch / Private transition では既存 timer を cancel。
- switch完了後に old Workspace向け保存が new Workspaceへ誤配送されない。

### 16.2 Multi-tab

Phase 2B では realtime multi-tab sync は実装しない。

ただし persisted active-workspace-id / workspace mutation は transaction-safe とする。

別tabが同時に Workspace を削除していた場合:

- read validation failureを app crash にしない。
- list refresh + active repair を行う。

BroadcastChannelによる同期は後続フェーズ候補とする。

## 17. Accessibility

- Workspace switcher は native `button` + menu semantics または accessible `select` を基礎にする。
- keyboardのみで switch / create / manageへ到達可能。
- destructive delete dialog は focus trap / Escape / focus restore。
- storage status は色だけで表現しない。
- confirmation action label は具体化する。
  - `Local Libraryを有効にする`
  - `保存データを削除してPrivate Sessionへ戻す`
  - `Workspaceを削除`

## 18. Error Handling

Error category:

- workspace-read-failed
- workspace-write-failed
- active-selection-repair-failed
- document-flush-failed
- privacy-scrub-failed
- storage-estimate-failed
- persistence-request-denied

原則:

- destructive operation failureを success toast にしない。
- privacy scrub failure は error として通知する。
- quota取得失敗は Workspace操作を止めない。
- persistence request=false は errorではなく best-effort継続。

## 19. Existing UI Compatibility

### Header

追加:

- Workspace switcher
- Manage Workspace entry

既存:

- Open / Export / Lint / Format / Preset / Theme / Settings / Diagnostics

を維持する。

Headerが過密になるため desktopでは App subtitle を縮小可能、mobileでは Workspace switcherを compact label化する。

### Settings

General / Privacy controls は Workspace storage action を利用する。

Rule / NG word / terminology / citation UI は active RuleProfileを compatibility `AppConfig` 経由で操作し続ける。

### App bootstrap

新順序:

1. StorageContext initialize + migration。
2. active Workspace resolve/repair。
3. active Workspace profile + preferences load。
4. compatibility AppConfig compose。
5. active workspace document restore policy実行。
6. UI ready。
7. initial lint。

## 20. Tests

### Domain / Service

- createは常に private-session。
- create時 profile clone は別ID。
- rename validation。
- last Workspace delete拒否。
- active deleteは successorを選択。
- corrupt active ID repair。

### Switch

- private clean -> switch。
- private dirty -> switch blocked。
- explicit discard -> switch。
- local-library -> old workspaceへflush後switch。
- captured workspace ID により autosave raceを防ぐ。
- target local-libraryのrecent doc復元。

### Privacy

- private -> local は confirm前にpersistしない。
- local -> private で queued timer cancel。
- local -> private で documents + snapshots削除。
- privacy scrub failure時に mode/recordのpartial commitを残さない。

### Atomic IndexedDB

- create workspace + profile + active ID atomicity。
- delete active workspace + cascade + next active ID atomicity。
- make private + body/snapshot deletion atomicity。
- transaction lifetimeを跨ぐ await 後 write がない。

### Storage capability

- APIs全部利用可能。
- `navigator.storage` 未対応。
- estimate reject。
- persisted reject。
- persist=false。
- memory fallback時 Local Library disabled。

### Regression

Phase 2A existing testsを全維持。

CI gate:

```text
bun ci
bun run lint
bun run test
bun run build
bun run build:pages
Pages asset/worker path verification
```

## 21. 実装分割

Phase 2B は一括巨大commitにしない。

推奨順序:

1. Active Workspace selection port / repair。
2. WorkspaceService create/list/rename。
3. switch + dirty guard + explicit workspace document save。
4. atomic delete + successor selection。
5. canonical storage mode transition。
6. StorageCapabilityService。
7. Workspace switcher / management dialog。
8. existing Settings privacy integration。
9. browser behavior / responsive / accessibility review。
10. final regression + code review。

各taskは RED test -> implementation -> GREEN -> review の順で進める。

## 22. 将来フェーズへの境界

Phase 2C候補:

- document library sidebar
- multi-document create/open/rename/delete
- snapshots history UI
- document search

Phase 2D候補:

- Rule Profile manager
- profile sharing / clone / import / export
- Suppression UI
- declarative custom rules

Phase 2B ではこれらの UI を先取りしない。

## 23. 主要設計判断まとめ

- UIは Header Workspace Switcher を採用。
- Sidebarは後続 document libraryまで延期。
- `Workspace.storageMode` が privacy persistence policy の canonical source。
- `AppConfig.privacy` は compatibility view。
- active Workspace ID は既存 `meta` storeへ保存し、GlobalPreferences schema bumpを避ける。
- Workspace createは active profileを別IDへclone。
- Private Session dirty document は switch時に silent discardしない。
- document saveは explicit workspaceId を受け、switch raceを防ぐ。
- Local Libraryは明示 opt-in。
- Local -> Private は policy変更 + documents/snapshots削除をatomic化。
- browser quotaは推定値として表示。
- persistent storage requestは自動実行しない。
- Memory fallbackでは Local Libraryを提供しない。
