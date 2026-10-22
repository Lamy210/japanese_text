# Manual Lint再入時のRevision待機衝突を防止

## 問題

従来の`lintAllNow()`はクリックのたびに
`registerWait(appState.revision(), ALL_TIERS)`を呼び、
待機処理のMapに同じrevisionをキーとして上書き登録していた。

同じ文書でLintボタンを素早く二度押すと、
最初のPromiseが結果を受け取れず、10秒watchdogまで
待ち続ける可能性があった。Workerにも同じ文書の
3 tier解析が重複して送られていた。

## 修正

- `lintAllNow()`が、同一revisionで実行中の手動Lintを保持。
- 連続クリックには同一Promiseを返し、
  新しいWorker要求や新しいWaiterを登録しない。
- 結果・Skip・Tierエラー・WatchdogでPromise完了後、
  保持していた待機を解除し、同じrevisionを再Lintできるようにする。
- 文書変更でrevisionが進んだ場合は、古い要求とは別の
  PromiseとWorker要求を作る。
- 古いPromiseの完了で新しいrevisionの待機が解除されないよう、
  参照一致した場合だけクリーンアップする。
- 独立したShadow Lintは負の一意なrevisionを使用するため影響しない。
- スケジュール済みタイマーは手動Lint時に従来どおりキャンセルする。

## 回帰テスト

Fake Workerを使用し実際の`lintController.lintAllNow()`から
MessageHandlerへ応答を送り、以下を検証する。

1. 同一revisionの重複クリックは1 Worker要求 + 同じPromise。
2. 結果受信後は同じrevisionでも次の手動Lintを開始できる。
3. 新旧revisionの待機は独立し、逆順に完了しても結果を取り違えない。

## 非目標

他の解析要求（Fast/Deep/Idle自動スケジューリング）との
全体的な重複排除や、ブラウザ実測・textlint自体の強制停止は
別フェーズ。新しい依存・外部通信・保存形式の変更はない。
