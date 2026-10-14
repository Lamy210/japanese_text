# CI / GitHub Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `japanese_text` に再現可能な GitHub Actions CI と GitHub Pages deployment を追加し、公開可能な状態にする。

**Architecture:** 既存 Bun/Vite アプリは変更を最小限に保つ。通常ビルドと Pages ビルドを scripts で分離し、CI と deployment を別 workflow にする。Pages は GitHub 公式 Actions の artifact deployment を使用する。

**Tech Stack:** Bun 1.4.3, SolidJS, TypeScript, Vite, Vitest, GitHub Actions, GitHub Pages

**Spec:** `docs/superpowers/specs/2026-10-14-ci-pages-design.md`

## Global Constraints

- frontend-only を維持し、Backend / API / DB / LLM を追加しない。
- `bun.lock` を正とし `bun ci` を使用する。
- 通常の `bun run build` は root base `/` を維持する。
- Pages 用 build だけ `/japanese_text/` base を使用する。
- CI は least privilege (`contents: read`) を基本にする。
- deploy 権限 (`pages: write`, `id-token: write`) は deploy job のみに与える。

## Review Focus

- lockfile と `package.json` が不整合なら install が失敗すること。
- 既存 125 tests が CI 上でも通ること。
- Pages build の `dist/index.html` が `/japanese_text/` 配下 asset を参照すること。
- Web Worker chunk も Pages 配下から読み込める build になること。
- Pages 未有効化時は production deploy だけが明確に失敗し、CI は独立して成功できること。

---

### Task 1: Reproducible Bun toolchain and Pages build

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: existing `bun.lock`, existing Vite build.
- Produces: `packageManager=bun@1.4.3`, `build:pages` script.

- [ ] Add `"packageManager": "bun@1.4.3"`.
- [ ] Add `"build:pages": "vite build --base=/japanese_text/"` without changing ordinary `build`.
- [ ] Verify dependency installation with `bun ci`.
- [ ] Verify `bun run lint`, `bun run test`, `bun run build`, and `bun run build:pages`.
- [ ] Verify Pages output references `/japanese_text/` from `dist/index.html`.

### Task 2: CI quality gate

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: Task 1 package scripts.
- Produces: PR/main quality gate.

- [ ] Trigger on pull requests, pushes to `main`, and manual dispatch.
- [ ] Use `actions/checkout@v7` and `oven-sh/setup-bun@v2`.
- [ ] Run `bun ci`.
- [ ] Run `bun run lint`, `bun run test`, `bun run build` as separate named steps.
- [ ] Use `contents: read`, concurrency cancellation, and a finite timeout.

### Task 3: GitHub Pages deployment

**Files:**
- Create: `.github/workflows/pages.yml`

**Interfaces:**
- Consumes: Task 1 `build:pages` script.
- Produces: GitHub Pages artifact and deployment from `main`.

- [ ] Trigger on push to `main` and manual dispatch.
- [ ] Build job: checkout, setup Bun, `bun ci`, lint, test, `bun run build:pages`.
- [ ] Configure Pages with `actions/configure-pages@v6`.
- [ ] Upload `dist` with `actions/upload-pages-artifact@v5`.
- [ ] Deploy in a dependent `deploy` job with `actions/deploy-pages@v5`.
- [ ] Use `github-pages` environment and expose `page_url`.
- [ ] Restrict deploy permissions to `pages: write` and `id-token: write`.

### Task 4: Repository hygiene and documentation

**Files:**
- Delete: `.env`
- Create: `README.md`

**Interfaces:**
- Consumes: existing application behavior and new CI/Pages workflows.
- Produces: clean public repository entry point and local/deploy instructions.

- [ ] Remove tracked `.env`; keep `.env*` ignored.
- [ ] Document purpose, privacy/no-LLM constraint, local commands, test/build commands, and Pages URL.
- [ ] Document the one-time Settings > Pages > Source = GitHub Actions requirement.

### Task 5: Remote verification

**Files:** none

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: verified PR and workflow evidence.

- [ ] Open a PR from `feat/ci-github-pages` to `main`.
- [ ] Inspect CI workflow run and job logs.
- [ ] Fix any CI failure on the feature branch and rerun until green.
- [ ] Merge only after CI is green and the branch diff matches this plan.
- [ ] Inspect the Pages workflow on `main`.
- [ ] If Pages is enabled, verify successful deployment URL. If not, report the exact one-time repository setting required and keep the workflow ready to rerun.
