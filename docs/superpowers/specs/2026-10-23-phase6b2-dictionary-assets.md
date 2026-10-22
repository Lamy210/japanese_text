# Phase 6B-2 — Reproducible reviewed typo assets and SHA-256 gate

## Changes

- `scripts/build-dictionary-assets.ts` serializes the 8-pair first-party dictionary
  in a deterministic UTF-8 JSON format with a trailing LF.
- `public/dictionaries/curated-common-typo-ja/1.0.0/entries.json` contains the
  static, code-free data artifact.
- `release.json` pins a SHA-256 hash, byte count, format and provenance manifest
  for that exact artifact.
- `src/core/dictionary/asset-integrity.ts` checks descriptor syntax, capped
  byte length, WebCrypto SHA-256, UTF-8 decoding, expected pack/version/count,
  and duplicate/malformed spellings, returning deeply frozen records.
- The existing typo matcher still uses `curated-typos.ts` directly. Fetching
  and hot-swapping external dictionaries is **not** introduced in this PR.

## Build and checks

```sh
bun run dictionaries:generate
bun run dictionaries:check
bun run lint
bun run test
bun run build
bun run build:pages
```

The checked-in artifacts are byte-for-byte identical to the generator output
as asserted by Vitest, so the existing CI tests also detect stale generated
assets without adding another GitHub Actions workflow.

The browser-facing verifier uses WebCrypto, not a Node hashing dependency.
When SHA-256 is unavailable, verification fails closed.

## Security model

- SHA-256 authenticates bytes **against the pinned descriptor**, not against
  a remote publisher. Tampering with both the asset and descriptor cannot be
  detected absent an independently trusted manifest/signature.
- The pack is static, inert JSON and has a strict 2 MiB maximum.
- Metadata `NOASSERTION/pending` remains unchanged; this does not imply
  external dictionary licenses have been reviewed.
- This code never sends user text, fetches remote URLs, or modifies Workspace,
  RuleProfile, AppConfig, IndexedDB, Worker protocol, or diagnostic sources.
- The package-specific asset format is deliberately limited to curated typos.
  It does not attempt to serialize Sudachi/UniDic native binary formats.

## Follow-up

Phase 6B-3: opt-in, origin-scoped static loader with integrity checks, graceful
fallback and cache/version lifecycle. Enablement settings and migrations belong
to a separate subsequent PR.
