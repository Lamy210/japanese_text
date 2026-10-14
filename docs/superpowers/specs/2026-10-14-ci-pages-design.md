# CI / GitHub Pages Design

## Goal

`Lamy210/japanese_text` の既存ブラウザ完結型日本語文章 Linter / Formatter を、再現可能な CI で継続検証し、`main` の成果物を GitHub Pages に公開する。

## Existing constraints

- アプリは frontend-only。Backend / API / DB / 認証 / LLM を追加しない。
- 既存構成は SolidJS + TypeScript + Vite + CodeMirror 6 + Web Worker + textlint。
- `bun.lock` を正とし、パッケージマネージャーは Bun を使用する。
- 現在の品質ゲートは `tsc --noEmit`、Vitest、`vite build`。
- GitHub Pages の project site URL は `https://lamy210.github.io/japanese_text/` を前提とする。

## Chosen approach

### CI

Pull request と `main` への push で GitHub Actions を実行する。

1. checkout
2. Bun setup
3. `bun ci`
4. `bun run lint`
5. `bun run test`
6. `bun run build`

CI は read-only 権限 (`contents: read`) を基本とし、アプリのビルドに不要な write 権限を与えない。

### Pages deployment

GitHub 公式 Pages Actions を使用する。

- `actions/configure-pages`
- `actions/upload-pages-artifact`
- `actions/deploy-pages`

`main` への push と手動実行 (`workflow_dispatch`) を deployment trigger とする。build と deploy を分離し、deploy は build 成功後のみ実行する。

Vite の `base` は環境変数から切り替える。

- local / ordinary build: `/`
- GitHub Pages build: `/japanese_text/`

これによりローカル開発を壊さず project-site 配下の asset / worker URL を正しく生成する。

## Reproducibility

`package.json` に Bun の `packageManager` バージョンを固定する。GitHub Actions は同バージョンを読み、`bun ci` で lockfile と manifest の不整合を失敗扱いにする。

## Repository hygiene

frontend-only アプリに不要な追跡済み `.env` (`DATABASE_URL=...`) を削除する。`.env*` は既に `.gitignore` 対象であるため、今後は commit しない。

`dist/` は今回の deployment source に使用せず、Pages artifact は CI が毎回生成する。既存追跡済み `dist/` の履歴整理は別変更に分離し、今回の CI/CD 導入の差分を小さく保つ。

## Failure modes

- lockfile 不整合: `bun ci` で fail。
- TypeScript error: `bun run lint` で fail。
- regression: Vitest で fail。
- production build failure: deploy 前に fail。
- incorrect Pages asset path: Pages build 時の Vite `base` を `/japanese_text/` に固定して防止。
- Pages 未有効化: deployment workflow は失敗するため、Repository Settings > Pages > Source を GitHub Actions に一度だけ設定する。

## Acceptance criteria

- PR 上で CI workflow が起動し、install / typecheck / test / build が成功する。
- `main` への merge 後に Pages workflow が build artifact を生成する。
- Pages が有効なら `https://lamy210.github.io/japanese_text/` でアプリが表示される。
- local `bun run build` は root base のまま利用できる。
- `.env` は repository の最新 tree から削除される。
