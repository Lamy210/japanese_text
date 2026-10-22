# AP-02 — Analysis Pack / Provider Metadata and Resolver

Status: implementation PR (not yet user-facing). Baseline: `7994a0692c9dc87dd27014a4f5125d96c5a01c35`.

## Scope and decision record

- Six Pack IDs: `core`, `grammar`, `dictionary`, `morphology`, `technical`, `style`.
- **Pack** is the primary ownership/selection unit; **Rule** retains the current `namespace/id`; **Provider** describes potential capability but is not necessarily ready.
- Existing `RuleProvider.createRules(config)`, `CoreRule.run()`, 3 tiers, textlint Deep adapter, Formatter Baseline/Shadow and configuration schema v1 are untouched.
- `src/core/analysis/contracts.ts`: data-only contracts. `packs.ts`: one-to-one mapping of all 43 existing rules and two *existing* Provider descriptors. `resolver.ts`: validated, side-effect-free resolution.
- `src/core/rules/registry.ts` retains responsibility for executable rules. `createDefaultAnalysisCatalog(listRuleManifests())` is used for explicit metadata construction; the lint hot path does not call the resolver yet.
- Existing `reference/*` and `markdown/*` are `core` (infrastructure even for nontechnical documents); `evidence/*` is `technical`. `style/mixed-tone` and `style/cross-paragraph-tone` are classified `grammar`, with existing Rule IDs intact.
- No arbitrary JavaScript execution, external plugin import, storage change, network request, automatic dictionary download, or worker creation is introduced.

## Resolution precedence

1. **Validate**: exact six Pack IDs; `core` mandatory; unique Pack / Provider / Rule IDs; dependency existence and cycle detection; registered Providers; capability compatibility.
2. Normalize `core` to ON regardless of `input.packEnabled.core` (no user disable).
3. For each rule, in ID order: Pack+dependency enabled → individual rule enabled → document type supported → NLP consent → morphology Pack enabled → NLP Provider selected → Provider ready → assets ready → capabilities actually present.
4. Return `runnable` or `skipped(reason)`. Missing Provider/assets/capability is **never represented as no diagnostics**.
5. Pack toggles must not mutate `AppConfig.rules` or `RuleProfile`. AP-03 adds persistence and user-facing selection.

Provider descriptor capabilities are **declarations**, not proof of readiness. The runtime must supply ready Provider IDs, actually enabled capabilities and installed asset IDs separately.

## Compatibility with existing versions

- AppConfig remains **v1**, IndexedDB remains **v2**. No migration in AP-02.
- Metadata defaults keep existing Pack ownership enabled except `morphology`. Even if a Pack were disabled in a future UI, v1 rules continue to execute as before until AP-03 integrates the resolver with settings safely.
- The existing three `textlint` rules remain assigned to `textlint` and run through the existing Deep adapter.
- Existing rule IDs, severity, individual enabled flags, source, position and fixKind are unchanged.

## Rejected alternatives

- **Change `RuleManifest` to require `packId` now:** forces an unnecessary breaking change across existing providers; retained additive sidecar metadata instead.
- **Make Pack toggles filter `buildRuleRegistry` immediately:** risks v1 Profile and diagnostic regressions; defer to AP-03 migration and dedicated consistency tests.
- **Advertise Lindera/kuromojin as default ready Providers:** would conflate an experimental adapter with installed/supported assets and consent; no NLP Provider registration until the Adapter PRs.

## Tests and exit criteria

`tests/analysis/pack-resolver.test.ts` detects:

- Catalog drift if any existing builtin or textlint rule is missing or duplicated.
- Preservation of v1 Rule enabled settings and deterministic ordering.
- Mandatory core, optional Pack gating, and nonmutation of saved rule settings.
- Separate `rule-disabled` vs `provider-not-ready` vs `pack-disabled` states.
- Unknown Pack, duplicate Pack/Provider, missing dependency, cyclic dependency, unsupported capability.
- Synthetic future NLP rule cannot run without consent, morphology enablement, ready Provider, assets and runtime POS capability. Unmatched document types are explicitly skipped.

Local verification must run `bun run lint`, `bun run test`, `bun run build`, `bun run build:pages`, and `bun run dict:check` using the existing scripts. CI workflows are not modified. **Do not merge if required checks or adequate test verification are missing.**
