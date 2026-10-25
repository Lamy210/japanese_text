# AP-11b-1 — Lindera IPADIC ZIP構造検証（展開・実行は未対応）

> **状態:** 正規ZIP構造の検証を行う安全ゲート。Lindera-WASMやIPADICの実アセットは未組込。辞書の内部バイナリ形式やCRC/Deflate展開結果の検証は **まだ実施しない**。

## 公式配布物の調査（2026-10-26）

- Lindera公式Release [v6.2.0](https://github.com/lindera/lindera/releases/tag/v6.2.0)、2026-09-26公開。
- `lindera-ipadic-6.2.0.zip`、リリースAPIによるサイズ **10,519,550 bytes**、GitHub公開SHA-256 **`5ed4bba6b429030b0387df67d40d5751d35dedef0306f4bac6d957cad5f04b72`**。
- Lindera公式 [WASM/OPFS](https://lindera.github.io/lindera/ja/lindera-wasm/opfs.html) は `metadata.json`、`dict.trie`、`dict.valsidx`、`dict.vals`、`dict.wordsidx`、`dict.words`、`matrix.mtx`、`char_def.bin`、`unk.bin` の9ファイルを要求する。
- Linderaコード本体はMIT。**IPADIC辞書そのものは別ライセンス**なので、上流の出典・帰属表示・再配布条件を実物で照合するまで `licenseReview:'approved'` は登録しない。
- リリースサイズ/公開SHAだけでは「悪意のないアセット」「対応するWASM」「正当な再配布」を証明しない。現行 `NlpArchiveSpec` の `approved` フラグを推測で付けない。

## 実装

`src/core/nlp/ipadic-zip-inspector.ts` の `inspectIpadicZip(bytes)` は **オフライン**でZIPの中央ディレクトリを検査する。コール元は先に `readVerifiedNlpArchive()` によるSHA-256を通したバイト列だけを渡す。`inspectVerifiedIpadicArchive()` はOPFS再検証から構造検査までをまとめるが、Tokenizerを起動しない。

- 9ファイルがそれぞれ正確に1つ。ファイルはroot直下または単一の共通1階層ディレクトリ配下。rootディレクトリエントリはあってもよいが、他の余剰ファイル・ディレクトリは禁止。
- `..`、絶対パス、Windowsドライブ風、バックスラッシュ、非ASCII制御バイト、混在ルート、重複ファイルを拒否。
- EOCD/中央ディレクトリとローカルヘッダーの一致を確認。マルチディスク、ZIP64、暗号化、symlink/デバイス、未知の圧縮方式、破損したextra fieldを拒否。
- ZIPファイル最大64MiB、1エントリの申告展開後サイズ最大128MiB、合計最大256MiB、申告圧縮率最大512倍。
- ローカルデータ位置がディレクトリ領域を越えないことと、物理範囲が互いに重ならないことを検証。
- `IpadicZipIndex` は9個のファイル名・格納位置・CRC/サイズ/圧縮方式の **記述情報**。署名・認証済みの解凍内容とはみなさない。

## 設計上の制約・未完了

**ZIPのヘッダーだけを信用しての展開は厳禁。** 次PRでZIPの実展開を行うときは、実際の出力byte数をインクリメンタルに上限監視し、Deflate/CRC-32、辞書バイナリの形式・メタデータ整合性を確認する。現時点ではそれを保証しない。

GitHub Releaseにあるv6.2.0 ZIP実物はこの環境で取得できず、今回のテストは **保存形式を模した合成ZIP** に対するもの。公式配布物の完全解析に成功したという主張はしない。実物を配布する前にアーカイブ内容とライセンスを受入検証する。

既存のFast/Deep/Idle、Formatter、独立NLP Workerのfail-closed仕様、Private Session、CI設定、package.json/bun.lock、IndexedDB schemaは変更しない。

## テストゲート

Vitestで正常な9ファイル、任意の共通prefix、重複・欠落、ディレクトリ不一致、パス攻撃、ローカルと中央の名前/サイズ不一致、ZIP64/symlink/暗号化、高圧縮比、不正EOCD/中央offsetを再現。未対応形式を安全側に拒否する。

後続AP-11b-2: verified release pinとライセンス/NOTICEの監査、実ZIPに対するZIP構造・Deflate・CRC検証、WASM側辞書初期化を別PRで導入する。既存CI成功とレビューをマージ条件とする。