# AP-03b follow-up — Preserve active Analysis settings on legacy config import

## Confirmed regression

AP-03b PR #71 introduces `AppConfig.schemaVersion = 2` and correctly
projects `RuleProfile.analysis` into v2 JSON exports. However, the existing
`importConfigFile()` calls `migrateConfig(v1)`, which assigns v2 default
Analysis flags. Importing an older file then replaces the active Profile's
previously selected Pack flags with defaults, even though the v1 file cannot
express Pack settings.

## Implementation

- `prepareConfigImport(raw, current)` is a pure import boundary using the
  established migration/validation functions.
- If `schemaVersion=1` or is omitted, keep the active Profile's validated
  Analysis selections and import the rest of the supported v1 settings.
- A v2 file continues to import its explicit Analysis settings.
- Imported `privacy` never changes the Workspace's canonical StorageMode.
- Future schema and malformed v2 data still fail validation before any UI
  state mutation; a v1 file cannot smuggle arbitrary Analysis data.
- SolidJS Store proxies are converted using the same JSON snapshot approach as
  the existing Export path, not passed directly to structuredClone.
- No changes to configuration schema, persistence repositories, IndexedDB,
  Worker messages, rule execution, or CI workflows.

## Regression tests

`tests/analysis/ap03b-legacy-import-preserve.test.ts` covers:
- v1 Import retains active dictionary OFF, style ON and evidence settings;
- valid legacy terminology and Rule flags still import;
- unversioned historical JSON retains Analysis;
- v2 import applies explicit selections;
- future/malformed v2 input rejects without mutating current config;
- privacy and attempted v1 Analysis spoofing cannot overwrite current state.

This is a narrow corrective follow-up to PR #71, not a second version
migration implementation.
