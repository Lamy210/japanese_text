# Phase 6B-3 — Opt-in, same-origin verified static dictionary loader

## Scope

Introduce a browser-safe reader for the **already published and version-pinned**
curated typo pack. This phase deliberately does **not** connect the loaded pack
to the active `wording/common-typo` rule and does not change AppConfig,
RuleProfile, IndexedDB, or any existing diagnostic.

## Contract

`loadBundledCuratedTypoPack(options)` returns either:

- `{ status: 'ready', pack }`: frozen validated pack that passed SHA-256 and
  canonical UTF-8 encoding checks; or
- `{ status: 'unavailable', reason }`: explicit degraded state, not an empty or
  silently accepted pack.

No network activity occurs on module import. Loading must be initiated
explicitly by a caller. The loader contains no document-text parameters and
never reads Local Library or Private Session data.

## Trust and origin controls

- Resolve only the built-in `curated-common-typo-ja@1.0.0` path against the
  Vite deployment base path (root or `/japanese_text/`).
- Reject malformed/traversal-like base paths and cross-origin URLs.
- Fetch `index.json` first; require pack ID and version to match the compiled
  curated dictionary manifest.
- Fetch `pack.json` next. Never derive an arbitrary asset path from index
  metadata. Require same-origin exact response URL, no redirects, HTTP 200.
- Set `credentials: omit`, `redirect: error`, `cache: force-cache` and
  propagate the supplied AbortSignal.
- Bound index to 16 KiB and pack to 4 MiB, including incremental stream reads.
  Reject oversized Content-Length, oversized streamed data, malformed JSON,
  invalid UTF-8 and checksum mismatches.
- Verify SHA-256 **before** parsing the pack data and verify that inner pack
  identity equals pinned index identity.
- Fetch errors and invalid assets return `unavailable`; the old in-memory
  built-in dictionary remains authoritative and available.

**SHA-256 is not a digital signature.** If an attacker can replace both the
index and asset on the same origin, this alone cannot authenticate the contents.
External dictionary packs require stronger source authentication and explicit
legal review before runtime support.

## Test coverage

Vitest uses a synthetic same-origin `location` and injected fetcher to test
path pinning, explicit opt-in, credential omission, redirect rejection,
offline/degraded behavior, aborts, tampered bytes and index size limits.
No external service is contacted.

## Follow-up

6B-4: RuleProfile opt-in, per-workspace pack settings, revision/pack generation
gates, analyzer lifecycle and immutable cache ownership. Only then consider
running diagnostics from loaded packs, initially by comparing outputs with
the existing eight-pair rule on a comprehensive golden corpus.
