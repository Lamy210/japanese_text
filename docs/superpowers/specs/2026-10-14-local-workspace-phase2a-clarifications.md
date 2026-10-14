# Phase 2A Storage Foundation Clarifications

この文書は `2026-10-14-local-workspace-rule-platform-design.md` の Phase 2A 実装境界を補足する。上位設計のアーキテクチャ判断は変更しない。

## 1. Legacy stores と Privacy deletion

v1→v2 **migration 自体**は `settings` / `documents` の legacy records を削除・更新しない。migration の rollback/retry source を維持するためである。

ただし migration 完了後、ユーザーが明示的に Privacy Mode を有効化して「保存済み本文を削除する」操作を行った場合は別である。この explicit privacy action は user intent を優先し、v2 `workspaceDocuments` の対象本文だけでなく、対応する legacy `documents/recent` record も削除してよい。

- legacy **store 自体**は Phase 2A で削除しない。
- migration 処理は legacy record を破壊しない。
- explicit privacy deletion は legacy body を保持し続けない。
- rollback/recovery は user が明示的に削除した本文を復活させてはならない。

## 2. AtomicOperationsPort の段階導入

Canonical design は最終形として `migrateV1ToV2`, `deleteWorkspaceCascade`, `importWorkspaceBundle` を atomic operation として扱う。

Phase 2A では import schema / `ValidatedWorkspaceBundle` がまだ存在しないため、YAGNI と interface segregation を優先し、実装する port は以下に限定する。

```ts
interface AtomicOperationsPort {
  migrateV1ToV2(): Promise<MigrationResult>
  deleteWorkspaceCascade(workspaceId: string): Promise<void>
}
```

`importWorkspaceBundle()` は Phase 2G で validated import contract と同時に追加する。multi-store import を repository の逐次呼び出しで実装してよい、という意味ではない。

## 3. Declarative customRules の Phase 2A 扱い

`RuleProfile.customRules` フィールドは将来 contract のため model 上に保持するが、Phase 2A は custom rule engine の実装範囲ではない。

- 新規/migrated profile は `customRules: []`。
- Phase 2A validator は non-empty `customRules` を受理しない。
- unknown custom rule を実行・dynamic import しない。
- Phase 2F で DeclarativeRule schema と execution isolation を追加した時点で validator を拡張する。

## 4. Fresh-install privacy default

Persistent storage の有無に関係なく、新規 session の canonical default は `private-session` とする。

したがって既存 `AppConfig` compatibility layer でも fresh default は次の canonical representation とする。

```ts
privacy: {
  autoSave: false,
  privacyMode: true
}
```

IndexedDB unavailable の場合でも UI state が旧 default (`autoSave=true`, `privacyMode=false`) に戻らないよう、既存 default config の privacy default も Phase 2A で更新する。

v1 persisted config に明示された `autoSave` / `privacyMode` は migration 時にその値を尊重する。値が欠損した corrupt/partial legacy config は privacy-safe に private-session へ倒す。

## 5. IndexedDB factory injection

Core/storage module import 自体が global `indexedDB` の存在を要求してはならない。

`openDatabase` は次のように `IDBFactory` を必須引数として受け取る。

```ts
openDatabase(factory: IDBFactory): Promise<IDBDatabase>
```

Browser bootstrap が feature detection 後に global factory を渡す。Test は `fake-indexeddb` の factory を注入する。

## 6. Corrupt config と legacy document recovery

v1 config が validation failure でも legacy document record は削除しない。ただし privacy intent を確定できないため、その本文を自動で v2 persistent store へコピーしない。

Phase 2A migration は default private-session state を作り、recoverable legacy document が存在することを `MigrationResult` warning/recovery data として返せるようにする。後続UIで recovery導線を追加できるが、Phase 2A では本文を無断永続化しない。
