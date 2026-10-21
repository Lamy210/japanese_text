# Phase 4F — Local Libraryでの文書単位の診断無視の永続化

## 目的

前フェーズで追加した「この文書で同じ警告を無視」はタブ内メモリのみだった。
Local Libraryの利用者は、ページ再読み込み後も意図的な警告抑制を使いたい。
**Private Sessionでは絶対に永続保存しない**ことを最優先の制約とする。

## 保存形式・既存基盤の再利用

新しいIndexedDBのバージョン・ストアは追加しない。既存DB v2の
`suppressions` ストアを利用し、`src/storage/document-ignore-store.ts`
から読書きを提供する。

1件のレコードには `scope:'document'`, `scopeId: documentId`,
`kind:'message'`, `ruleId` と `match` が含まれる。
`match` は診断の **sourceと選択文字列のみ** のJSON配列である。
レコードIDは `workspaceId`・`documentId`・診断キーの組で一意となる。

**対象文字列はIndexedDBへ保存される。** 全文は診断無視のために
新たに複製しないが、Local Libraryの文書本文自体は従来どおり
そのブラウザのIndexedDBに保存される。
クラウド、分析API、LLMへの送信は行わない。

## トランザクションとプライバシー

- 保存時は同じreadwriteトランザクション内でWorkspaceが
  `local-library` であることと、対象Documentの所有者を確認する。
- Private SessionではIndexedDBの無視情報を読まず、書き込まない。
- 登録・解除の失敗時は表示状態を変更せずエラートーストを出す。
- 同時の登録・解除操作をシリアライズし、書き込み競合を避ける。
- 文書切替時・初期表示時に既存の永続レコードを読み、解析前に
  無視条件をロード。読込失敗時は警告を表示する側へ戻す。
- 文書削除（最終1件の置換を含む）、Local LibraryからPrivate
  Sessionへの切替、永続文書の一括消去では**文書本体と同じ
  IndexedDBトランザクション**で関連する抑制レコードを消す。
- ワークスペース削除は既存の原子的カスケード削除を使う。
- Local→Private切替成功後は当該ワークスペースのメモリ内の
  無視設定もクリアする。

既存の`TermEntry`（用語集）、`RuleProfile`、
`AppConfig`への保存は行わない。

## UI

診断パネルの「この文書で同じ警告を無視」「再表示」を引き続き使う。
Local Libraryでは「このブラウザのIndexedDBに保存」と表示。
Private Sessionでは「このタブのみ。再読み込みで解除」と表示。
ブラウザ自体のサイトデータ削除・プライベートウィンドウの終了などで
Local Libraryの保存データも失われ得る点は既存仕様と同じである。

## 検証

- fake-indexeddbによる追加・読込・解除・重複拒否・不正キー拒否
- 文書ID / ワークスペースIDの相互分離
- Privateモードでの永続書込み拒否
- 文書削除、Private Session切替時の原子的消去
- コントローラーによる文書移動・再表示と読込失敗時のfail-open
- UIアクションから実際のDB書込み・解除を行う統合テスト
- 型検査、全Vitest、本番ビルド、Pagesビルドとアセットパス検証

## 既知の制約

無視条件は特定の一箇所ではなく、同じ文書内の
「source / rule ID / 完全一致する文字列」を対象とする。
1文書100件、対象文字列240 UTF-16 code unit以内。
検出結果の意味を解析したり、無視を自動学習する機能ではない。

複数ブラウザ・端末間の同期は非対応。実文書の誤検知率はこの
回帰テストでは測定しておらず、別途代表性のある評価セットが必要。
