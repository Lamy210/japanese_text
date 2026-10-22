# Phase 5C — 限定的な依頼敬語と引用中の二重敬語の誤検知対策

## 適用範囲

新規ルール `wording/honorific-request` は、以下の
**6個の明示的な語形にのみ**情報レベルの改善案を出す。

- ご確認してください → ご確認ください
- ご連絡してください → ご連絡ください
- ご検討してください → ご検討ください
- ご回答してください → ご回答ください
- ご提出してください → ご提出ください
- ご参照してください → ご参照ください

同じ依頼であっても相手・主体・職務関係で丁寧さが変わる。
したがってこのルールの `fixKind` は必ず `none` とする。
Candidate は説明文のみに表示し、置換文字列を出力しない。

一般・技術プロフィールでは `info`、
Strictでは `warning`、Minimalでは未適用。
既存のRuleProvider・RuleProfileを再利用し、設定・移行は不要。

## 偽陽性・言語的境界

1. 「ご確認ください」「確認してください」「ご確認をお願いします」
   などは警告しない。
2. 説明・会話例として引用される「」/『』の内容は
   執筆者の依頼文とみなさず警告しない。
3. Markdownのコード・URL・HTMLコメントなどは既存マスクを使用。
4. Markdown blockquoteも外部引用の可能性があるため対象から除外。
5. UTF-16の文字位置はマスク処理で保持し、絵文字の後でも一致する。
6. 長い助詞接続・変則的な敬語・主語の推測はこの段階では対象外。

従来の `wording/double-honorific` にも引用・blockquote除外を
適用する。文化庁「敬語の指針」では、「お読みになられる」など
同種の敬語の重ね使いと、「お読みになっていらっしゃる」のような
敬語連結は区別される。判定辞書の対象を不用意に広げない。

## 参考

- 文化庁・敬語の指針「依頼の仕方」
  https://www.bunka.go.jp/seisaku/kokugo_nihongo/kokugo_shisaku/keigo/chapter3/detail.html
- 文化庁・敬語の指針「間違いやすい敬語」
  https://www.bunka.go.jp/seisaku/kokugo_nihongo/kokugo_shisaku/keigo/chapter4/detail.html

これらは敬語一般の選択に関する参考資料であり、
上記6つの語句それぞれを文化庁が「間違い」と列挙したと
主張するものではない。

## テスト・品質ゲート

- 6形のPositive、近似する正しい表現のNegative
- 引用・CodeFence・URL・blockquote・コメントの除外
- Emoji後のUTF-16 offsetと複数診断
- 非自動修正・RuleRegistry・Presets・Worker tier
- `japanese-quality-v2.json` へ独立goldアノテーションを追加
- 全Vitest、TypeScript、Bunスモーク、Vite/Pages、asset check

**非目標**：形態素解析、文脈理解、意味・敬意の自動決定、
あらゆる依頼敬語の完全網羅。
