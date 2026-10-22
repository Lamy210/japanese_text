# Phase 5G-6 — Worker障害・再起動時の待機解除と世代分離

## 発見した不具合

`lintAllNow()` / `lintShadowText()` は、WorkerのTier別完了通知を
`pendingWaits` / `messageHandlers` に登録し、最大10秒待機する。
一方、Workerクラッシュまたは明示再起動で`terminate()`しても、
従来のコードはこれらの待機を直ちに完了させず、
`inFlight`に残った件数も調整しなかった。

- 手動Lintは最大10秒結果を待ち続けることがあった。
- FormatterのShadow Lintは安全性判定へ進めず、操作を待たせた。
- 古いWorkerから遅れて来たメッセージが、新Workerの進捗や
  同じrevisionの待機を壊す可能性があった。
- `postMessage` が例外を送出する場合は、処理全体が例外で抜け、
  登録済みWaiterが残る可能性があった。
- 新Workerの生成に失敗した場合も待機だけが残り得た。

## 修正

`src/state/lint-controller.ts`のWorkerライフサイクルを強化する。

1. **異常終了・明示再起動**で全PendingWaitのタイマーを解除し、
   RevisionごとのMessageHandlerを削除する。
2. 取り消したWaiterは**空Map**で完了させる。
   途中の一部の診断を成功結果として引き渡さない。
   現行FormatterはFast/Deep/Idle全Tierが揃わない場合
   文書を変更せず終了するので、fail-closedの契約を守る。
3. `inFlight`を0へ戻し、古いスケジューラのタイマーを解除。
   `manualLintInFlight`を消去し、手動Lintをすぐ再実行できるようにする。
4. WorkerのイベントListenerは生成した**Workerオブジェクト自身との一致**
   を確認する。古い世代のmessage/errorイベントは無視する。
5. `postMessage`をtry/catchで囲み、失敗時もWorker障害の共通処理へ渡す。
6. Worker生成に失敗してpost不能となった場合も待機を解除する。
7. Worker自動回復用の遅延タイマーを保持し、手動再起動で解除する。
   回復できたときだけ再解析を試みる。

## テスト設計

実際の`lintController`にFake Workerを接続し、以下を検証。

- クラッシュ後の手動Lintがwatchdog 10秒を待たずに完了
- 一部Tierが返った後にShadow LintのWorkerが停止しても
  結果Mapを空にし、Formatterの誤適用を防ぐ
- 明示再起動でも既存Waiterを解除
- 古いWorkerの遅延応答が新Workerの解析を完了扱いにしない
- `postMessage`例外、Workerコンストラクタ例外で待機が残らない
- 自動回復で新Workerを生成し、結果の完了後は`idle`へ戻る
- 既存のManual Lint重複要求共有と負のShadow Revisionは維持
- CIで厳格TypeScript・全Vitest・Bunベンチマークsmoke・
  本番/PagesビルドとWorker asset-path確認

## スコープ外・注意点

これは**Worker障害を検知した場合**に限った即時の待機解除である。
応答が単に遅いケースでは従来のwatchdog (10秒) による検知が残る。
Web Workerが同期解析中に固まった場合、その処理自体を強制中断する
ものではない。クラッシュ後の自動回復には環境やブラウザ制限によって
失敗する場合があり、成功を保証するものではない。

新しい通信先、LLM、保存方式、DBマイグレーション、依存関係は不要。
