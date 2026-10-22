# AP-02 — Analysis Pack / Provider manifests and deterministic resolver

## Scope and present behavior

This PR introduces an opt-in **metadata-only** subsystem:
- `src/core/analysis/contracts.ts`: namespaced Pack, Rule, Provider and
  resolution contracts. Does not change the existing synchronous `RuleProvider`.
- `src/core/analysis/packs.ts`: a reviewed static **primary owner** table for
  every existing builtin/textlint rule. A stale or missing Rule ID fails on
  catalog construction rather than silently assigning a default owner.
- `src/core/analysis/resolver.ts`: side-effect-free catalog registration and
  deterministic resolution.

The existing Fast/Deep/Idle engine, Worker, Rule IDs, Diagnostic source,
Formatter, presets, RuleProfiles, AppConfig v1, and IndexedDB are unchanged.
Nothing automatically downloads dictionaries, initializes WASM or starts NLP.
AP-03 must handle profile migration before any pack can influence diagnostics.

## Deterministic gate order

The resolver validates **all** manifests on construction: duplicate/invalid
pack and provider IDs, unknown/duplicate rule IDs, exactly one primary owner,
missing or cyclic pack dependencies, missing providers, unsupported capabilities,
and NLP rules claiming Safe Fix. It rejects these even for disabled packs.

`core` is effectively enabled unconditionally; enabled required packs and
their dependency closure are computed without writing back to a profile.

Per-rule resolution is sorted by Rule ID and stops at the first failed gate:

1. owning Pack disabled
2. individual Rule explicitly disabled
3. unsupported document type
4. NLP consent missing
5. NLP selected provider unavailable or morphology Pack disabled
6. NLP runtime explicitly failed
7. NLP provider not Ready
8. declared static assets not Ready
9. required runtime capability absent
10. runnable

For existing synchronous RuleProviders, current readiness is not dependent on
the NLP runtime. These are **declarative** results only; they do not override
current Rule or Formatter implementations.

## Review decisions and alternatives

- **Chosen:** an independent pure resolver and explicit static ownership table.
  Pros: small blast radius, easy regression testing, no storage migration.
- **Rejected now:** replacing the existing Rule registry/engine in the same PR.
  Risks breaking suppression identity, three-tier scheduling and formatter.
- **Deferred:** persisted profile v2 and runtime provider lifecycle (AP-03/10),
  including service-specific provider failure states and asset installation.

The six Pack IDs are `core`, `grammar`, `dictionary`, `morphology`,
`technical`, and `style`. Neither `morphology` nor `technical`
claims legacy rules at this stage. Existing baseline rules accept both text
and Markdown in this **metadata snapshot**, matching the current engine's
legacy execution policy. Specific Markdown-only filtering is a later,
explicit compatibility-tested change.

## Verification

Run the existing `bun run lint`, `bun run test`,
`bun run bench:smoke`, `bun run build`, and `bun run build:pages`.
No new workflow is added. `tests/analysis/pack-resolver.test.ts` detects:

- Missing/duplicate/overlapping Rule IDs;
- Duplicate providers, cyclic and unknown Pack dependencies;
- NLP Safe Fix and undeclared capability assertions;
- Pack and Rule disable precedence and consent-before-readiness;
- Ready/failed provider, missing asset and runtime capability handling;
- UTF-16-friendly legacy diagnostic parity, since resolver never mutates
  the RuleRegistry or serialized text.

## Future work

1. AP-03: persist Pack options per RuleProfile with v1 migration, preserving
   all existing Rule settings and Private Session boundaries.
2. AP-09/AP-10: NLP token offsets, coordinator readiness and worker
   cancellation that actually drive `readyProviderIds`.
3. Enable runtime gating only after dual-running baseline diagnostics with
   a fixed Gold Corpus and reviewing compatibility.
