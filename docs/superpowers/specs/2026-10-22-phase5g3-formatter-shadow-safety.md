# Phase 5G-3 — Formatterの不完全解析時の適用防止

## 既存の危険な経路

これまで `formatDocumentAction` は、
`lintAllNow` の結果を確認せず診断一覧を参照し、
Shadow Lintに不完全な結果が返った場合でも
エラー数が増加しなかったと判断してSafe Fixを適用し得た。

特に前フェーズで古いWorker要求が`skipped`となる際や、
Workerエラー・10秒watchdog後の部分Mapが返るケースでは、
「検査できていない」ことと「問題がなかった」ことを混同してはならない。

## 新しい適用条件

1. Format開始時の文書本文とrevisionを保存する。
2. 手動LintのFast / Deep / Idleすべてに`result`を要求する。
3. すべて開始時のrevisionと一致し、`ruleErrors`が0件であること。
4. 解析待ち中に文書やrevisionが変わった場合は適用中止。
5. Safe Fixが存在する場合、変更後テキストを負のShadow revisionで解析。
6. Shadowもすべてのtierが正常終了し、同じ負のrevisionに対応していること。
7. 変更後のError件数が変更前以下である場合のみ、従来の
   文書・ワークスペース同一性検証・History確保へ進む。
8. 解析失敗、部分Map、Shadow例外、Error増加時は**変更せず警告を表示する**。

`ruleErrors`は解析機能自体の失敗を表す。
`Diagnostic.severity=error`と区別し、
失敗したルールがある状態を正常な検証結果とはみなさない。

## Shadow revisionの一意性

従来の`-Date.now() - Math.random()*1000`は、短時間に
複数回実行された場合、同じ数値になる可能性があった。
完了待ちはrevisionをキーにしているため、衝突すると異なる
Shadow結果が混同され得る。

`nextShadowLintRevision()`はタブ内モジュールごとに
-1、-2、-3…と一意の負の整数を割り当てる。
Number.MAX_SAFE_INTEGER限界に達した場合は例外とし、
不正なrevisionを送信しない。

## 品質ゲート

- 各tier欠落・別revision・RuleErrorの安全拒否
- Shadowのreject/timeout相当の部分Mapを受けても本文を変更しない
- 変更後にErrorが増えた場合の適用拒否
- 正常な全tierとError増加なしの場合のSafe Fixは従来どおり適用
- 10,000回連続して負のrevisionが一意であること
- TypeScript、全Vitest、Bunスモーク、Vite/PagesとWorker asset確認

## 制約

この変更は、Formatterが不確かな検証結果を根拠に変更しないための
安全ゲートであり、文法を完全判定するものではない。
Workerの一時的な障害ではFormatが利用できない場合があるが、
UI上で警告を表示し、元文を保持することを優先する。
