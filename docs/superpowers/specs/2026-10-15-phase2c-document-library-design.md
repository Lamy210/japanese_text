# Phase 2C-A Document Library / Sidebar / Multi-document 詳細設計

## 1. 目的

Phase 2B で確立した Workspace / Privacy 境界の上に、1 Workspace 内で複数の文書を安全に作成・切替・改名・削除できる Document Library を追加する。

本フェーズでは document identity と active document selection を明示的に分離し、`updatedAt` の最大値を active document とみなす暗黙仕様を廃止する。

同時に、左 Sidebar を追加し、ユーザーが Workspace ごとの文書一覧を確認・切替できる UI を提供する。

Privacy-first 方針は維持する。

- `private-session`: 本文・文書一覧・active document selection を IndexedDB に保存しない。
- `local-library`: 文書本文と active document selection を IndexedDB に保存する。
- 外部 API / backend / account / LLM は追加しない。

Phase 2C は大きいため、以下に分割する。

- **Phase 2C-A:** Multi-document foundation + Sidebar + document CRUD + Open/Export integration
- **Phase 2C-B:** Snapshot / History + restore + full-text document search

本設計は Phase 2C-A のみを対象とする。

## 2. 現状と問題

Phase 2B main 時点では、以下の構造になっている。

- `StoredWorkspaceDocument` domain model は既に存在する。
- `workspaceDocuments` IndexedDB store も既に存在する。
- `DocumentRepository` は `listByWorkspace/get/save/delete` を持つ。
- app state は `documentText/documentName/docType/revision` の単一 editor projection を持つ。
- `WorkspaceService` / `WorkspaceController` が Workspace 切替時に current document を route する。
- Local Library の active document は事実上 `updatedAt` が最大の document で決まる。
- Private Session は `SessionDocumentStore` に Workspace ごとに1文書だけ保持する。

このまま Sidebar だけ追加すると、以下の問題が起きる。

1. autosave により `updatedAt` が変わるだけで active document 判定が変わり得る。
2. Workspace 内で複数文書を保持する Private Session を表現できない。
3. Workspace switch と document switch の責務が `WorkspaceService` に集中する。
4. Local -> Private / Private -> Local が current document 1件しか扱えず、複数文書の一部を失い得る。
5. active document delete 後の successor selection を atomic に保証できない。

Phase 2C-A はこれらを解消する。

## 3. 成功条件

- 1 Workspace 内に複数 document を作成できる。
- Sidebar から document を切り替えられる。
- document create / rename / delete ができる。
- `Open` した `.md/.txt` を現在の Workspace へ新規 document として取り込める。
- `Export` は active document のみを出力する。
- active document は `updatedAt` から推測しない。
- Local Library では active document ID を durable storage に保存する。
- Private Session では active document ID を含む library state を memory のみに保持する。
- Private Session A -> B -> A の document switch で本文を失わない。
- Workspace A -> B -> A でも各 Workspace の active document を復元できる。
- document switch 前に queued autosave を cancel / flush する。
- autosave callback は Workspace ID と Document ID を schedule 時点で capture する。
- document A の delayed save が document B を上書きしない。
- active document delete 時に deterministic successor を選ぶ。
- 最後の document を削除した場合は空の `untitled.md` を自動生成する。
- Local Library で document delete と snapshot cascade と active selection update を atomic に行う。
- Private -> Local で全 session document を atomic に永続化する。
- Local -> Private で全 document を memory に退避した後、persisted body / snapshot / active document metadata を atomic に削除する。
- Workspace delete 時に active document metadata も削除する。
- Phase 2A / 2B の privacy・migration・workspace regression を維持する。

## 4. Non-goals

Phase 2C-A では以下を実装しない。

- folders / tree hierarchy
- tags
- pin / favorite
- drag-and-drop reorder
- document tabs
- full-text search across document bodies
- snapshot/history UI
- snapshot restore
- conflict-free multi-tab realtime sync
- BroadcastChannel / Web Locks
- file-backed storage
- File System Access API handle persistence
- cloud sync
- account / authentication
- Rule Profile manager
- suppression UI
- bulk export / ZIP export
- trash / soft delete
- collaborative editing

## 5. 採用アーキテクチャ

```text
┌──────────────────────────────────────────────────────┐
│ UI                                                   │
│ Header / DocumentSidebar / Editor / Diagnostics      │
└───────────────────────┬──────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────┐
│ State Controllers                                    │
│ WorkspaceController / DocumentController             │
└───────────────┬───────────────────────┬──────────────┘
                │                       │
┌───────────────▼────────────┐  ┌──────▼───────────────┐
│ WorkspaceService           │  │ DocumentService       │
│ workspace/profile/policy   │  │ CRUD/selection/body   │
└───────────────┬────────────┘  └──────┬───────────────┘
                │                      │
┌───────────────▼──────────────────────▼───────────────┐
│ Shared Application Runtime                           │
│ StorageContext + SessionDocumentLibraryStore         │
└───────────────────────┬──────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────┐
│ Persistence Ports                                    │
│ DocumentRepository / DocumentSelectionRepository     │
│ AtomicOperationsPort                                 │
└───────────────────────┬──────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────┐
│ IndexedDB / Memory                                   │
└──────────────────────────────────────────────────────┘
```

UI は repository / IndexedDB を直接触らない。

## 6. 責務分離

### 6.1 WorkspaceService

Phase 2C-A 以降の `WorkspaceService` は以下へ責務を寄せる。

- Workspace create / list / rename / delete
- Workspace selection
- RuleProfile clone / recovery
- storage mode policy
- Workspace context / AppConfig composition

Phase 2B で持っていた以下の document routing 責務は `DocumentService` へ移す。

- Workspace 切替時の body save
- active document load
- newest document 推測
- Session document body routing

`WorkspaceService.switchTo()` は target Workspace selection と context 切替に集中する。

### 6.2 DocumentService

`DocumentService` は Workspace 内の document library を管理する application service とする。

概念 API:

```ts
interface DocumentService {
  list(workspace: Workspace): Promise<DocumentSummary[]>
  resolveActive(workspace: Workspace): Promise<DocumentContext>

  create(
    workspace: Workspace,
    input?: { name?: string; docType?: DocumentType; content?: string }
  ): Promise<DocumentContext>

  importDocument(
    workspace: Workspace,
    input: { name: string; docType: DocumentType; content: string }
  ): Promise<DocumentContext>

  rename(
    workspace: Workspace,
    documentId: string,
    name: string
  ): Promise<DocumentContext>

  switchTo(
    workspace: Workspace,
    targetDocumentId: string,
    currentDocument: EditableDocument
  ): Promise<DocumentContext>

  save(
    workspace: Workspace,
    document: EditableDocument
  ): Promise<void>

  delete(
    workspace: Workspace,
    documentId: string
  ): Promise<DocumentDeleteResult>
}
```

DocumentService は UI state を直接変更しない。

### 6.3 Controllers

`WorkspaceController` は Workspace 境界の orchestration を行う。

`DocumentController` を新設し、以下を担当する。

- appState と DocumentService の bridge
- active document CRUD
- document switch
- autosave cancel / explicit flush
- diagnostics reset / relint
- Sidebar loading/mutation state
- Open file import

Workspace switch / storage mode transition のように Workspace と document の両方へまたがる操作は controller 層で明示的に orchestration する。

## 7. Document Domain

既存 `StoredWorkspaceDocument` を継続利用する。

```ts
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

新たに UI/application projection を定義する。

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

interface DocumentSummary {
  id: string
  workspaceId: string
  name: string
  docType: DocumentType
  sourceKind: 'local' | 'file'
  createdAt: number
  updatedAt: number
  active: boolean
}
```

`content` が欠損・不正な persisted record は active load 時に recovery warning と empty content へ落とし、app crash にしない。

## 8. Document Identity

### 8.1 ID

Document identity は immutable ID とする。

既存 persisted document ID は変更しない。

新規 document は collision-resistant local ID を生成する。

例:

```text
document-<timestamp>-<random>
```

ID generation は test injection 可能にする。

### 8.2 Name

Document name は identity ではない。

- trim 後に空文字禁止
- 最大 120 Unicode code points
- control character 禁止
- `/` と `\\` を禁止
- 重複名を許可

重複名を禁止すると import や将来 folder 導入時の制約が強すぎるため、ID を identity とする。

rename は `docType` を自動変更しない。

`docType` は content interpretation であり、表示名 extension と独立させる。

## 9. Document Ordering

Sidebar の既定順は stable order とする。

```text
createdAt ASC
id ASC
```

`updatedAt` 順にはしない。

理由:

- 編集するたび row が移動すると UX が不安定になる。
- active document repair の deterministic successor と同じ順序を使える。

Phase 2C-B 以降で sort option を追加してもよい。

## 10. Active Document Selection

### 10.1 原則

active document は `updatedAt` から推測しない。

Workspace ごとに active document ID を明示管理する。

### 10.2 Local Library

新 port:

```ts
interface DocumentSelectionRepository {
  getActiveDocumentId(workspaceId: string): Promise<string | undefined>
  setActiveDocumentId(workspaceId: string, documentId: string): Promise<void>
  deleteActiveDocumentId(workspaceId: string): Promise<void>
}
```

IndexedDB `meta` store を再利用する。

key:

```text
active-document-id:<workspaceId>
```

`meta` store は既に存在するため、この selection 追加だけでは DB version を上げない。

### 10.3 Private Session

Private Session の document selection は IndexedDB に保存しない。

`SessionDocumentLibraryStore` が Workspace ごとの active document ID を memory のみに保持する。

page reload / tab close で document library 全体と selection は消える。

## 11. SessionDocumentLibraryStore

Phase 2B の `SessionDocumentStore` を multi-document 対応へ置き換える。

概念 interface:

```ts
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

  replaceWorkspace(
    workspaceId: string,
    snapshot: SessionDocumentLibrarySnapshot
  ): void

  deleteWorkspace(workspaceId: string): void
  clear(): void
}
```

内部更新は copy-on-write で all-or-nothing にする。

controller/service ごとに別 instance を作らない。

application runtime の singleton instance を Workspace / Document の両 controller が共有する。

## 12. Shared Application Runtime

Phase 2B の `workspace-runtime.ts` を拡張し、document session state の split-brain を防ぐ。

概念:

```ts
interface ApplicationRuntime {
  getStorageContext(): Promise<StorageContext>
  getSessionDocumentLibrary(): SessionDocumentLibraryStore
  getWorkspaceService(): Promise<WorkspaceService>
  getDocumentService(): Promise<DocumentService>
}
```

同一 tab 内で以下は必ず同じ runtime を使う。

- App bootstrap
- Header Workspace switcher
- Document Sidebar
- Settings
- Workspace Manage
- autosave
- Open import

## 13. Active Document Resolve / Repair

### 13.1 Local Library

`resolveActive(workspace)` の sequence:

1. `workspaceDocuments` を Workspace ID で取得。
2. persisted active document ID を取得。
3. active ID が list 内に存在すれば使用。
4. active ID が欠損・不正なら repair。

repair rule:

- document が1件以上ある場合:
  - Phase 2B の既存挙動を保つため、最初の repair 時のみ `updatedAt DESC, id ASC` の先頭を active にする。
  - repaired active ID を meta に保存する。
- document が0件の場合:
  - `welcome.md` を `WELCOME_DOCUMENT` 内容で1件生成する。
  - active ID を同一 operation で保存する。

以後の通常 Sidebar ordering は `createdAt ASC, id ASC` とする。

### 13.2 Private Session

- session library に active ID があり document が存在すれば使用。
- active ID が不正なら stable order の先頭へ repair。
- document が0件なら memory 上へ `welcome.md` + `WELCOME_DOCUMENT` を生成する。
- IndexedDB には何も書かない。

### 13.3 Recovery

Local repair write に失敗した場合:

- app crash にしない。
- document body が読めていれば editor へ recovery load する。
- selection persistence failure を warning toast で通知する。
- selection は current session memory で保持して操作を継続する。

## 14. Document Create

新規 document default:

```text
name: untitled.md
docType: markdown
content: ""
sourceKind: local
```

create 後は新 document を active にする。

### Local Library

`document put + active document selection` を atomic にする。

### Private Session

`SessionDocumentLibraryStore` の projected state を一括置換する。

重複名は許可する。

## 15. Open / Import

Header の既存 `Open` は Phase 2C-A から「current editor を置換」ではなく、「現在の Workspace に新しい document を追加して active にする」動作へ変更する。

対象:

- `.md`
- `.markdown`
- `.mdown`
- `.mkd`
- `.txt`

file name と extension から `docType` を判定する既存ロジックを再利用する。

Import sequence:

1. pending autosave cancel。
2. current active document flush。
3. file content read。
4. new document ID 生成。
5. document create/import + select。
6. editor projection 更新。
7. diagnostics reset。
8. full relint。

File System Access handle は保持しない。

## 16. Document Switch

Document A -> B sequence:

1. pending autosave timer を cancel。
2. current editor body を current Workspace + current Document ID へ明示 flush。
3. target ID が同じ Workspace に属することを検証。
4. target active selection を更新。
5. target document body を load。
6. appState active document projection を更新。
7. selected diagnostic / tier results を clear。
8. full relint。

Local Library の current save が失敗した場合:

- target selection を変更しない。
- editor を current document のまま維持する。
- error toast。

selection write 後に target load が壊れていた場合:

- target selection 自体は維持する。
- target body を empty recovery document として開く。
- warning toast。

## 17. Explicit Autosave Destination

Phase 2B の Workspace ID capture を Document ID まで拡張する。

API:

```ts
persistDocumentDebounced(
  workspaceId: string,
  documentId: string
): void
```

schedule 時に必ず両 ID を capture する。

callback 内で active Workspace / active Document を再解決してはならない。

save payload の name / content / docType は timer 発火時の editor state を読むのではなく、schedule 時点または revision-bound snapshot を利用する。

理由:

- A edit -> switch B -> delayed callback の stale overwrite を防ぐ。
- active document name変更 race を防ぐ。

Document switch / Workspace switch / delete / storage mode transition / Open import の前には pending timer を cancel する。

## 18. Document Rename

rename validation は §8.2 を適用する。

Local Library:

- repository record を update。
- active selection は変更しない。

Private Session:

- memory record を update。

rename 失敗時に optimistic UI を確定しない。

active document rename 後は appState.documentName も同一 transaction boundary の成功後だけ更新する。

## 19. Document Delete

### 19.1 共通

Delete は confirmation を必要とする。

表示:

```text
「<document name>」を削除しますか？
```

Local Library では persisted body と既存 snapshot が削除されることを明記する。

### 19.2 複数 document がある場合

active document を削除する場合は stable order で successor を選ぶ。

優先:

1. delete target の次
2. なければ直前

Local Library では以下を atomic にする。

- target document delete
- target document snapshots delete
- active document selection update

概念 operation:

```ts
deleteDocumentAndSelectNext(
  workspaceId: string,
  documentId: string,
  nextDocumentId: string
): Promise<void>
```

### 19.3 最後の document

最後の1 document を削除する操作自体は許可するが、Workspace を document 0件の通常状態にはしない。

replacement:

```text
name: untitled.md
docType: markdown
content: ""
sourceKind: local
```

Local Library では同一 transaction で:

- old document delete
- old snapshots delete
- replacement put
- active selection = replacement ID

を確定する。

概念 operation:

```ts
replaceLastDocument(
  workspaceId: string,
  oldDocumentId: string,
  replacement: StoredWorkspaceDocument
): Promise<void>
```

Private Session では projected memory update で同じ semantics を再現する。

### 19.4 非active document delete

service API は対応可能にするが、Phase 2C-A UI の Delete action は active document を対象とする。

将来 row-level menu を追加できる。

## 20. Storage Mode Transition — Multi-document 対応

Phase 2B の single-document transition を Phase 2C-A で置き換える。

### 20.1 Private -> Local Library

sequence:

1. pending autosave cancel。
2. current active editor body を session library へ flush。
3. Workspace の session documents 全件を取得。
4. active document ID を取得。
5. document 全件 + active ID + storageMode変更を1 transaction で永続化。
6. success 後、session Workspace copy を削除する。
7. Local Library を canonical source とする。

AtomicOperationsPort:

```ts
enableLocalLibrary(
  workspaceId: string,
  documents: StoredWorkspaceDocument[],
  activeDocumentId: string
): Promise<void>
```

同一 transaction:

- Workspace.storageMode = local-library
- documents put all
- active-document-id:<workspaceId> put

1件だけ persist する Phase 2B API は廃止する。

### 20.2 Local -> Private

sequence:

1. pending autosave cancel。
2. current active editor body を explicit save する。
3. Local documents 全件 + active ID を temporary snapshot として memory に読み込む。
4. atomic privacy transition を実行。
5. success 後に temporary snapshot を `SessionDocumentLibraryStore` へ commit。
6. Private Session を canonical source とする。

Atomic operation:

```ts
makeWorkspacePrivate(workspaceId: string): Promise<void>
```

同一 transaction:

- Workspace.storageMode = private-session
- workspace documents delete all
- document snapshots delete all
- `active-document-id:<workspaceId>` delete
- migrated compatibility rule に該当する場合のみ legacy recent scrub

atomic operation が失敗した場合、temporary memory snapshot は canonical 化しない。

Local persisted state をそのまま維持する。

## 21. Workspace Switch — Multi-document 対応

Workspace A -> B sequence:

1. document autosave timer cancel。
2. current active document explicit flush。
3. current Workspace config/profile persist。
4. Workspace selection を B へ変更。
5. target Workspace context load / recovery。
6. `DocumentService.resolveActive(B)`。
7. active document projection 更新。
8. Workspace summaries / document summaries 更新。
9. diagnostics reset。
10. full relint。

`WorkspaceService` 自身は current document body を受け取らない。

## 22. Workspace Delete 拡張

Workspace delete atomic operation は以下も削除する。

```text
meta/active-document-id:<workspaceId>
```

既存 cascade:

- workspace documents
- document snapshots
- workspace/document suppressions
- workspace

に active document metadata cleanup を追加する。

Private Session では Workspace commit 成功後に session document library entry を削除する。

## 23. App State

既存 editor projection は維持する。

追加 state:

```ts
documentSummaries(): DocumentSummary[]
activeDocumentId(): string | undefined
documentLibraryReady(): boolean
documentMutationPending(): boolean
documentSidebarOpen(): boolean
documentFilter(): string
```

`documentText/documentName/docType/revision` は active document の editor projection とする。

repository object / service object / IDBDatabase を appState に置かない。

active document apply helper で以下を一括更新する。

- activeDocumentId
- documentText
- documentName
- docType
- revision increment
- diagnostics reset

## 24. Sidebar UI

### 24.1 Desktop

幅は 240px 前後とする。

```text
┌ Documents ────────────┐
│ [検索...]             │
│ [+ New] [Rename]      │
│                       │
│ ● welcome.md          │
│   notes.md            │
│   support-reply.md    │
│                       │
│ [Delete]              │
└───────────────────────┘
```

Phase 2C-A では row-level context menu を作らない。

操作は top/bottom actions に集約する。

理由:

- custom popup menu の focus / keyboard handling を避ける。
- accessibility complexity を抑える。
- active document 操作という mental model を明確にする。

### 24.2 Breakpoints

既存 Diagnostics layout と競合しないよう以下とする。

- `>= 1280px`
  - Document Sidebar: 常設可能
  - Editor
  - Diagnostics: 常設
- `1024px - 1279px`
  - Document Sidebar: default collapsed / left overlay
  - Diagnostics: 既存どおり右常設
- `< 1024px`
  - Document Sidebar: left drawer
  - Diagnostics: right drawer / mobile bottom sheet
  - auxiliary panel は同時に1つだけ open
- `< 768px`
  - Document Sidebar: left drawer `min(320px, 90vw)`
  - Diagnostics: bottom sheet

Header に Documents toggle を追加する。

### 24.3 Search/filter

Phase 2C-A の検索は document name の client-side filter のみ。

- case-insensitive
- locale-aware な高度正規化は不要
- body full-text search は Phase 2C-B

filter は persistence しない。

## 25. Accessibility

Sidebar:

- `nav aria-label="Documents"`
- document 一覧は semantic list
- row は native `<button>`
- active row は `aria-current="page"` または同等の明示 state
- focus-visible を維持
- color だけで active state を表現しない

Create / Rename / Delete dialog:

- focus trap / Escape close / restore focus
- destructive Delete を initial focus にしない
- Workspace name と Document name を混同しない label

Drawer:

- open 時に first useful control へ focus
- close 後 toggle button へ focus restore
- background interaction を抑止

## 26. Open / Export UI Integration

### Open

既存 Header input を維持し、action の backend を `DocumentController.importFile()` へ切り替える。

Open 成功後:

- Sidebar listへ追加
- new document active
- editor load
- diagnostics reset/re-lint

### Export

active document の:

- name
- content
- docType

のみを export する。

bulk export は非対象。

active document が recovery state でも export を許可する。

## 27. Error Handling

### Document list load failure

- Workspace 自体は開く。
- empty recovery document を editor へ表示。
- Sidebar に retry action を出す。
- app 全体を crash させない。

### Current save failure before switch

- document selection を変更しない。
- editor を維持。
- error toast。

### Create failure

- active selection を変更しない。
- temporary UI row を残さない。

### Rename failure

- optimistic name を確定しない。

### Delete failure

- document / selection / snapshots の partial delete を禁止。
- current editor state を維持。

### Active selection corruption

- deterministic repair。
- repair persistence failure は warning。

## 28. Migration / Backward Compatibility

DB schema version は Phase 2C-A では `2` のまま維持する。

理由:

- `meta` store は既に存在する。
- `workspaceDocuments` store は既に存在する。
- 新 Object Store / index を追加しない。

既存 Phase 2B data:

- persisted document records は変更しない。
- `active-document-id:*` が存在しないため初回 load で repair。
- repair は Phase 2B の `newestDocument(updatedAt)` behavior を初回 active choice として尊重する。

Private Session は reloadで本文が消える仕様のため migration 不要。

既存 `local-recent-document:<workspaceId>` ID はそのまま1 documentとして libraryへ表示する。

## 29. Atomic Operations 拡張

Phase 2C-A で AtomicOperationsPort に以下を追加・変更する。

```ts
createDocumentAndActivate(
  document: StoredWorkspaceDocument
): Promise<void>

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

makeWorkspacePrivate(
  workspaceId: string
): Promise<void>
```

`createDocumentAndActivate` は document から workspaceId を取得し、document put + meta active selection put を同一 transaction で行う。

`deleteWorkspaceCascade` / `deleteWorkspaceAndSelectNext` は active document meta key も削除する。

Memory implementation は projected-copy commit で同じ all-or-nothing semantics を再現する。

## 30. Performance

想定 document 数は Phase 2C-A では Workspace あたり数十〜数百件程度とする。

初期実装では `listByWorkspace()` 全件取得で十分。

以下は導入しない。

- virtualization
- pagination
- full-text index
- dedicated search engine

ただし Sidebar filter では content を読み直さず summary list の name のみを使う。

body を Sidebar render ごとに clone しない。

DocumentSummary projection では content を除外する。

## 31. Privacy / Security

- Private Session document content は IndexedDB へ渡さない。
- Private Session active document ID も IndexedDB へ保存しない。
- Local Library opt-in policy は Workspace.storageMode のまま canonical。
- Document create/import が Local Library opt-in を暗黙に有効化しない。
- Config import で storage mode を変更できない既存 invariant を維持する。
- imported file content を外部へ送らない。
- HTML preview / arbitrary script execution は追加しない。
- document name は text として renderし、HTML injection を許可しない。

## 32. Test Strategy

全 product change は TDD で実施する。

### Repository / Selection

- Local selection get/set/delete
- Workspaceごとの selection isolation
- invalid document ID repair
- selection persistence failure handling

### Session library

- Workspace A/B isolation
- multiple document CRUD
- active selection
- projected atomic replace
- delete Workspace cleanup

### DocumentService

- create selects new doc
- import selects new doc
- duplicate name allowed
- rename validation
- Private switch A -> B -> A lossless
- Local switch saves old before loading new
- current save failure prevents switch
- delete active selects deterministic successor
- delete last creates empty replacement
- non-active delete does not change selection
- recovery from missing active ID

### Autosave race

- schedule captures Workspace ID + Document ID
- A timer never writes B
- Workspace switch cancels timer
- Document switch cancels timer
- delete cancels target timer
- storage transition cancels timer
- Open import cancels timer

### Privacy transition

- Private -> Local persists all documents + active ID atomically
- failure leaves Workspace private and no partial persisted docs
- Local -> Private copies all docs to temporary memory first
- failure leaves Local canonical and persisted docs untouched
- success deletes docs/snapshots/active-doc meta
- unrelated Workspace documents untouched

### Workspace integration

- Workspace A active doc A2 -> B active doc B1 -> A restores A2
- Workspace delete clears active-doc meta
- Workspace delete clears Private session library after durable delete success

### UI

- Sidebar list renders summaries
- active row explicit
- filter by name
- create/rename/delete actions
- drawer toggle semantics
- panel mutual exclusion below 1024px
- keyboard focus restore

### Regression

既存 Phase 2A / 2B tests を全維持する。

## 33. CI Gate

最低限:

```bash
bun ci
bun run lint
bun run test
bun run build
bun run build:pages
grep -q '/japanese_text/assets/' dist/index.html
grep -R -q '/japanese_text/assets/analysis.worker-' dist/assets
```

PR merge前に exact head CI GREEN を確認する。

main merge後に CI と GitHub Pages deploy を再確認する。

## 34. Implementation Sequence

Phase 2C-A implementation plan は以下の順序を基本とする。

1. Document selection port + adapters
2. SessionDocumentLibraryStore
3. Atomic document operations
4. DocumentService
5. WorkspaceService document responsibility extraction
6. shared application runtime
7. DocumentController + appState
8. explicit Workspace+Document autosave
9. Workspace switch integration
10. multi-document storage mode transition
11. Open/Export integration
12. Sidebar UI / responsive behavior
13. adversarial regression review
14. exact-head CI gate / merge

詳細 task 分割は implementation plan で確定する。

## 35. Phase 2C-B へ Deferred

Phase 2C-B では以下を扱う。

- `SnapshotRepository`
- manual snapshot
- before-format snapshot
- before-import snapshot
- snapshot retention / pruning
- History UI
- restore before snapshot
- body full-text search
- snapshot restore atomicity
- snapshot storage usage visualization

Phase 2C-A では snapshot を新規作成しないが、document / Workspace delete 時には既存 snapshot を正しく cascade delete する。

## 36. 最終設計判断

Phase 2C-A では以下を canonical とする。

1. **Document identity は immutable ID。nameではない。**
2. **Active document selection は明示state。updatedAtから推測しない。**
3. **Local selection は meta store、Private selection は memory only。**
4. **WorkspaceService と DocumentService を分離する。**
5. **Single-document SessionDocumentStore は multi-document SessionDocumentLibraryStore へ置き換える。**
6. **autosave destination は Workspace ID + Document ID の両方をcaptureする。**
7. **storage mode transition は library全件を対象にする。**
8. **SidebarはPhase 2C-A、Snapshot/HistoryはPhase 2C-Bへ分離する。**
9. **DB versionは2のまま。新store/indexは追加しない。**
10. **既存Phase 2B privacy invariantを弱めない。**
