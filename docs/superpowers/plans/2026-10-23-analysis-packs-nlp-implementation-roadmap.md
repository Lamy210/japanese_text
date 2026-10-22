# Japanese Writing Toolkit — Analysis Packs × NLP 実装ロードマップ

> **対象:** `Lamy210/japanese_text` / `main`
> **起点:** `d4058cfc82ab24c8ab1f4a4a6b210f8c1d33d8ab`（2026-10-23 JST 確認時）
> **状態:** 計画PR・機能未実装
> **詳細仕様:** [Analysis Packs × NLP 詳細設計 v5.0](../specs/2026-10-23-analysis-packs-nlp-detailed-design-v5.md)
> **AP-01〜AP-16:** これから作成する実装PRの仮ID。既存GitHub PR番号ではない。

## 目的・非目標

6つのAnalysis Pack（`core`、`grammar`、`dictionary`、`morphology`、`technical`、`style`）を段階的に提供し、日本語の誤字・誤用・文法・技術文書・構成の校正品質を向上させる。Lindera WASMを第一候補とし、kuromojinを同条件で比較して採否を決める。

- **維持:** ブラウザ完結・原文の外部送信なし・LLM不要・GitHub Pages静的配信・Fast / Deep / Idle・Formatterの3-tier Baseline/Shadow安全性。
- **保護:** `RuleProvider` と `CoreRule.run()` の同期契約、Diagnosticの既存source/ruleId、Workspace/RuleProfile、Private Session。
- **今回のPRの範囲:** 設計文書と実装計画のみ。機能実装、ライブラリ追加、CIワークフローの変更、マージは含まない。
- **計測上の注意:** 性能・精度・ブラウザ互換性の目標を達成済みと見なさない。独立Gold Corpusと実機測定で判断する。

## 実装チケット（仮PR）

| ID | スコープ | 依存 | 完了ゲート |
|---|---|---|---|
| AP-01 | 既存診断Gold / 性能Baseline、Segmenter・Private境界 | なし | 診断互換・文分割テスト・保存経路の監査 |
| AP-02 | Pack / Provider Manifest、Rule所属、Resolver | 01 | core必須・依存循環/ID重複の拒否・旧診断不変 |
| AP-03 | AppConfig v2・RuleProfile射影・Import/Export・v1移行 | 02 | Profile切替と保存復元、StorageMode不変、未来スキーマ拒否 |
| AP-04 | Core軽量校正、textlint Adapter、sentence-splitter比較 | 02,03 | 負例テスト、旧ルールとの重複計測、bundle検証 |
| AP-05 | 辞書スキーマ・Compiler・Validator・用語優先順位 | 03 | 既存誤字Gold不変、ユーザー許可表記優先、辞書入力制限 |
| AP-06 | Grammar（助詞、二重否定、ら抜き等）の個別PoC | 04,05 | kuromojin依存・誤検知・除外条件・Shadow比較 |
| AP-07 | Technical Pack（技術文書・Markdown） | 04,05 | API・CLI・URL・変数名・コードの誤警告防止 |
| AP-08 | Style Pack（冗長・接続詞・業務文書） | 04,05 | 既存ルールと診断競合しない、低確度はReview Only |
| AP-09 | MorphToken、UTF byte/codepoint→UTF-16、ProseRegion | 02 | Unicode/Markdown位置Gold完全一致 |
| AP-10 | NLP Coordinator・Worker・キャンセル・障害隔離 | 03,09 | stale破棄、終端1回、タイムアウト、NLP OFFで未起動 |
| AP-11 | Lindera WASM・IPADIC・OPFS辞書インストーラ | 10 | 同一オリジン配布、hash/部分書込/複数タブ/rollback |
| AP-12 | kuromojin Adapter・ローカル辞書・キャッシュ制御 | 10 | Unicode offset、Private Session、ブラウザ互換性 |
| AP-13 | 両Providerの公平比較・採用ADR | 11,12 | Precision/Recall/遅延/メモリ/辞書サイズ、採否を記録 |
| AP-14 | 形態素校正Rule・Diagnostic Aggregator | 05,06,13 | NLP Safe Fixゼロ、重複抑制、独立Holdout |
| AP-15 | Pack設定UI・辞書管理・根拠表示 | 03,07,08,14 | 初回同意、障害の区別、OFF/削除/Private切替とa11y |
| AP-16 | ブラウザ受入・Pages配布・Runbook・Rollback | 15 | Chrome/Firefox/Safari/iOS/Android、オフラインとライセンス判定 |

## 実装フェーズ

1. **A — 基盤（AP-01〜03）:** 互換性を固定し、Pack/Provider APIと設定保存境界を作る。
2. **B — 軽量校正（AP-04〜08）:** 辞書・日本語文法・技術文書・スタイルをNLP未導入でも利用可能にする。
3. **C — 高度NLP（AP-09〜14）:** Unicode/Markdown位置、独立Worker、Lindera・kuromojin比較、限定的な形態素ルール。
4. **D — 統合（AP-15〜16）:** UI・辞書ライフサイクル・端末別のGo/No-Go・ロールバック。

**並列作業:** AP-04/05/09は基盤が固まれば並走可能。AP-11とAP-12はAP-10完了後に並走可能。AP-13採用ADRが出るまで特定Providerの標準有効化は禁止する。

## 全実装PRの最低レビュー基準

- `bun run lint`、`bun run test`、`bun run build`、`bun run build:pages`。未実行時は理由を記載する。
- コード・URL・Markdown引用、絵文字、結合文字、サロゲート、CRLF、文書・Profile/Workspace切替を回帰テストする。
- 既存FormatterのBaseline/Shadow完了契約を維持し、NLP診断は初期段階で `fixKind:'none'|'suggestion'` のみとする。
- 解析不能と診断ゼロを区別する。新Providerにより既存Fast/Deep/Idleを停止させない。
- Private時に本文や独自辞書を永続化・送信しない。辞書アセットは同一オリジンで取得する。
- 新規OSSのバージョン・ライセンス・配布条件・Worker対応を記録。Precision 95%等は**設計目標**であり測定実績ではない。
- **CIワークフローの追加・有効化は行わない。** 各PRの既存スクリプトでローカル検証し、結果を報告する。

## 最初の着手提案

**AP-01**を先行してBaseline・Private保存境界・Segmenterの初期化をテストし、次に**AP-02**でPack/Provider/Rule Resolverの契約を実装する。その後AP-03でAppConfig v2の保存・移行を導入する。

## 参考資料とトレーサビリティ

- [詳細設計 v5.0](../specs/2026-10-23-analysis-packs-nlp-detailed-design-v5.md) の第17章・第35章：各APの変更対象ファイル・受入条件
- 第21〜32章：Resolver、Migration、Worker、Unicode、辞書、OSS AdapterとRuleの規範仕様
- 第33〜34章：性能・セキュリティ、Privacyと配布の検証
- 第36〜39章：テストケースID、未確定事項、Runbook、最終判定
