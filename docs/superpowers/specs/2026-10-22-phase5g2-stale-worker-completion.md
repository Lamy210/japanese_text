# Phase 5G-2 — 古いWorker解析要求の安全なスキップ

## 問題と適用範囲

文書の編集中にはFast/Deep/Idleが時間差でWorkerに送られる。
従来、UIは古いrevisionの診断結果を採用しなかったが、Worker自体は
非同期textlintの完了後も古いrevisionの残りのtierを続行し得た。

単純なキャンセルは、手動の`lintAllNow`、Formatter用の
`lintShadowText` の完了待ち、`inFlight`件数に不整合を起こす。

そこで、**古いUI要求に対して実行されていないtierをスキップし、
全tierに終端通知を返す**契約を追加する。

## プロトコル

`WorkerResponse`は以下を返す。

| type | 主な値 | 待機状態 |
| --- | --- | --- |
| `result` | revision, tier, diagnostics | 終了（結果を採用） |
| `skipped` | revision, tier, reason: superseded | 終了（結果なし） |
| `error` | revision, tier, message | 終了（結果なし） |
| `ready` | segmenterAvailable | Tier終了ではない |

Worker側でUI用の非負revisionを単調増加で記録し、それより小さい
非負revisionのtierを実行前にスキップする。

- 同一revisionの別tierはスキップしない。
- Formatterの負のShadow revisionは、UI revisionを上書きしない。
- Shadow要求自体も新しいUI revisionによって破棄しない。
- `loadTextlint`の非同期import後、およびtextlintの非同期実行後にも
  古いrevisionを確認して、後続tierや診断の送信をスキップする。
- **同期実行中のルールを強制停止するものではない。**
  textlint内で実行中の処理を中断できるわけでもない。
- スキップしたtierにも一度だけ`skipped`を返し、Workerが
  応答なしになる状態を避ける。

## Main Thread側

`TierCompletionTracker`で要求されたtierの終了を管理。
結果、スキップ、エラーのいずれでもそのtierを完了扱いにし、
待機中のPromiseを解決する。スキップやエラーは正常な診断結果に
偽装せず、結果Mapには入れない。

- `ready`は進捗完了として数えない。
- `lintAllNow`が古くなった場合は、終了済みtierの結果だけ返す。
- Shadow lintの`inFlight`は全3tier分計上する。
- `revision === appState.revision()`の最新結果のみUIへ反映する
  従来の条件は維持する。
- Worker全体が停止した場合の再起動・watchdogは従来どおり。

## テスト方針

- 単調増加する正のrevisionと0、古い要求の順序逆転
- 非同期textlintが処理中に新しいrevisionを受信し、
  古いDeep/Idleが明示スキップになる
- Shadow lint(-1001)のDeep/Idleは新規UI変更後も正常に終了
- Tierごとのerrorで待機が完了し、他tierも実行可能
- 重複応答や要求外tierで待機が早期完了しない
- 既存の校正コーパス・Formatter安全性・Workerビルドとの互換

## 非目標

Worker自体のterminateによる強制中断、グローバルな共有キャッシュ、
バックグラウンドで動くtextlintの真の中断、ブラウザ実測値の改善保証、
新しい依存・通信・LLMの追加は行わない。

本変更は**古い解析の不要な後続仕事を減らす**ための第1段階。
実際のp95入力遅延・Worker往復時間については、別途ブラウザE2E
測定後に改善効果を判断する。
