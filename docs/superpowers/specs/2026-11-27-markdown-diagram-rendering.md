# Markdown図描画の導入ゲート（未実装）

## 目的
既存のMermaidコードフェンスのソース表示から、外部サービスに文書を送らないローカル図描画へ移行する。

## 採用候補
公式MermaidパッケージをBunで固定し、bun.lockを同時更新。CDN・Kroki等の外部APIへのフォールバックは禁止。バージョンは実際にインストール・監査した時点で確定する。

## セキュリティ・運用
- 自動起動を無効化し、遅延ロード・明示描画から開始する。
- strict/sandboxを候補とし、クリック、HTMLラベル、画像、外部フォント、外部URL、設定上書きを禁止する。strictだけで通信防止が成立するとみなさない。
- 図をアプリ本体DOMに無検証で挿入しない。隔離コンテキストとCSP（connect-src none、外部リソース禁止）を設計し、SVGの許可リスト検証を行う。
- maxTextSize/maxEdges、図数、再描画頻度、処理時間を制限する。実行中の同期処理をPromiseタイムアウトだけで停止できるとはみなさない。
- 不正構文・過大入力・未対応図・依存ロード失敗時は元のコード表示を維持する。文書変更や切替後の古い結果を反映しない。
- 保存・履歴・Lintは原文を維持。図の内容をログやテレメトリへ送信しない。

## 受入条件
1. bun ci、型チェック、単体テスト、通常/Pagesビルドが成功。
2. 実ブラウザでflowchart、sequenceDiagram、erDiagram、stateDiagramを検証。
3. 悪意ある設定、HTML/SVG、リンク、画像、CSS URL、過大図の試験で外部通信・親DOMアクセス・スクリプト実行がない。
4. 文書切替、テーマ切替、連続入力、異常構文で既存編集が維持される。
5. 依存ライセンス、脆弱性、バンドルサイズ、描画時間を確認する。

公式仕様:
- https://mermaid.js.org/config/usage
- https://mermaid.js.org/config/schema-docs/config
- https://mermaid.js.org/config/configuration

現在は依存未追加。ツールバーでMermaidソースの挿入と安全なソース表示のみ可能。
