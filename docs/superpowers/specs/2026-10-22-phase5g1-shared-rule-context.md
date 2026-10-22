# Phase 5G-1 — 解析コンテキストの同一Worker要求内共有

## 解決する重複処理

これまでの `runOwnRules` は Fast / Deep / Idle の各tierを呼ぶたびに、
以下を必ず再計算していた。

- `maskDocument` によるコード・URL・メタデータ領域の抽出
- 行分割・行開始offset
- `LineIndex` の生成
- `buildRuleRegistry` による組み込みルール/ユーザー辞書設定の取り込み

文書変更時はtierごとにWorkerメッセージが送られる場合があり、
そのときの重複は残る。今回はまず、手動一括Lint、
FormatterのShadow Lint、設定変更後の一括Lintなど、
**ひとつのWorker要求が複数tierを含む場合の重複のみ**削減する。

## APIと設計

`prepareOwnRuleExecution(text, config)` は
`{text, config, context, lineIndex, registry}` を返す。

`runOwnRules(text, config, tier, docType, prepared?)` は
既存4引数呼出しを残したまま、任意の解析計画を再利用する。

- `prepared.text !== text` なら拒否
- `prepared.config !== config` なら拒否
- config内のユーザー辞書等を参照するRuleProviderは
  **その要求に付属する同一オブジェクト**で構築される
- 同じ文字列でも別revision/別設定のplanへ流用しない
- Workerが受信したリクエストごとに一つ作り、要求終了時に解放
- 別の要求や別文書へのグローバルキャッシュは作らない
- textlint adapterが利用する構造を変更しない

初回tierの`durationMs`には計画生成の所要時間を加算し、
全tierの合計が事前処理時間を無視しないようにする。
Deep/textlintの外部アダプター所要時間は従来どおり`own.durationMs`
に含まれず、今回の変更で計測仕様は拡張しない。

## 性能計測

既存の`bench:analysis`に次のステージを追加。

- `all-own-fresh`：Fast / Deep / Idle で毎回コンテキスト作成
- `all-own-shared`：同一コンテキストとRuleRegistryを共有

比較対象はいずれも同じ入力・設定・tierで、診断件数と所要時間を記録する。
Bun CPUの人工入力測定であり、体感入力遅延・実ブラウザのWorker往復
・textlintのレスポンス速度を示すものではない。
共有CIランナーのばらつきが大きいので時間閾値ではテストを失敗させない。

## 安全性と回帰テスト

- 複数のMarkdown、Unicode、引用、繰り返し表現、10k文字の資料
- 新旧実行経路でRule ID/offset/修正種別を含む診断とRuleErrorsが一致
- Text modeでも一致し、既存4引数APIが壊れない
- 別テキスト・別Configオブジェクトの計画混用は例外として拒否
- 個別ルールの例外処理を維持し、WorkerのRevision結果除外には触れない
- CIで型チェック、全Vitest、スモーク、本番/Pagesビルド、
  Worker asset参照を検証

## 次の性能改善と制約

古いWorker要求のキャンセルや異なるWorkerメッセージ間での共有は未実装。
これらは結果の欠落、`inFlight`のカウント不整合、`lintAllNow`の待機や
Shadow Lintの結果消失を引き起こし得るため、
**メッセージの完了・キャンセル通知の契約**を先に設計してから着手する。
またブラウザE2E性能（p95入力応答など）を実測してから
固定しきい値を導入する。
