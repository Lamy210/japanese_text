# AP-03c-2 — Dictionary Pack Settings switch

## Rationale and selected scope

AP-03c-1 (#74) introduced runtime gating for three builtin Dictionary rules,
and #75 invalidates obsolete Worker generations after settings changes. The
settings UI still had no way to toggle the new option without importing JSON.

Add **one** Dictionary Pack switch to the existing Rules settings tab.
Keep Core mandatory; Grammar, Style, Technical, Morphology remain future-only
metadata. No misleading switches for functionality that is not yet wired.

## Behavior

- Checked by default (legacy diagnostic behavior).
- OFF suppresses `wording/common-typo`, `wording/ng-word`, and
  `wording/terminology` via the already-reviewed AP-03c Resolver gate.
- Rule checkboxes/severity/option controls owned by Dictionary are disabled
  while the Pack is OFF. Their stored settings, NG words and terminology
  **are never modified** by the Pack toggle.
- Switching ON restores each Rule's prior individual setting.
- The switch uses `appState.updateConfig` validation followed by
  `persistAndRelint`, which advances the document analysis revision,
  clears old tier diagnostics and schedules fresh lint. No new timers.
- The setting applies to the active RuleProfile via the existing
  WorkspaceService and AppConfig v2 projection.
- The switch is labeled and has a explanatory description for keyboard and
  assistive-technology users.

## Tests and review boundaries

`tests/analysis/ap03c-dictionary-pack-settings-ui.test.ts` exercises the real
action (mocking only the Worker transport and absent durable storage):

1. Ownership mapping covers exactly the three real runtime-gated rules.
2. OFF clears old diagnostics, advances the revision, retains individual
   settings and removes only Dictionary-owned findings.
3. ON resumes without changing individually disabled Rule flags.
4. No-op setting changes do not trigger needless relint/revision.
5. Real Memory WorkspaceService persists OFF only on its original Profile
   and does not write any Private Session document bodies.

The existing TypeScript, entire Vitest suite, dictionary integrity,
benchmark smoke, production bundle and Pages bundle gates must pass.

## Risk / deferred work

The existing settings screen does not offer Morphology/Grammar/Style/Technical
toggle controls; these packs are not yet active in the engine. This PR does
not change Worker protocol, IndexedDB schema, Profile v2 migration, external
fetching, dictionaries, backend or dependencies.

Follow-up: a dedicated Analysis Pack settings section after other Pack
ownership is reviewed; dedicated browser accessibility E2E tests when a
browser test harness becomes available.
