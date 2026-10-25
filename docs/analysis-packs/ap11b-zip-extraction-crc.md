# AP-11b-2 — IPADIC ZIP実展開のサイズ・CRC-32・辞書形式ゲート

> **完成範囲:** SHA-256検証済みZIPをメモリ上で展開し、出力を検証する独立ユーティリティ。Lindera WASM初期化、辞書の配布、ライセンス承認、ユーザー向け形態素解析はまだ行わない。

## 現状

前段のAP-11aは同一オリジンからのZIPダウンロード・OPFSへの段階的保存・SHA-256再検証を実装。AP-11b-1 (#95) はZIPの内部エントリ9種と中央/ローカルヘッダー、危険なファイル名・展開申告サイズを検証した。しかし**展開済みの実バイト数とCRCは未検証**だった。

## 今回の判断と実装

- `src/core/nlp/ipadic-zip-extractor.ts` の `extractIpadicZipContents()` は、最初に `inspectIpadicZip()` を通す。正しい9ファイルが全て揃うまで戻り値にファイルを公開しない（失敗は `invalid`）。
- ZIP Stored (method 0) は元のバイト配列をコピーしてCRC-32を照合する。DEFLATE (method 8) は標準Web API `DecompressionStream('deflate-raw')` を使用し**流れてきたchunkごとに実出力byte数を確認してから保持**し、CRC-32を逐次計算する。
- データの実出力が申告サイズと異なる、CRC不一致、圧縮形式が非対応、展開失敗、途中キャンセル、ZIPインデックス不正なら辞書全体を拒否する。
- 1ファイル最大128MiB、9ファイル合計最大256MiB、元ZIPはAP-11b-1の64MiB上限。ZIPに書かれたサイズだけではなく、**出力実サイズにも同じ上限**を適用する。許可しない形式や復元不可能な環境はFail Closed。
- `metadata.json` は厳密UTF-8 JSONで最大64KiB、Lindera v6の `format_version === 2` を要求する。旧v5形式や壊れたmetadataは拒否。文法的JSON以外の辞書バイナリの内部整合性を独自に解釈せず、次段の公式Linderaローダに任せる。
- `extractVerifiedIpadicArchive(spec, options)` は必ず既存 `readVerifiedNlpArchive()` でOPFSからSHA再検証してから上記処理を行う。ZIPエントリをOPFSへ勝手に保存しない。辞書や本文をネットワーク送信しない。

## 採用根拠

- Lindera公式移行ガイド: https://lindera.github.io/lindera/ja/migration_v5_to_v6.html （v6の辞書形式version 2および9ファイルの列挙）。
- MDN: https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream/DecompressionStream （Web Workersでの `deflate-raw` に対応、非対応環境はエラー）。
- 追加npmライブラリを導入しないため、既存のbun.lock/package.jsonおよびブラウザへの常駐バンドル負担は変更しない。

## 安全性と互換性

- ZIP内部のパスは前段で限定済みであり、実装はファイルシステムに直接展開しない。シンボリックリンクや未知のファイルを作成する経路はない。
- ここまでの検証は**信頼できるバイナリを保証するものではない**。Linderaによる辞書バイナリ検証、WASMのロード、IPADICの再配布ライセンス/NOTICE、実物ZIPに対する受入試験とブラウザ別性能は未完了。
- `readVerifiedNlpArchive` が要求するレビュー済みアセットSpecは未登録。公式v6.2.0のSHAだけで `licenseReview:'approved'` としない。
- 既存のFast/Deep/Idle Worker、Formatter、Private Session、IndexedDB schema、CI workflowを一切変更しない。解析結果の空配列成功への変換は禁止。

## 回帰テスト

- 合成ZIPのStoredとraw Deflateを実際に作成・展開し、9ファイルの正しい復元を確認。
- CRC-32不一致、圧縮本文破損、改ざんされた展開サイズ、古いformat_version、無効UTF-8、キャンセル、非ZIPデータを拒否。
- GitHub既存CI: TypeScript型チェック、全Vitest、dict:check、bench:smoke、通常/Pagesビルドで検証。CIの追加はしない。

## 次のPR

IPADIC公式ZIP実物での受入試験・再配布条件精査 → 依存を固定したLindera WASMローダ導入 → 初期化・原文UTF-16/品詞検証 → Firefox/Safari/Chrome性能とメモリ負荷計測。