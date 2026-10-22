# AP-03A — AppConfig v2 とRuleProfileのPack設定保存

> 状態: 機能PR。AP-03全体のうち「設定移行・保存」のスライス。Lint実行へのPack gate接続と設定UIは本PRの対象外。
> 起点: `e9d9ca32ad484e2836a4cc16f0ff161f24ed4b59`（2026-10-23 JST）
> 詳細計画: [AP-01〜AP-16](../superpowers/plans/2026-10-23-analysis-packs-nlp-implementation-roadmap.md)

## 目的・採用方針

- AppConfigの`schemaVersion`を1から2へ更新し、`analysisPacks`を6つのPackのbool集合として持つ。必須の`core`は常にtrueへ正規化する。
- 既存ユーザーの旧v1 configやIDB v2 RuleProfileには`analysisPacks`が存在しない。移行時は**core / grammar / dictionary / technical / style = true、morphology = false**にする。AP-02の標準Pack初期値とは異なるが、**既存のルールが移行だけで停止する事態を防ぐことを優先**する。旧Rule単位のenabled/severity/optionsは保持する。
- RuleProfileの`analysisPacks`は旧レコード互換のためoptionalとし、`composeAppConfig`で欠損時だけ互換初期値を補う。保存時には明示的なPack設定を書き込む。
- Workspaceの`storageMode`（Private Session / Local Library）の正本は既存のWorkspaceレコードであり、単なる設定保存から切り替えない。旧v1の設定をストレージ移行する場合に限り、従来の`splitAppConfigForMigration`の規則を使う。
- IndexedDBのオブジェクトストア構造は変えずDB_VERSION=2のままとする。本文、解析結果、辞書をネットワークへ送信することもない。

## 範囲と非目標

変更: `src/core/config/schema.ts`, `validate.ts`, `src/core/analysis/packs.ts`, `src/core/workspace/{types,defaults,validate}.ts`, `src/storage/compat/app-config-projection.ts`、回帰テスト。

変更しない: `RuleProvider`、`CoreRule.run`、Fast/Deep/Idle、Formatter、診断ID、CIワークフロー、Providerバイナリ、辞書アセット、UI。

**重要:** 本PRではPack設定を保存できるが、PackのON/OFFがまだ実際の解析を無効化するわけではない。AP-03BでResolverをLint Controller/Engineへ安全に接続する前に「有効な機能」としてUI表示しない。

## 互換性とテスト

| 事象 | 期待値 |
|---|---|
| v1 configのimport | v2へ正規化、既存rules不変、Pack互換初期値 |
| v1 RuleProfileの読み込み | 破壊的移行せず互換Pack選択で構成 |
| v2 configに`core:false` | `core:true`へ正規化 |
| v2 configの不正/未知Pack | validation error（握りつぶさない） |
| Profile保存・切替・複製 | Pack状態はProfileごとに分離 |
| Private Workspaceの通常設定更新 | storageModeと本文保存ポリシーは不変 |
| IDB v2へのPack追加 | Version upgrade無しで後方互換のレコード保存 |
| 将来のschemaVersion=3 | 明示拒否 |

## 留意事項

- Private Sessionは本文を永続化しないモードであり、従来のRuleProfile設定（NG語・用語集など）はIndexedDBへ残り得る。本変更はその既存仕様を変更しない。セッション専用ユーザー辞書のライフサイクルは後続PRで扱う。
- AP-03BではPackと個別Rule有効状態のAND、Formatter Baseline/Shadowが依存する全Tierの完了規則、Profile/Workspace切替時のRevision無効化を一体で検証する。
- required CIとローカル検証が成功し、未解決レビュー問題がない場合に限りマージする。
