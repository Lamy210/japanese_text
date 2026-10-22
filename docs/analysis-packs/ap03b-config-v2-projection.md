# AP-03b — AppConfig v2 Import/Export と Profile解析設定の投影

> 基準: AP-03a #70 (`aba4b861404965773917e08985da32a6dd127a27`)
> スコープ: **設定移行と保存のみ**。実際のLintのPack ON/OFF制御やUIは未実装。
> API: `AppConfig.analysis` は既存 `RuleProfile.analysis` と同じ `ProfileAnalysisSettingsV2` を使用。

## Why

AP-03aは任意の `RuleProfile.analysis` をMemory/IndexedDB v2へ安全に保存可能にしたが、`AppConfig` v1のImport/Exportからは参照できなかった。既存Profile metadataを別名で再定義せず、既存`ProfileAnalysisSettingsV2`の検証・clone契約を使う。

## 互換性

1. `CONFIG_SCHEMA_VERSION = 2`。v1 importは`analysis`未設定として`defaultProfileAnalysisSettings()`で補完する。既存`rules`のenabled/severity/optionsは変更しない。
2. 既存の`RuleProfile.analysis`が無い場合、`composeAppConfig`は読み取り用のデフォルトを返し、読込時に元Profileを変更しない。
3. 保存するときは`validateProfileAnalysisSettings(config.analysis)`で厳格に検証し、`RuleProfile.analysis`へコピーする。未知のキー、URL、任意の辞書本文は拒否する。
4. `Workspace.storageMode`を正本として扱い、通常の`AppConfig.privacy`変更は保存モードを変えない。IndexedDB DB_VERSION=2は維持する。
5. `core`はtrueへ正規化、形態素解析はOFFが初期値、辞書アセットのネットワークダウンロードは追加しない。
6. v2のImport/Exportで`morphology`と`dictionaries`の値を欠落させずに保持する。

## Change impact

- `src/core/config/schema.ts` — AppConfig v2に`analysis`を追加
- `src/core/config/validate.ts` — v1受入、v2正規化、厳格なanalysis検証
- `src/storage/compat/app-config-projection.ts` — Profile分析設定の双方向投影
- `tests/analysis/ap03b-app-config-v2.test.ts` — v1移行、v2 roundtrip、悪意ある値、Memory/IDB v2、Privacy、Profile切替

既存の`RuleProvider`、Fast/Deep/Idle、Formatter、現行の解析結果、CIワークフローは変更しない。

## Deferred

AP-03c: 既存Worker解析経路へResolverのPack gateを接続し、Revision切替・Profile/Workspace切替時にstale結果を破棄する。設定UIはその動作を検証してから追加する。現段階の`analysis`フラグは保存されるメタデータであり、Lint停止機能の提供を意味しない。

## Merge criteria

GitHub Actionsのtypecheck / dict:check / Vitest / bench:smoke / build / build:pagesが全て成功し、レビューブロッカーなし。CIを増やさない。
