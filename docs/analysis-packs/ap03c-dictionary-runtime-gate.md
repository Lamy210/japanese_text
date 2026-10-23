# AP-03c-1 — Gate existing Dictionary-owned builtin rules at runtime

## Context
AppConfig v2 (#71) and legacy JSON import preservation (#72) were merged
before this change. The stored Analysis flags were previously metadata-only,
so changing Dictionary Pack OFF did not change lint findings.

## Decision
Introduce the smallest live AP-02 Resolver bridge for **builtin** rules.
The existing catalog owns exactly three Dictionary Rules:
`wording/common-typo`, `wording/terminology`, and `wording/ng-word`.
Everything else remains in the required Core Pack until reviewed ownership
migration. Do not infer Grammar, Style, Technical or Morphology support from
their saved Pack flags.

The new `runnableLegacyBuiltinRuleIds(config, docType)` builds a request-local
Set of builtin Rule IDs after resolving:
- current per-rule enabled flags;
- the effective Pack ON/OFF state (Core is always ON);
- supported doc type;
- provider identity as declared in the AP-02 catalog.

The actual `runOwnRules` loop uses the resulting Set *as an additional
condition*, retaining its old RuleSetting checks, errors, normalization and
UTF-16 diagnostic IDs. The Worker, RevisionGate, Formatter and editor do not
change. The existing textlint adapter is **not** passed through a synchronous
readiness check or treated as available before dynamic import. The
metadata-only catalog is compiled once on module initialization; the resolver
makes no network requests or mutations.

## Non-goals / intentional trade-offs
- No UI controls are added; Profile flags can be changed through v2 settings
  import or future settings UI.
- No new NLP analyzer, WASM, asset fetch, dictionary expansion or Worker
  protocol fields.
- Core-owned Grammar/Style rules remain enabled according to existing
  per-rule configuration even if the corresponding future Pack is OFF.
- `runSingleRule()` test helper executes a Rule directly; only engine/Worker
  results are gated, as intended.
- Existing Provider runtime failure remains independently reported by Worker.

## Alternatives considered
1. **Direct hard-coded ID check in the Worker:** fewer lines but bypasses AP-02
   ownership metadata and differs from direct engine API consumers.
2. **Full Worker / textlint / NLP gate in one PR:** premature as non-builtin
   readiness, generation cancellation and profile switches require additional
   protocol and integration tests.
3. **Chosen:** pure cached legacy catalog + per-engine-run resolved builtin
   rule set, with no new stateful lifecycle.

## Regression criteria
- Default AppConfig has diagnostic parity with an explicitly enabled
  Dictionary Pack.
- Pack OFF hides exactly the three Dictionary rule diagnostics.
- Core and unrelated existing diagnostics remain unchanged and ordered.
- Pack re-enable preserves per-rule disabled flags.
- Setting Core OFF has no effect; other future Pack flags remain inert for now.
- A PreparedOwnRuleExecution from another config cannot be reused.
- Full TypeScript, dictionary integrity, Vitest, analysis smoke, and production
  and Pages build checks all pass.

## Remaining work
AP-03c-2 must cover live Pack-setting UI, textlint readiness, worker
request-generation separation (including Profile/Workspace revision changes)
and an explicit end-to-end stale-result regression before introducing a
runtime NLP provider.
