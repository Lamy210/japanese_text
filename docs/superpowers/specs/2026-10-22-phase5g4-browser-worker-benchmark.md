# Phase 5G-4 — ブラウザ実Worker往復時間の計測

## 使用方法

```bash
bun ci
bun run dev
```

ブラウザで <http://localhost:3000/dev/benchmark.html> を開き、
「計測を開始」を押す。結果表のp50/p95/p99を確認し、
必要なら「JSON結果を保存」で手元にダウンロードする。

- 通常：prose / markdown、1,000と10,000 UTF-16文字、各5回の実測
- 詳細：prose / markdown / repetition / long-sentence、
  1,000 / 10,000 / 50,000 / 100,000 UTF-16文字、各3回の実測
- 解析前にウォームアップを実施。Cold Startとして
  最初のLint要求の実往復時間（Worker立上げ・遅延読み込みを含む）も別計測。
- 追加のnpm依存は不要。アプリ本体と同じ
  `src/worker/analysis.worker.ts` を **別個のWorkerインスタンス**で使う。
- Markdown/Textのうち、初期版ではMarkdownで3段階の
  Fast/Deep/Idleを連続実行し、textlintも含める。

## 指標

| 指標 | 測定内容 |
| --- | --- |
| `roundTripMs` | Main Threadの`postMessage`開始から全Tierの受信まで |
| `workerDurationMs` | Workerが返す独自ルールの処理時間の合計 |
| `coldStartMs` | 専用Workerを起動した直後、初回Lint完了までの往復 |
| `totalDiagnostics` | 各サンプルで受け取った診断数の合計 |
| `p50/p95/p99` | 測定回数に対するnearest-rankパーセンタイル |

往復時間には構造化複製、Workerスケジューリング、textlintの非同期解析、
メッセージ伝達を含む。一方、`workerDurationMs`は現行プロトコルの
`durationMs`をそのまま合算した値であり、textlintや伝送を含まない。
**両者を単純に差し引いて「転送時間」と解釈してはいけない。**

コードエディタのキー入力・DOM描画・CodeMirrorのDecorationや、
実際のフォーム入力遅延（INP）はこのページでは測定しない。
入力遅延の計測は、今後の実ブラウザE2E計測で行う。

## 計測の安全性

- 利用者のEditor、Local Library、Private Session、
  コードや文書の本文は参照しない。
- 入力文は既存の決定論的`createWorkload()`の合成文書のみ。
- 実行ごとに専用Workerを作り、終了後は必ずterminateする。
- リクエストは負の単調減少revisionを使い、
  UIのrevisionゲートと衝突しない。
- Skip、Error、RuleError、タイムアウトは失敗扱いにし、
  不完全なサンプルを成功値に含めない。
- 1〜20実測回、0〜5ウォームアップ、合計120回以内の上限。
  1回あたり最大180秒のTimeout。タブを閉じれば終了する。
- JSONには生成文章を含めない。
  ブラウザUser Agentは環境の比較に必要なので含める。
  ユーザーが保存操作を行わない限りファイル化しない。
- 外部API・分析サービス・ログ収集サービスには結果を送信しない。

## 既知の限界と比較方法

p99は通常5回（詳細3回）の少数サンプルで得られ、
統計的に安定しない。論文やSLO達成根拠に使用しない。

同じOS・ブラウザ・CPU・電源設定・拡張・タブ状態にそろえ、
より多くの反復を採取して比較する。
共有GitHub Actions上で測定したms値によるパフォーマンスの
強制ゲートは導入しない。

`dev/benchmark.html` はVite開発サーバーでのみ開く副入口であり、
現行のproduction buildは`index.html`のみを出力する。
ページに実データへの導線はなく、
製品の公開GitHub Pagesには新しいベンチ画面を追加しない。

## テスト

`tests/performance/browser-worker-benchmark.test.ts` は
Workerのメッセージを再現し、終了・異常系を検証する。

- Fast/Deep/Idle全Tierの正常終了だけを成功として集計
- 別revisionと二重応答を無視
- Skip / Error / RuleError / Timeout / Request.postMessage失敗を拒否
- 終了後にListenerとTimeoutを破棄
- コーパスは正しいUTF-16長で生成・私有文書を報告しない
- 最大反復回数の制限
- TypeScript（`dev`ディレクトリ含む）、Vitest、通常/Pagesビルドを検証

実際にブラウザ上で描画・性能数値を収集したとはまだ主張しない。
使用端末のブラウザで手動実行してベースラインを蓄積する。
