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
- 文体混在・冗長表現・曖昧表現の検出
- Markdown 見出し/参照チェック
- 数値・比較・外部事実に対する引用不足のヒューリスティック検出
- Safe Fix のみを適用する Formatter
- Quick Fix / Diagnostics
- プリセットと設定 Import / Export
- Web Worker による解析
- local-first storage
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

Backend、Database、認証、LLM API は使用しません。

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
