# AP-11b — 公式IPADIC辞書ZIPのオフライン受入検証

> **安全境界:** これは開発者が手動で取得したZIPをローカル検証するコマンドであり、アプリへの辞書配布・起動・ライセンス承認ではありません。

## 背景

AP-11a (#94) はOPFS辞書アーカイブの取得/検証、AP-11b (#95–#97) はZIP構造・実展開/CRC・Data Descriptor/ローカル領域の検証を実装した。しかし、それらのテストは合成ZIPを使用しており、**公式Lindera release ZIPの実物を検証する再現可能な手順がなかった**。公式辞書をアプリへ有効化する前に実物適合性を手元で確認できることが必要。

## 公式アセット候補（配布未承認）

- Upstream: https://github.com/lindera/lindera/releases/tag/v6.2.0
- Asset: `lindera-ipadic-6.2.0.zip`
- 公開サイズ: **10,519,550 bytes**
- GitHub Releases APIが公開するSHA-256: `5ed4bba6b429030b0387df67d40d5751d35dedef0306f4bac6d957cad5f04b72`
- Release発行日: 2026-09-26 UTC。
- `src/core/nlp/ipadic-release-acceptance.ts` の `LINDERA_IPADIC_V620_CANDIDATE` で**レビュー対象の候補を固定**し、`NlpArchiveSpec.licenseReview:'approved'` を設定しない。

## 操作方法

上流の公式ReleaseからZIPを手動取得して、プライベートな作業ディレクトリ内で次を実行する。コマンド自身はネットワークアクセスも辞書キャッシュ操作もしない。

```bash
bun ci
bun run dict:release:verify /absolute/path/lindera-ipadic-6.2.0.zip
```

検証は次の順でFail-Closed。

1. ローカルファイル存在・公開サイズチェック（不一致ならBunでアーカイブ全文を読み込む前に終了）。
2. **コピーした同一のバイト列**でSHA-256を検証（digest前後のTOCTOU的な入力変化を防止）。
3. `inspectIpadicZip()` により必須9ファイル・ZIPフラグ・パス・中央/ローカルヘッダー・Data Descriptor・領域・申告展開サイズを検証。
4. `extractIpadicZipContents()` によりStored/Deflateを復元し、実展開バイト数・CRC-32・Lindera v6 `format_version: 2` のメタデータを検証。
5. 各辞書ファイルの**名前とサイズだけ**をJSONで報告。生の辞書・テキスト・パスは標準出力へ出さず、ディスクにも書き込まない。

終了コード: `0`=アーカイブの技術的受入成功、`1`=サイズ・ハッシュ・ZIP・CRC・辞書形式の不一致、`2`=引数・ファイルの読み込みに失敗。成功しても `licenseReview:'pending'` を報告。

## 設計判断と代替案

- **採用:** 配布物を含めない純粋な検証関数＋Bun CLI。辞書ライセンス未確定の間はCIやWebサイトへ10.5MBの辞書を持ち込まず、端末で明示実行する。
- **不採用:** ZIPをGitHub Actionsの毎回のテストで自動ダウンロード。外部ネットワーク依存と配布ライセンス・CI予算の負担が増す。
- **不採用:** GitHub Releases上のサイズ・SHAだけで実装を『辞書互換』と承認。実ZIP構造の適合性やWASMロードは保証できない。

## Tests / 非目標

合成9ファイルZIPで成功、改ざんSHA、サイズ、改ざんZIPを独立再ピンしたCRC不一致、旧辞書形式、壊れたZIP、異常なリリースタグ、キャンセル、非同期処理中の入力変更を検証する。これらのテストは実ZIPの適合性を証明しない。

**未完了:** この作業環境からGitHubの大容量Release ZIP実体は取得できなかったため、v6.2.0 ZIPでのCLI成功実績はない。ユーザー自身の端末などで実体を取得してからの初回受入試験が必要。

**未完了:** IPADIC辞書の出典・再配布条件/NOTICEの法的レビュー、WASMパッケージバージョンとのAPI/辞書互換性、Chrome/Firefox/Safariの実行・メモリ計測。Lindera v7系が存在するため、v6.2.0辞書を無条件に最新WASMへ接続しない。

変更しないもの: 現行Fast/Deep/Idle、Formatter、NLP Worker fail-closed仕様、既存OPFS保存形式、CIワークフロー、bun.lock、ローカルユーザー本文の取扱い。

## 次の開発

1. 実IPADIC v6.2.0 ZIPの手動受入結果を取得し、もし失敗すればZIP形式上の根拠とともにインスペクタを調整。
2. IPADICの正確なライセンス・帰属表示・再配布条件を別途確認。
3. バージョンを揃えたLindera WASM Adapterをfeature-gatedでWorkerに接続し、AP-09のトークン原文位置検証へ。
4. ブラウザごとの性能・メモリ・障害隔離と誤検知率を測定してから既定ON/OFFを判断。