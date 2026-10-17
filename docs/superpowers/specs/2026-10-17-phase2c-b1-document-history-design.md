# Phase 2C-B1 Document History / Snapshot / Restore Design

## 1. 目的

Phase 2C-A で導入した multi-document Document Library に、本文のローカル履歴を追加する。

本フェーズの目的は、ユーザーが文章を編集・Formatした後でも、過去の本文へ安全に戻れることにある。既存の privacy-first / local-first 方針を維持し、Backend、LLM、Account、Cloud Sync は追加しない。

成功条件は以下。

- Local Library では Snapshot / History を IndexedDB に保存できる。
- Private Session でも同じ History 操作を利用できるが、本文履歴は memory-only とし、リロード・タブ終了で消える。
- Restore 前には現在本文を退避し、Restore 自体に失敗した場合は current document / editor を変更しない。
- Format 実行前の状態へ戻せる。
- 通常編集の履歴は無制限に増えず、重複排除と retention 上限を持つ。
- document 削除、Workspace 削除、Local → Private 遷移時に Local snapshot body が残存しない。
- Phase 2C-A の document identity / active selection / autosave race protection を壊さない。

## 2. スコープ

### 2.1 Phase 2C-B1 に含める

- `DocumentSnapshot` repository / memory store
- SnapshotService / HistoryController
- manual snapshot
- coalesced autosave snapshot
- before-format snapshot
- before-restore snapshot
- history list / preview / restore UI
- Workspace 単位の snapshot policy UI
- retention pruning
- duplicate content suppression
- Local restore の atomicity
- Private Session の memory-only history
- document / Workspace / storage transition と snapshot lifecycle の回帰テスト

### 2.2 Phase 2C-B1 に含めない

- Workspace 内本文全文検索（Phase 2C-B2）
- diff viewer / line-by-line compare
- folders / tags / tabs
- cloud backup / cloud sync
- multi-tab realtime synchronization
- BroadcastChannel / Web Locks
- File System Access / file-backed persistence
- snapshot export/import
- cross-document restore
- branching history / CRDT / operation log
- compression / delta encoding

## 3. 設計原則

### 3.1 Privacy-first

- 本文と snapshot body を外部 API へ送信しない。
- `private-session` の snapshot は IndexedDB / localStorage / sessionStorage に保存しない。
- `local-library` の snapshot のみ IndexedDB `documentSnapshots` store に保存する。
- Workspace の `snapshotPolicy` は本文ではないため、既存どおり local metadata として永続化してよい。

### 3.2 Full snapshot を採用する

本フェーズでは delta / patch chain を採用しない。

理由:

- restore が snapshot 1件だけで完結する。
- chain corruption の影響を受けない。
- pruning が単純。
- 現状の文章サイズと default retention 20件では複雑な差分圧縮を導入する根拠が弱い。

将来容量が課題になった場合は storage adapter 内部の圧縮を検討する。domain model を delta 前提にはしない。

### 3.3 Editor Undo と History の責務を分ける

- CodeMirror Undo: 秒〜分単位の直近編集を戻す。
- Document History: Format、manual checkpoint、長時間編集などを跨いで過去本文へ戻す。

autosave snapshot を編集イベントごとには作成しない。

## 4. 既存基盤

Phase 2C-A 時点で以下が存在する。

```ts
interface SnapshotPolicy {
  enabled: boolean
  maxSnapshots: number
}

interface DocumentSnapshot {
  id: string
  documentId: string
  revision: number
  content: string
  reason: 'autosave' | 'manual' | 'before-format' | 'before-import'
  createdAt: number
}
```

IndexedDB v2 には既に `documentSnapshots` store と以下 index がある。

```text
documentId
[documentId, createdAt]
```

Workspace default は以下を維持する。

```ts
snapshotPolicy: {
  enabled: false,
  maxSnapshots: 20
}
```

`maxSnapshots` validation は既存どおり整数 `1..1000` を維持する。

## 5. Domain Model

### 5.1 SnapshotReason

Restore 前退避を明示するため `before-restore` を追加する。

```ts
type SnapshotReason =
  | 'autosave'
  | 'manual'
  | 'before-format'
  | 'before-import'
  | 'before-restore'
```

`before-import` は既存 schema compatibility のため残す。ただし Phase 2C-A の Open は current document overwrite ではなく新規 document import なので、Phase 2C-B1 では自動生成しない。

### 5.2 DocumentSnapshot

```ts
interface DocumentSnapshot {
  id: string
  documentId: string
  revision: number
  content: string
  reason: SnapshotReason
  createdAt: number
}
```

Snapshot は本文だけを復元対象とする。

以下は復元しない。

- document name
- docType
- sourceKind
- createdAt
- Workspace / Rule Profile

理由は、snapshot が別 document を生成するのではなく「同一 document の本文履歴」だからである。

### 5.3 SnapshotSummary

History list は本文全量を UI state へ複製しない。

```ts
interface SnapshotSummary {
  id: string
  documentId: string
  revision: number
  reason: SnapshotReason
  createdAt: number
  preview: string
}
```

`preview` は snapshot content から先頭 160 Unicode code points を normalize して生成する derived value とし、永続化しない。

## 6. Retention / Revision / Duplicate Policy

### 6.1 retention 単位

`Workspace.snapshotPolicy.maxSnapshots` は **1 document あたり** の上限とする。

例:

- Workspace maxSnapshots = 20
- document A: 最大20件
- document B: 最大20件

Workspace 全体20件ではない。

### 6.2 pruning

新しい snapshot の保存に成功した後、同一 document の snapshot が上限を超えた場合に古いものから削除する。

Local Library では snapshot insert + retention prune を **同一 IndexedDB readwrite transaction** で行う。

Private Session では memory store の単一 mutation として同じ結果を得る。

transaction が失敗した場合、新規 snapshot と prune のどちらも確定しない。

### 6.3 revision

Revision は document ごとに 1 から始まる単調増加整数とする。

```text
1, 2, 3, ...
```

snapshot を prune しても過去 revision を再利用しない。

Phase 2C-B1 は multi-tab sync を対象外とするため、SnapshotService は document ごとの capture operation を直列化する。Local adapter は transaction 内で既存最大 revision を再確認し、`max + 1` を採用する。

### 6.4 duplicate suppression

直前 snapshot と `content` が完全一致する場合、新しい snapshot を作成しない。

例外は設けない。Manual Snapshot でも内容が同一なら duplicate を作らず、「現在の本文は最新履歴と同一です」と UI へ返せる result を返す。

比較は完全一致とし、trim / newline normalization は snapshot 層では行わない。Editor / import 側の既存 normalization を尊重する。

## 7. Capture Policy

### 7.1 snapshotPolicy.enabled

`enabled = false` の場合、新しい snapshot を作成しない。

既存 snapshot は削除しない。History list / preview / restore は引き続き利用可能とする。

これにより policy OFF が既存履歴の破壊操作にならない。

### 7.2 Manual Snapshot

History UI の `Save snapshot` から active document の現在本文を保存する。

- policy OFF の場合は button を disabled にし、設定導線を表示する。
- capture 前に active document identity を固定する。
- current editor body を snapshot payload として使用する。
- Local/Private とも同じ service contract を使う。

### 7.3 Autosave Snapshot

通常編集の snapshot は次を満たす場合のみ作成する。

- policy enabled
- document content が直前 snapshot と異なる
- 同一 document の最後の autosave snapshot から **5分以上**経過している

`manual` / `before-format` / `before-restore` が直近に存在しても、autosave throttle の基準は最後の `autosave` createdAt とする。

autosave snapshot は既存 product autosave (`persistDocumentDebounced`) の成功後に best-effort で capture する。

snapshot capture failure は document autosave 成功を rollback しない。warning を表示して本文保存を優先する。

Private Session では DocumentService の memory save 後に同等の throttle を適用する。

### 7.4 Before Format

Format が実際に本文を変更する直前に `before-format` snapshot を作成する。

順序:

1. lint / shadow lint
2. format plan を確定
3. appliedCount > 0 を確認
4. snapshot policy enabled なら current body を `before-format` capture
5. snapshot capture 成功後に editor へ fix transaction を適用

snapshot capture に失敗した場合、Format は中止する。

理由は `before-format` が safety checkpoint であり、Formatだけ進めると「戻せる」というUI契約を破るため。

policy OFF の場合は従来どおり Format を実行する。

### 7.5 Before Import

Phase 2C-A の import は新規 document を作るため、current document を上書きしない。

したがって Phase 2C-B1 では `before-import` を自動生成しない。

## 8. Restore Semantics

### 8.1 基本動作

ユーザーが snapshot を選択して `Restore` を実行すると、選択 snapshot の `content` を同一 document の現在本文へ復元する。

restore 前に current body を `before-restore` snapshot として保存する。

### 8.2 policy OFF 時の restore

既存 snapshot がある場合、policy OFF でも restore は許可する。

この場合も restore の安全性を優先し、`before-restore` snapshot は作成する。

つまり `enabled=false` は通常 capture の停止を意味するが、user initiated restore に伴う rollback checkpoint だけは例外とする。

### 8.3 Local Library atomic restore

Local restore は以下を同一 IndexedDB readwrite transaction で実施する。

1. target snapshot が対象 document に属することを確認
2. current persisted document を取得
3. editor/current body を `before-restore` snapshot として insert
4. retention prune
5. target snapshot content で `workspaceDocuments` record を更新
6. transaction commit

いずれかが失敗した場合は transaction 全体を abort する。

commit 成功後にのみ editor state を target content へ切り替える。

### 8.4 Private Session atomic restore

memory store 側で以下を1 mutationとして扱う。

- before-restore snapshot append
- retention prune
- session document content update

mutation 完了後に controller が editor state を更新する。

### 8.5 stale target / cross-document protection

Restore request は `{ workspaceId, documentId, snapshotId }` を固定して実行する。

以下は reject する。

- snapshot が存在しない
- snapshot.documentId !== requested documentId
- document が requested workspace に存在しない
- current active document が request 作成時と異なる
- Workspace が切り替わっている

UI は restore pending 中に document / Workspace navigation を disable する。

### 8.6 restore後

- document `updatedAt` は restore commit 時刻へ更新する。
- active document ID は変更しない。
- document name/docType/sourceKind は変更しない。
- diagnostics を reset し full lint を再実行する。
- pending product autosave timer を cancel してから restore を開始する。

## 9. Storage Ports

### 9.1 SnapshotRepository

```ts
interface SnapshotRepository {
  listByDocument(documentId: string): Promise<DocumentSnapshot[]>
  get(id: string): Promise<DocumentSnapshot | undefined>
}
```

通常の snapshot write は retention / revision と一体で扱うため、public `save()` / `delete()` は repository port に置かない。

### 9.2 AtomicOperationsPort additions

```ts
interface SnapshotCaptureInput {
  id: string
  documentId: string
  content: string
  reason: SnapshotReason
  createdAt: number
  maxSnapshots: number
}

interface SnapshotCaptureResult {
  snapshot?: DocumentSnapshot
  skippedDuplicate: boolean
}

interface RestoreDocumentInput {
  workspaceId: string
  documentId: string
  snapshotId: string
  currentContent: string
  restoredUpdatedAt: number
  beforeRestoreSnapshotId: string
  beforeRestoreCreatedAt: number
  maxSnapshots: number
}

interface AtomicOperationsPort {
  captureSnapshot(input: SnapshotCaptureInput): Promise<SnapshotCaptureResult>
  restoreDocumentFromSnapshot(input: RestoreDocumentInput): Promise<{
    document: StoredWorkspaceDocument
    checkpoint: DocumentSnapshot
  }>
}
```

Memory adapter も IndexedDB adapter と同じ failure / collision / retention semantics を持つ。

## 10. Private Session Snapshot Store

`SessionDocumentLibraryStore` と責務を分けるため、snapshot 専用 store を追加する。

```ts
interface SessionSnapshotStore {
  list(documentId: string): DocumentSnapshot[]
  get(snapshotId: string): DocumentSnapshot | undefined
  capture(input: SnapshotCaptureInput): SnapshotCaptureResult
  restore(input: RestoreDocumentInput, document: EditableDocument): {
    document: EditableDocument
    checkpoint: DocumentSnapshot
  }
  deleteDocument(documentId: string): void
  clear(): void
}
```

Workspace deletion時は Workspace 内 document IDs を取得して対象 snapshot を削除する。

Local → Private 遷移では Local snapshot を Private へコピーしない。

理由:

- Local history をmemoryへ持ち出すことは必須ではない。
- storage mode transition の本文 leak surface を増やさない。
- Private移行後は新しい memory-only history として開始する。

Private → Local 遷移でも Private snapshot を Local へコピーしない。

History の storage mode 間 migration は本フェーズのscope外とする。

## 11. SnapshotService

```ts
interface SnapshotService {
  list(workspace: Workspace, documentId: string): Promise<SnapshotSummary[]>
  get(workspace: Workspace, documentId: string, snapshotId: string): Promise<DocumentSnapshot>
  capture(
    workspace: Workspace,
    document: EditableDocument,
    reason: 'manual' | 'before-format'
  ): Promise<SnapshotCaptureResult>
  captureAutosave(workspace: Workspace, document: EditableDocument): Promise<SnapshotCaptureResult>
  restore(
    workspace: Workspace,
    document: EditableDocument,
    snapshotId: string
  ): Promise<EditableDocument>
}
```

Service は storage mode を見て Local adapter / SessionSnapshotStore を切り替える。

UI は repository / IndexedDB を直接操作しない。

### 11.1 operation serialization

同一 document の capture / restore は SnapshotService 内の document-keyed promise queue で直列化する。

異なる document は独立実行できる。

## 12. Controller / State

`HistoryController` を追加する。

```ts
interface HistoryController {
  open(): Promise<void>
  close(): void
  refresh(): Promise<void>
  createManualSnapshot(): Promise<void>
  preview(snapshotId: string): Promise<void>
  restore(snapshotId: string): Promise<void>
}
```

State は最低限以下を持つ。

```ts
historyOpen: boolean
historyLoading: boolean
historyMutationPending: boolean
historyEntries: SnapshotSummary[]
selectedHistorySnapshot?: DocumentSnapshot
```

Document / Workspace switch 成功時は history selection を reset する。

History panel が開いている場合は新しい active document の list を refresh する。

## 13. UI

### 13.1 entry point

Document Sidebar に active document 用 `History` button を追加する。

### 13.2 History panel

History は document library 自体とは分離した panel / drawer とする。

表示:

- active document name
- History enabled / disabled state
- `Save snapshot`
- snapshot list (`createdAt`, reason, revision, preview)
- selected snapshot preview
- `Restore`

reason label:

```text
autosave       -> Autosave
manual         -> Manual
before-format  -> Before format
before-import  -> Before import
before-restore -> Before restore
```

### 13.3 accessibility

- panel は accessible name `Document history`
- keyboard だけで snapshot list / preview / restore を操作可能
- Restore confirmation は destructiveではないが本文置換を伴うため confirmation dialog を出す
- dialog initial focus は Cancel
- Escape close
- focus trap
- close 後は Restore trigger へ focus restore
- panel close 後は History trigger へ focus restore

### 13.4 Workspace snapshot policy UI

Workspace Manage に以下を追加する。

- `Enable document history` toggle
- `Maximum snapshots per document` number input
  - min 1
  - max 1000
  - default 20

policy update は Workspace metadata update として保存する。

maxSnapshots を小さくしても即時全document pruneは行わない。

次回 snapshot capture / restore checkpoint 作成時に対象 document の retention を適用する。

理由は policy変更だけで大量削除 transaction を発生させないため。

## 14. Format Integration

`formatDocumentAction()` は SnapshotService を直接 import して cyclic dependency を増やさず、runtime accessor 経由で active SnapshotService / controller operation を取得する。

Format前のcaptureは editor fix transactionより前に完了させる。

失敗時:

- formatter changeは適用しない
- current editor bodyはそのまま
- error/warning toastで理由を表示

## 15. Autosave Integration

既存 product autosave の invariant を維持する。

- schedule時に workspaceId/documentId/payload を capture
- callbackでcurrent selectionを再解決しない
- document / Workspace switch前にtimer cancel

Local Library:

1. captured document をsave
2. save成功後に、その同じ captured identity/body を SnapshotService autosave capture へ渡す
3. history failureは本文saveをrollbackしない

Private Session:

DocumentController / DocumentService save path の成功後、同じ identity/body に対して autosave captureを呼ぶ。

Snapshot autosaveは現在のeditorを再読しない。

## 16. Delete / Workspace / Storage Transition

### 16.1 document delete

Local document delete transaction は対象 document の `documentSnapshots` を全削除する既存 semantics を維持する。

Private document delete は `SessionSnapshotStore.deleteDocument(documentId)` も実行する。

last document replacement でも old document snapshots を削除する。

### 16.2 Workspace delete

Local: Workspace cascade transaction で snapshot を削除。

Private: session document library削除に加えて対象 document snapshots を削除。

### 16.3 Local → Private

Local durable snapshots は Local document body と同時に全削除する既存 privacy scrub invariant を維持する。

Local snapshotsをPrivate memoryへコピーしない。

### 16.4 Private → Local

Private snapshotsをIndexedDBへコピーしない。

Local mode移行後は新しいLocal historyとして開始する。

## 17. Error Handling

### History list failure

- editor / document editing は継続可能
- History panel にエラー表示
- retry可能

### Manual/autosave capture failure

- Manual: error toast
- Autosave: warning toastまたはsilent deduplicated warning。document body saveは成功扱い

### Before-format capture failure

- Format中止
- current body不変

### Restore failure

- editor current body不変
- active document不変
- selected snapshot previewは維持
- error toast

### Corrupt snapshot

Read時 validation を通す。

invalid record は restore対象にしない。list時は不正recordを無視するのではなくwarning付きで除外し、History UIに「一部履歴を読み込めませんでした」と通知する。

## 18. Tests

TDDで以下を固定する。

### Domain / repository

- SnapshotReason validation including `before-restore`
- per-document revision monotonicity
- duplicate suppression
- retention 20 / custom limit
- retention does not affect another document
- Memory / IndexedDB parity
- snapshot ID collision rejection

### Private Session

- snapshot body never reaches durable repositories
- reload相当のmemory store再生成でhistory消失
- document A/B histories remain isolated
- Private document delete clears only target history
- Private Workspace delete clears target histories

### Local Library

- list order newest first for UI
- capture + prune atomicity
- document delete cascades snapshots
- last document replacement cascades old snapshots
- Local → Private removes snapshots
- Private → Local does not persist previous Private snapshots

### Autosave

- <5min does not create second autosave snapshot
- >=5min creates snapshot if content differs
- identical content is skipped
- stale autosave callback never snapshots another document/workspace
- body save succeeds even when history autosave capture fails

### Format

- format change creates before-format snapshot before editor mutation
- snapshot failure prevents formatter mutation
- no-op format creates no snapshot
- policy OFF preserves current behavior

### Restore

- restore creates before-restore checkpoint
- Local restore body + checkpoint are atomic
- Local restore failure leaves persisted + editor body unchanged
- Private restore failure leaves session body unchanged
- cross-document snapshot restore rejected
- stale active document/workspace restore rejected
- restore cancels pending autosave
- restore relints only after success

### UI / accessibility

- policy OFF disables manual capture
- existing history remains viewable/restorable while policy OFF
- Restore dialog initial focus Cancel
- Escape / focus trap / focus restore
- history panel focus restore
- document switch resets selected snapshot

## 19. Non-functional Requirements

- 新規 runtime dependency は原則追加しない。
- IndexedDB version は 2 のまま。既存 `documentSnapshots` storeを利用する。
- history listはdocument単位queryを使い、全Workspace snapshot scanをしない。
- snapshot previewのためだけに全document bodyを走査しない。
- default retention 20件ではUI操作を同期的に重くしない。
- snapshot bodyはanalysis workerへ送らない。選択previewはUIのみ。

## 20. Rollout / Compatibility

- 既存ユーザーは `snapshotPolicy.enabled=false` のため、merge直後にsnapshot bodyが自動保存されることはない。
- 既存 `DocumentSnapshot` recordが存在しても、新しい reason unionとvalidationに合う既存reasonはそのまま読める。
- DB schema upgradeは不要。
- Phase 2C-A document data / active selection metadataは変更しない。

## 21. Phase 2C-B2 への境界

本文全文検索は次の独立PRとする。

Phase 2C-B2 では以下を扱う予定。

- Workspace内 document body search
- Private Session memory search
- Local Library body search
- query normalization / result snippets
- search cancellation / debounce
- document navigation integration

Phase 2C-B1 の SnapshotRepository / History UI は検索indexとして再利用しない。Current document body search と history search は別問題として扱う。

## 22. 最終決定

Phase 2C-B1 は以下で確定する。

- Full snapshot
- Private Session = memory-only history
- Local Library = IndexedDB history
- default OFF / 20 snapshots per document
- autosave history = 5分coalescing + duplicate suppression
- before-format safety checkpoint
- before-restore rollback checkpoint
- Local restore = checkpoint + document updateをatomic transaction
- storage mode間でsnapshot historyは移送しない
- body full-text searchはPhase 2C-B2へ分離
