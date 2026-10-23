# AP-03c — 既存WorkerへのAnalysis Pack実行ゲート

> 実装範囲: 既存RuleのPack ON/OFFを解析時に適用する最初のスライス。設定UI・NLP Worker・辞書ダウンロードは対象外。
> ベース: `f95a0eb1adc695266e3fa93eef656281faffc8e3`（#72まで）

## 背景と選定

AP-02はRulesのprimaryPackとResolverを提供し、AP-03a/bはProfileに6 Packの設定を保存できるようにした。しかし現在の`analysis.worker.ts`はPackの設定を見ず、個別Ruleの`enabled`だけで解析していた。

候補:
- A. **Worker入口で一度だけ実行専用Configを導出（採用）**。既存Engineとtextlint Adapterを変更せず、Shadowも同じ設定にできる。
- B. 各RuleにPack判定を追加（非採用）。実装が分散し、textlint/Formatterへの変更漏れが起きやすい。
- C. 診断表示時にPackの結果を隠す（非採用）。無駄な解析を実行し、FormatterやruleErrorsと結果が矛盾する。

## 仕様

- `configForEnabledAnalysisPacks(config)` は既存の`createLegacyAnalysisCatalog()`が定義する単一Pack所有権を使用し、PackがOFFのRuleを**解析用コピー**で`enabled:false`とする。
- 元の`config.rules`, `severity`, `options`, `analysis`は変更しない。再度PackをONにすれば元のRule設定がそのまま復活する。
- `core`は必須であり、正規化を迂回した`core:false`が届いても全coreルールを停止させない。
- `analysis.worker.ts`のFast/Deep/Idleとtextlint、およびFormatterのShadow要求は同一の実行専用Configを使う。
- `persistAndRelint()`は最初に`appState.invalidateAnalysisForConfigChange()`を呼び、本文が変化しなくてもRevisionを進め、古い結果をUIへ反映しない。既存の`allowDiagnosticSpelling`内の重複した明示的無効化を除去する。

## 重要な互換制約

AP-02の旧ルールCatalogは意図的に「辞書ルール3件＝dictionary、それ以外の既存ルール＝core」と分類している。**本PRでは分類を勝手に変更しない**。したがって実際に停止を確認できるのは既存dictionary所有ルールであり、grammar/style/technicalは将来PRで既存ルールの所属を再評価するまで、既存ルールを停止させない。Morphologyは現在も解析Provider未導入のためOFFが初期値。

設定UIはまだ公開しない。Settingsや保存はAP-03bの既存経路を使用する。

## Meaningful tests

- **Pack gate失敗検出**: DictionaryをOFFにしても実際のFast Engineが誤字・NGワード・用語統一を報告してしまう場合に失敗。
- **互換性**: Ruleごとの有効状態・severity・optionsを上書きしない。Core Ruleは無効化されない。
- **可逆性**: Dictionaryを再度ONにした際、元の誤字検出が復活する。
- **Formatter**: 停止したPackのSafe Fix候補が解析結果に含まれない。
- **Worker旧結果**: Config変更＋再LintではRevisionが必ず進む。
- **CI**: 型チェック、辞書検証、Vitest、benchmark Smoke、通常/Pagesビルド、アセットパス検証。CIファイルは変更しない。

## 残る課題

- 全Ruleの意味的なPack所属の再検討（AP-04以降）。
- Pack選択UIと、Provider不在/未解析の明示表示（AP-15）。
- リクエスト単位の詳細なProvider状態やNLP WorkerはAP-09〜14へ分離。
- Workerを実ブラウザでテストするE2E、Profile切替が重なるストレス試験（AP-16）。
