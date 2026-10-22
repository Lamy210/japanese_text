# AP-01 — 既存品質とPrivacy境界のベースライン

> 確認基準: `31d448eab11593af5fb3bd6f293f6aeb5b3b682f` (2026-10-23 JST)
> 計画: [AP-01〜AP-16](../superpowers/plans/2026-10-23-analysis-packs-nlp-implementation-roadmap.md)
> 対象: 既存Fast / Deep / Idleを維持したまま、日本語文分割の初回利用バグを修正する
> 性能値: **未計測**（実機p95・メモリの記録ではない）

## 1. スキーマ・校正ルールの現在の契約

- `Diagnostic`: `id`, `ruleId`, `start`, `end`（UTF-16、end排他）, `source`, `fixKind`, `replacement?`; `RuleTier` は `fast | deep | idle`。
- `CoreRule.run()` は同期、`RuleProvider` は `listManifests()/createRules()` を提供する。AP-01では変更しない。
- Formatterは `fixKind: safe` を収集するが、実際のFormat Documentは3-tier Baseline/Shadow完了を検証する。AP-01では変更しない。
- `src/core/dictionary/curated-typos.ts` は版本1の8つの誤字候補。修正は `suggestion`、自動適用しない。
- 追加回帰テストでは `wording/common-typo` と `style/meeting-minutes-sections` の代表診断とUTF-16範囲を固定する。
- Presetは `general | technical | strict | minimal | custom`。具体的な有効/重大度の設定は `src/core/config/presets.ts` が唯一のソース。新Pack導入時に現在のルールID・重大度との互換比較を実施する。

## 2. 合成Goldと既存パフォーマンス計測基盤

調査時点の `tests/corpus/japanese-quality-v2.json` の実数:

| 内訳 | 件数 |
|---|---:|
| 合計 | 172 |
| 正例（`expected`が1件以上） | 72 |
| 負例（`expected`が0件） | 100 |
| development | 91 |
| holdout | 81 |

ジャンル: business, unicode, markdown, technical, quotes, general。これらは**合成・作者定義の回帰テストであり、実運用Precision/Recallの証明ではない**。

既存の文書性能測定は `bun run bench:analysis` と `bun run bench:smoke`。合成文書の長さは1,000・10,000・50,000・100,000 UTF-16、分類はprose/markdown/repetition/long-sentence。これはWorker往復・描画時間を含まない。実機p50/p95/p99とメモリは別途測定し、未測定値を基準値として捏造しない。

実行手順（CIワークフロー追加なし）:

```bash
bun install --frozen-lockfile
bun run lint
bun run test
bun run build
bun run build:pages
bun run bench:smoke
bun run bench:analysis > baseline.json
```

`baseline.json`には実入力本文を保存しない。ランタイム・CPU・OS・ブラウザ・サンプル数を別途記録する。測定結果がない環境で数値SLOは設定しない。

## 3. 文分割の初回呼び出しバグと修正

修正前は `isSegmenterAvailable()` のみが内部 `cachedSegmenter` を生成しており、`splitSentences()` の初回呼び出しは未初期化の `undefined` を見てフォールバックした。修正後は両関数が共通の `getSentenceSegmenter()` で初期化する。

- 対応ブラウザでは最初の `splitSentences()` からネイティブを利用する。
- 非対応環境・コンストラクター失敗・実行時例外は決定論的フォールバックに切り替わる。
- インスタンス生成はモジュール単位で最大1回。利用時の例外ではその呼び出しのみfallbackする（従来方針）。
- 絵文字・結合文字等を含む入力の位置情報はUTF-16 code unitで保持する。
- `Intl.Segmenter` 自体の出力はICU/ブラウザ差があり得るため、ブラウザ別GoldはAP-16で追加する。

## 4. 保存・Privacy境界の監査スナップショット

| 主体 | 現在の格納先/経路 | AP-01の注意点 |
|---|---|---|
| `AppConfig` | `src/storage/compat/app-config-projection.ts` で分解・合成 | 通常の設定保存は既存WorkspaceのStorageModeを維持 |
| `Workspace` | `workspaces` store | `private-session` と `local-library` を区別 |
| `RuleProfile` | `ruleProfiles` store | `rules`, `ngWords`, `terminology`, `customRules` 等を持つ |
| `StoredWorkspaceDocument` | `workspaceDocuments` store / Private時のメモリ経路 | Privateで本文の永続保存は禁止 |
| `DocumentSnapshot` | `documentSnapshots` store / Private時メモリ | 本文を含むため、モード切替・削除を要検証 |
| `Suppression` | `suppressions` store | scope=document/workspace/profile。本文由来のmatch文字列に注意 |
| Legacy `documents.recent` | v1由来のストア | 適切なWorkspaceだけをscrubする |

**重要な未解決事項:** Private Sessionは「本文の永続保存なし」であり、「RuleProfileの辞書・NGワード・設定が全く残らない」ことを意味しない。Profile上の `ngWords`/`terminology` に個人情報が含まれ得る。AP-03ではユーザー辞書のPrivate専用保持・消去範囲と、既存データ互換性を具体化する。AP-01時点で完全消去を保証したと記載しない。

関連既存テスト: `tests/storage/app-config-projection.test.ts`, `tests/storage/privacy-deletion-atomic.test.ts`, `tests/workspace/legacy-privacy-scrub.test.ts`, `tests/workspace/workspace-delete.test.ts`。

## 5. AP-01の検証ゲートと進捗

- [x] 既存の契約、合成Goldの件数、保存経路を確認
- [x] Segmenterの初回初期化を単一ヘルパーで修正
- [x] Segmenter対応・非対応・例外・UTF-16の回帰テストを追加
- [x] 代表診断とStorageMode射影の回帰テストを追加
- [ ] フル `bun run lint/test/build/build:pages`（実行環境で要確認）
- [ ] 実ブラウザでの `Intl.Segmenter` 差異とWorker応答を測定
- [ ] 実データに近い独立Holdoutで精度計測

AP-02のPack Resolver追加時はこのGold、プライバシー境界、既存Rule ID/Severityを比較対象とする。
