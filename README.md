# Japanese Writing Toolkit

[![CI](https://github.com/Lamy210/japanese_text/actions/workflows/ci.yml/badge.svg)](https://github.com/Lamy210/japanese_text/actions/workflows/ci.yml)
[![GitHub Pages](https://github.com/Lamy210/japanese_text/actions/workflows/pages.yml/badge.svg)](https://github.com/Lamy210/japanese_text/actions/workflows/pages.yml)

日本語文章をコードのように静的解析する、**ブラウザ完結型・LLM不使用**の Linter / Formatter です。

文章・設定・解析結果を外部 API に送らず、解析はブラウザ内で実行します。

## Public site

GitHub Pages: <https://lamy210.github.io/japanese_text/>

> 初回公開時のみ、Repository Settings → Pages → Build and deployment → Source で **GitHub Actions** を選択する必要があります。

## Features

- CodeMirror 6 ベースの日本語/Markdownエディタ
- NGワード検出
- 用語統一
- 句読点・空白・括弧・全角/半角などの静的解析
- 文体混在（段落内・段落間）・冗長表現・曖昧表現の検出
- 「確認を実施する」「検討を行います」などの回りくどい名詞＋動詞表現を情報レベルで案内（時制を合わせた例示・自動置換なし）
- 助詞句の隣接重複（例:「について、について」）・文頭接続詞の連続反復を参考診断（自動置換なし）
- 異なる追加の接続詞が3文連続する場合に、文章の整理を促す情報レベルのガイド（自動置換なし）
- 1段落の完結文数が設定した目安を超える場合に、段落分割の検討を案内（自動置換なし）
- 日本語の代表的な誤表記（シュミレーション、コミニュケーションなど）をローカル辞書で検出し、確認可能な修正候補を表示
- Markdown 見出し/参照チェック
- 数値・比較・外部事実に対する引用不足のヒューリスティック検出
- Safe Fix のみを適用する Formatter
- Quick Fix / Diagnostics
- プリセットと設定 Import / Export
- Web Worker による解析
- local-first storage: Workspace別のPrivate Session / Local Library、複数文書、Snapshot / History / Restore
- Workspace内本文検索（最大50件、ローカル処理、未保存本文も検索対象）
- Light / Dark / System theme

## Tech stack

- SolidJS
- TypeScript
- Vite
- CodeMirror 6
- `@textlint/kernel`
- Vitest
- Bun
- GitHub Actions / GitHub Pages

Backend、サーバー側Database、認証、LLM API は使用しません。Local Libraryの本文と履歴だけをIndexedDBへ保存します。

## Document Library / 本文検索

左側の Documents で文書作成・選択・名前変更・削除ができます。**Search bodies** を押して本文検索モードに切り替え、キーワードを入力して Enter または Search を押してください。結果を選ぶと対象文書を開き、一致範囲が変更されていなければその位置へ移動します。検索対象は現在のWorkspaceの本文のみで、履歴の本文や他のWorkspaceは検索しません。

検索は明示実行の都度ブラウザ内で行い、検索語・検索結果を保存・送信しません。Private Sessionでは本文と履歴をメモリにのみ保持し、Local Libraryを明示的に有効化したWorkspaceだけがIndexedDBに保存されます。現在編集中の未保存本文も検索対象です。

## RuleProfiles

「ワークスペース管理」の **RuleProfiles** から、現在のルール設定を独立したProfileとして複製し、同じWorkspace内のProfileを切り替えられます。設定の切替対象は校正ルール・NGワード・用語統一・引用ポリシー・Formatterで、本文や履歴は複製しません。

旧Workspaceは従来の単一Profileのまま読み込めます。Profileの名前変更・削除は未実装です。**Workspaceを削除してもRuleProfileの設定レコードは互換性のため残ります**。NGワード等に個人情報を入力する場合は、この保持仕様に注意してください。

## Development

Bun 1.4.3 を使用します。

```bash
bun ci
bun run dev
```

Local URL:

```text
http://localhost:3000/
```

## Quality checks

```bash
bun run lint
bun run test
bun run build
```

GitHub Pages 用の production build は次です。

```bash
bun run build:pages
```

`build:pages` は Vite の base を `/japanese_text/` に設定します。通常の `bun run build` は `/` のままなので、GitHub Pages 以外の static hosting にも影響しません。

## CI

`.github/workflows/ci.yml` は Pull Request、`main` push、手動実行で次を検証します。

1. `bun ci`
2. TypeScript typecheck
3. Vitest
4. Vite production build
5. GitHub Pages production build
6. Pages 配下の asset / Web Worker path 検証

## GitHub Pages deployment

`.github/workflows/pages.yml` は `main` push または手動実行で次を行います。

1. dependency install
2. typecheck
3. test
4. Pages base で production build
5. Pages artifact upload
6. `github-pages` environment へ deploy

Deployment は GitHub 公式の `configure-pages` / `upload-pages-artifact` / `deploy-pages` Actions を使用します。

## Privacy

このプロジェクトの基本方針は **frontend-only / local-first / no LLM** です。入力文章を校正目的で外部サービスへ送信しません。
