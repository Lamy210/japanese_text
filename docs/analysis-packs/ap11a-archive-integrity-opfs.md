# AP-11a — Lindera IPADIC archive verification and OPFS staging

> **Stage 1 only.** No actual Lindera WASM package, IPADIC archive bytes, tokenizer, ZIP extractor, or user-facing download UI are shipped. This PR must not be described as working morphological analysis.

## Context / source verification

- Official Lindera documentation: https://lindera.github.io/lindera/ja/lindera-wasm/installation.html — WASM uses an external dictionary/OPFS pattern instead of requiring a large embedded dictionary.
- Browser OPFS API: https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system — `navigator.storage.getDirectory()`, `FileSystemDirectoryHandle` and `createWritable()`.
- AP-10 (#92, #93) already has an isolated, fail-closed NLP Worker with strict source/token output validation. The physical dictionary needs an equally conservative trust boundary.

## Accepted scope

New `src/core/nlp/archive-installer.ts` provides:

1. **Trusted build-time asset descriptor:** exact schema, Lindera-IPADIC provider, fixed asset ID + 3-component version, approved-license status, expected byte length (1 to 64 MiB), and lowercase 64-digit SHA-256. The descriptor must be checked into/reviewed with the application. **Do not** download a manifest from an unauthenticated remote server and treat its digest as trusted. An approved-license flag is metadata, not an independently verified legal determination.
2. **Same-origin only fetch:** URL constructed exclusively from trusted validated IDs, the Vite base path and the application's own HTTP(S) origin; never accept arbitrary URLs, cross-origin redirects or credentials. No import-time network access; `installVerifiedNlpArchive` must be invoked explicitly after appropriate consent.
3. **Bounded streaming download:** reject HTTP/redirect/content-length mismatch and overflow during body consumption; cancel stalled reads upon AbortSignal; digest exact bytes using browser WebCrypto. Do not attempt to unzip unsigned bytes.
4. **Cross-tab safety:** exclusive Web Lock keyed by provider/asset/version. If Web Locks or OPFS is unsupported, report `unavailable/storage` rather than risking races; tests inject a serializable lock and in-memory fake OPFS.
5. **Crash/rollback boundary:** write a `.partial` file, verify staged bytes, copy to a SHA-named archive, re-read and verify, then publish a SHA-named `.ready` marker LAST. Readiness requires marker and verified file content. Failed installs remove their new marker and temporary file, leaving other verified SHA/version archives intact.
6. **Read integrity:** `readVerifiedNlpArchive` rechecks size/SHA on every load; it never treats a marker alone as integrity proof. It returns bytes (not a file URL). No user-authored text is persisted.

## Usage boundary

Logical on-site path: `<Vite BASE_URL>/nlp-dictionaries/lindera-ipadic/<version>/<assetId>.zip`. **No such production archive has been published or pinned yet.** There is intentionally no default trusted IPADIC descriptor. The next PR must review the artifact license, version, release source, exact SHA-256, ZIP entry paths, ZIP bomb bounds, and Lindera-WASM parser before enabling actual download.

```ts
// Future app code only, after verified asset, explicit consent and license review:
// const result = await installVerifiedNlpArchive(CHECKED_IN_IPADIC_SPEC, { signal });
// if (result.status !== 'installed' && result.status !== 'already-installed') {
//   return { status: 'provider-unavailable' }
// }
// const verified = await readVerifiedNlpArchive(CHECKED_IN_IPADIC_SPEC)
// if (verified.status !== 'ready') return { status: 'provider-unavailable' }
// ZIP contents MUST undergo a separate bounded, path-safe extraction/format validation.
```

## Security considerations

- Downloaded bytes contain no private document/profile data; do not cache user-authored dictionaries here.
- The manifest is a **pin**, not a claim of authenticity from the downloaded service. SHA verifies equality to reviewed content, not source ownership. Use immutable reviewed releases and supply-chain checks in the next step.
- OPFS is origin-private but not equivalent to an encrypted secrets store. Directory/file availability varies in private browsing and under quota pressure.
- `.ready` publishing is a commit marker, not a filesystem-atomic rename. Reads and writes are guarded by the same Web Lock, so cooperating tabs do not observe incomplete writes. Browser crashes may leave unreachable partial/ZIP files; future GC may remove stale temporary files only under exclusive lock.
- The ZIP archive is opaque here; no `eval`, executable plugins, external Worker imports, or ZIP expansion. **A verified ZIP is not yet a valid Lindera dictionary.**
- Older verified versions remain available if a newly pinned version fails to download or stage. Quota management and explicit user delete/rollback UI are deferred.
- Failure is a structured `unavailable` outcome; never silently treat missing dictionary as a clean analysis.

## Testing

- Same-origin URL, credentials omitted, redirection denied, successful install/re-open and deduplicated second install.
- Two concurrent callers with serialized lock issue one fetch; no lock/OPFS => fail closed.
- Bad descriptor, unsafe path, content-length/digest mismatch, network error, aborted request.
- Failed marker write rolls back the new SHA while preserving a previously verified archive.
- Mutating a cached ZIP with an existing `.ready` marker fails verification; redownload repairs it.

## Follow-up / gating

AP-11b: pin a real redistributable IPADIC release, review licenses and compile a Lindera WASM adapter with path-safe/bounded ZIP validation; verify actual token geometry against AP-09 and compare baseline bundle size. Do not enable morphology by default before AP-12/13 provider comparison.

Required merge checks: existing Bun/TypeScript, Vitest, dictionary integrity, benchmark smoke, production and Pages builds. CI workflow and dependency files remain unchanged.