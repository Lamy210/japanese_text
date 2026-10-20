# Phase 2E-A — RuleProvider / RuleManifest foundation

Status: implementation. Base: `main` at `d57d9d16009374eef980f315165d0e1ce981ba8f`.

## Goal
Separate rule metadata enumeration from rule execution construction, while preserving all existing Japanese lint/formatter behavior and frontend-only/no-LLM operation. Build the stable interface required by subsequent declarative custom rules, profile management and editor integrations.

## Contracts
- `RuleManifest`: metadata for id, providerId, category, tier, description, defaultSeverity, optionDefs and source, but **not an unproven fix-kind classification**. Clone option definitions on public reads.
- `RuleProvider`: `id`, `listManifests()` and `createRules(config)`.
- `builtinRuleProvider`: owns all current native CoreRule factories in their **original insertion order**.
- `textlintRuleProvider`: exposes the three existing textlint manifests; returns no CoreRules because the deep textlint adapter continues to execute them.
- `listRuleManifests(providers?)`: stable sorting by category then ID; reject duplicate provider/rule identifiers and malformed manifest IDs; return fresh metadata. This is used by Settings.
- `buildRuleRegistry(config, providers?)`: aggregate native CoreRules from providers in original order, rejecting duplicate IDs and mismatches with each provider's manifests. Preserve existing API and textlint compatibility constants until all consumers migrate.
- Dynamic NG-word/terminology/citation factories receive the current supplied `AppConfig`; no global mutable config or persisted metadata.
- No migration, UI redesign, new dependency, plugin loading, arbitrary JS, worker protocol change, network or new rule behavior.

## TDD / Acceptance
1. Provider aggregation produces identical ordered native rule IDs and tier membership as the pre-change registry.
2. Builtin and textlint manifests have complete unique IDs, valid category/tier/severity, and metadata parity with current CoreRules or textlint constants.
3. Settings' rule list has the same IDs, descriptions, options and deterministic category/ID order.
4. Manifest return values are independent copies so settings cannot mutate the canonical metadata.
5. Duplicate provider IDs, duplicate rule IDs and manifest/runtime mismatches fail closed.
6. Diagnostics and preset configuration stay unchanged for existing fast/deep/idle rules; native/textlint separation remains.
7. `bun run lint`, `bun test`, `bun run build`, `bun run build:pages` and the CI asset-path check must pass before PR merge.
8. PR head exact SHA CI green, no unresolved reviews; squash merge only with supplied approval, then main CI/Pages verify.

## Deferred
Profile CRUD, user declarative/regex providers, suppression UI and dynamic plugin loading. Do not bundle them into this refactor.
