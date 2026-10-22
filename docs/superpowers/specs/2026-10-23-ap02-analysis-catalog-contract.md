# AP-02 — Analysis Pack Metadata / Resolver Contract

## Purpose and baseline

Extends `main` after Phase 6B-3 without changing the synchronous
`RuleProvider`, existing `CoreRule.run()`, Fast/Deep/Idle scheduling, settings,
document storage, worker messages or user-visible diagnostics.

This is the metadata-only prerequisite for AP-03 (Config/RuleProfile v2)
from [Analysis Packs × NLP v5](./2026-10-23-analysis-packs-nlp-detailed-design-v5.md).

## Data ownership and compatibility

- `src/core/analysis/contracts.ts`: Pack/Rule/Provider descriptors v1.
- `src/core/analysis/packs.ts`: metadata bridge from the existing
  `listRuleManifests()` to Pack ownership. The three existing
  `wording/common-typo`, `wording/terminology`, `wording/ng-word`
  belong to the dictionary Pack; remaining legacy rules remain under required
  core Pack **for now**, pending reviewed ownership mapping.
- `src/core/analysis/resolver.ts`: pure registry validation and deterministic
  rule-ready/rule-skipped decisions. It **does not run a rule**, fetch a
  dictionary, instantiate a Worker, alter a Profile, or change an Ignore key.

Default Pack metadata enables core/dictionary, but has no effect on current
runtime until an explicit migration is delivered. Existing rules require
`ruleSettings` from AppConfig to be runnable; unknown rules default to disabled.

## Safety contracts

- `core` is required and normalized ON without mutating caller input.
- Duplicate provider, pack or rule IDs fail compilation.
- Every rule has exactly one owning Pack. Declaration and ownership must agree.
- Pack dependencies must exist and be acyclic.
- Provider execution context and document-type coverage must match its rule.
- Metadata is cloned and frozen on compilation.
- Skips carry an explicit reason, never a fabricated empty diagnostic result.
- Deterministic precedence: Pack availability → per-rule flag → document
  type → consent → chosen NLP provider → runtime failure/readiness → asset
  readiness → capability availability → runnable.
- `grammar` does **not** depend on `morphology`; only NLP execution gates on
  morphology being enabled.
- NLP cannot claim `fixKindCeiling: safe`. The legacy metadata ceiling
  describes an upper bound only and is **not** a license for auto-fix.
- `readyProviderIds` is intentionally distinct from provider choice. Merely
  selecting a provider does not claim its Worker or assets are ready.
- For now, only descriptors for existing builtin/textlint providers are
  registered in the compatibility catalog; the NLP test uses a fake Lindera
  descriptor without shipping or loading Lindera code.

## Regression tests

`tests/analysis/pack-resolver.test.ts` verifies:

- 100% parity of Rule IDs with `listRuleManifests()` (no renames).
- Pack OFF→ON preserves individual rule flags.
- Forced `core: false` cannot stop core rules.
- Duplicate IDs, circular/missing dependencies, mismatched providers and
  orphan rule declarations are rejected.
- Stable Rule ID sort order and identical output for identical input.
- NLP consent, provider selection, readiness, runtime failure, asset gating
  and capabilities report differentiated skip reasons.
- New NLP rules may not assert Safe Fix.

## Deferred and risks

- AP-03 will persist Pack flags and implement migration based on actual
  Profile/Workspace rules; it must preserve existing enabled Rule IDs.
- Pack ownership beyond the three clear dictionary rules needs domain-specific
  review. Do not automatically disable legacy grammar/style/technical rules
  through an unreviewed Pack classification.
- No runtime integration, performance benchmarks or browser NLP tests are
  claimed by this PR.
- External provider asset licenses, formats, integrity hashes and runtime
  interoperability remain outside this contract-only scope.
