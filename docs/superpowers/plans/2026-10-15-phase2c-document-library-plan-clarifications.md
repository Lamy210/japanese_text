# Phase 2C-A Implementation Plan Clarifications

この文書は `2026-10-15-phase2c-document-library-implementation.md` の self-review で見つかった曖昧箇所を解消する normative clarification である。実装時は本書とimplementation planを同時に読み、同名interfaceについては本書の定義を優先する。

## 1. WorkspaceService storage-mode API を確定する

以下を唯一の contract とする。

```ts
interface WorkspaceService {
  getActive(): Promise<WorkspaceContext>
  list(): Promise<WorkspaceSummary[]>
  saveConfig(workspaceId: string, config: AppConfig): Promise<WorkspaceContext>
  create(input: { name: string }): Promise<WorkspaceContext>
  rename(workspaceId: string, name: string): Promise<Workspace>
  switchTo(targetWorkspaceId: string): Promise<WorkspaceSwitchResult>
  delete(workspaceId: string): Promise<WorkspaceDeleteResult>

  enableLocalLibrary(
    workspaceId: string,
    documents: StoredWorkspaceDocument[],
    activeDocumentId: string
  ): Promise<WorkspaceContext>

  makePrivate(workspaceId: string): Promise<WorkspaceContext>
}
```

- `WorkspaceSwitchResult` は Workspace context + optional warning のみを持ち、document bodyを持たない。
- `switchTo()` は document body を受け取らない。
- `enableLocalLibrary()` / `makePrivate()` は policy validation + atomic operation 呼び出しだけを担当する。
- `makePrivate()` の下位では既存 `AtomicOperationsPort.makeWorkspacePrivate(workspaceId)` を呼ぶ。service名とatomic名を混同しない。
- session library へのflush/snapshot/commitは controller / DocumentService orchestration が担当する。
- Phase 2B の `setStorageMode(workspaceId, mode, currentDocument)` は削除する。overloadを残さない。

## 2. Review Focus #5 の担当Task

Private data leak compatibility regressionは **Task 12** が担当する。

必須test対象:

- bootstrap
- Open import
- config import / generic config save
- legacy storage façade
- Private Session document create/switch

上記経路から Private document body / list / active document selection が IndexedDBへ保存されないことを検証する。

## 3. Local list failure recovery は ephemeral

Local Libraryで `DocumentRepository.listByWorkspace()` が失敗した場合、editorに表示するempty recovery documentは persisted documentとして扱わない。

```ts
interface RecoveryDocumentState {
  kind: 'ephemeral-recovery'
  workspaceId: string
  name: 'recovery.md'
  content: ''
  docType: 'markdown'
}
```

実装上、`activeDocumentId` は `undefined` のままにする。

そのため:

- EditorPaneはdocument autosaveをscheduleしない。
- Exportは現在editor内容をexport可能。
- Sidebarはretry actionを表示する。
- create/importをユーザーが明示実行した場合のみ、新しい正常documentとして保存できる。
- list retry成功時は通常の`resolveActive()`へ戻る。

recovery documentを暗黙にIndexedDBへ書き込んではならない。

## 4. Local selection repair write failure fallback

`resolveActive()` が有効本文を読めたが `active-document-id:<workspaceId>` のrepair writeに失敗した場合、DocumentService instance内の transient map にselectionを保持する。

```ts
const transientLocalSelections = new Map<string, string>()
```

precedence:

1. valid durable selection
2. valid transient selection
3. deterministic repair candidate

transient selectionはtab/session限定で、IndexedDBへ別経路で書かない。

通常のユーザー起点 document switchで durable selection writeが失敗した場合は targetへ切り替えず、current document/editorを維持する。repair recoveryと通常navigationを混同しない。

## 5. Atomic API利用範囲

- `createDocumentAndActivate()` / `deleteDocumentAndSelectNext()` / `replaceLastDocument()` は Local Library専用。
- Private Session CRUDは `SessionDocumentLibraryStore` の projected memory updateだけを使い、AtomicOperationsPortへdocument bodyを渡さない。
- `enableLocalLibrary()` だけが Private memory documents 全件を durable側へ持ち込む入口になる。

## 6. Task 9 の呼び出し先

Private -> Local:

1. cancel pending autosave
2. current editor -> session library flush
3. session snapshot取得
4. `WorkspaceService.enableLocalLibrary(workspaceId, documents, activeDocumentId)`
5. success後のみ session workspace copy削除

Local -> Private:

1. cancel pending autosave
2. current active Local document explicit flush
3. `DocumentService.snapshotWorkspace(workspace)` で temporary snapshot取得
4. `WorkspaceService.makePrivate(workspaceId)`
5. success後のみ `SessionDocumentLibraryStore.replaceWorkspace()`

途中failureではcanonical sourceを切り替えない。
