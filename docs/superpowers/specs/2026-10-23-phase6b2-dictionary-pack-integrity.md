# Phase 6B-2 — Deterministic bundled dictionary assets

## Background

The Phase 6A eight-pair dictionary and Phase 6B-1 metadata manifest are
already part of `main`. This phase packages that reviewed data as immutable,
version-addressed static files **without switching the active detection rule**
to a remote/dynamic dictionary source.

## Files and format

- `src/core/dictionary/pack-codec.ts`: strict v1 validation, canonical
  serialization, byte-length and SHA-256 integrity checks.
- `scripts/generate-dictionary-packs.ts`: Bun-only generator and check mode.
- `public/dictionaries/curated-common-typo-ja/1.0.0/pack.json`: UTF-8,
  compact JSON with one trailing LF. Stable field and entry ordering.
- `public/dictionaries/curated-common-typo-ja/1.0.0/index.json`: relative
  asset filename (`pack.json`), exact UTF-8 byte length and lowercase
  SHA-256 digest. No timestamps and no runtime-generated randomness.

`pack.json` includes the already-validated first-party manifest:
`NOASSERTION` and `pending` mean redistribution licensing has **not**
been independently confirmed by this code. A matching SHA-256 digest ensures
byte consistency with the index but is **not a signature**; replacing both
files can defeat it. Future trust-sensitive external packs require a separately
authenticated index, allowlisted provenance and explicit reviewer approval.

The versioned asset is prepared for future opt-in loading; the current
`wording/common-typo` rule continues to use the reviewed bundled TypeScript
array so offline and existing users are unaffected.

## Development commands

```sh
bun run dict:generate    # write deterministic pack.json and index.json
bun run dict:check       # fail when checked-in bytes drift from reviewed source
bun run lint
bun run test
bun run build
bun run build:pages
```

Both CI and GitHub Pages build run `bun run dict:check` before publishing.
The generator never accesses network resources or reads private documents.

## Validation and safety

- Pack objects may contain only `schemaVersion`, `manifest`, and `entries`.
- Entries must be nonempty bounded strings, distinct from their correction,
  with unique erroneous spellings. The declared count must match actual count.
- Returned pack, entries, and manifest are cloned and frozen.
- Index is a strict object; only the literal file `pack.json` is allowed,
  rejecting traversal and arbitrary code or unexpected assets.
- Pack limit: 4 MiB for the initial bundled typo pack; at most 50,000 entries.
- Before decoding untrusted bytes: compare exact byte count and SHA-256 digest.
- Invalid UTF-8, malformed JSON and noncanonical serialized records are
  rejected. Index pack ID/version must match embedded manifest.
- Importantly, dictionary data is not executable JavaScript.

## Regression contract

- Existing eight pairs remain ordered and unchanged.
- No new source dependencies or runtime network calls.
- No change to diagnostics, user allowances, masks, `RuleProfile`,
  `AppConfig`, database schema or document storage.
- Existing Golden Corpus and Formatter tests remain required.
- Byte-for-byte fixture equality detects stale committed assets.
- This phase does not implement automatic dictionary upgrades.

## Next steps

**6B-3:** static, same-origin-only opt-in loader. Resolve the asset using an
explicit built-in registry; do not derive URLs from untrusted manifest fields.
Check redirect behavior, Content-Length cap, decode budget, AbortSignal,
checksum before parsing, cache policy and failure fallback in browsers.

**6B-4:** profile-scoped pack enablement, migration from AppConfig v1, Worker
generation gate and per-workspace preference handling.

**6C:** expand vocabularies after evidence, licensing and positive/negative
corpus review. A large corpus is not automatically safe to redistribute.
