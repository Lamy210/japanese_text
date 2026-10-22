# Phase 5E — 冗長な重言表現の情報レベルのレビュー

## 背景

`wording/redundancy` では動詞・表記の重複、`wording/nominalized-action`
では「確認を実施する」型の回りくどい表現を取り扱っている。
今回はこれらとは異なる**意味が重複し得る固定表現**を限定的に扱う。

## v1の対象

- まず最初に → まず
- あらかじめ事前に → 事前に
- 一番最初に → 最初に
- 今現在 → 現在
- 各々それぞれ → それぞれ

「まず最初に」や「今現在」などには強調としての意図があり得る。
そのため全件 `info` / `fixKind: none` とする。
診断は文法の誤りと断定せず、改善候補を説明文だけに記載する。
Safe FixもQuick Fixも絶対に出さない。

## 誤検知防止とルールの整合性

- 表記を限定した直接一致で、曖昧な類義語一般には拡張しない。
- 正常な「まず」「最初に」「事前に」「現在」「それぞれ」は警告しない。
- 引用（「」・『』）、Markdown code/URL/comment、blockquoteを除外。
- UTF-16の文字位置を保持する。
- 既存の `wording/redundancy` や `wording/nominalized-action` とは
  別のルールとして個別有効化可能。診断の意味が異なる。
- 現時点でさらに複雑な同義表現を自動で合成・削除しない。

## 検証

Vitestで正例・負例・マスク・emoji・複数出現・
formatter変更なし・RuleProviderとprofile設定を検証。
`japanese-quality-v2.json` に厳密位置goldを追加し、
評価基盤でルールごとのTP/FP/FNを報告する。

既存のBunベンチスモーク、型検査、全Vitest、Vite/Pages、
Workerアセット参照チェックがCIで成功することがマージ条件。

## 次の段階

- Phase F: 接続詞・段落構造など文書全体の構成支援
- Phase G: Workerの古いRevision処理・Context再利用・ブラウザ実測
- Phase H: 独立注釈の実文章評価と品質・性能ゲート

合成回帰コーパスの成功から現実世界での
日本語文章校正のPrecisionやRecallを保証しない。
