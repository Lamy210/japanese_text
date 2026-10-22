# AP-03a — Optional RuleProfile analysis settings (no destructive migration)

## Scope

A deliberately small first part of AP-03, following AP-02's read-only Pack
Resolver. Add an optional validated `RuleProfile.analysis` contract, preserve
it in existing persistence, and keep legacy `AppConfig` v1 unchanged. Pack
flags do **not** gate live diagnostics in this PR.

## Model

`ProfileAnalysisSettingsV2` contains:

- `packs`: six known Pack boolean flags; `core` is always normalized ON.
- `morphology`: explicit opt-in (default OFF), supported provider ID,
  dictionary asset ID or null, bounded automatic/manual analysis limits,
  quote analysis disabled and evidence display setting.
- `dictionaries`: bounded arrays of inert, unique dictionary IDs only.
  User-authored private dictionary bytes and URL/path values are rejected.

The dictionary ID `curated-common-typo-ja` matches the existing built-in pack.
The source `src/core/analysis/profile-settings.ts` owns defaults, validation
and a read-only fallback function for old profiles. No eager writeback is
required to read a legacy profile without an `analysis` field.

## Compatibility / persistence

- `RuleProfile.analysis?: ProfileAnalysisSettingsV2` is optional; no legacy
  Profile gets an extra field just because it was validated.
- The existing Memory and IndexedDB v2 repositories validate this optional
  property during reads/writes; no database store/index migration occurs.
- The existing v1 `AppConfig` does not have an `analysis` field. Its
  `splitAppConfigPreservingStorageMode()` preserves the current Profile's
  optional metadata across ordinary saves, so saving a rule or terminology
  does not accidentally delete Pack settings.
- Profile duplication already uses `structuredClone(active.profile)`.
  Settings survive duplication without sharing object identity.
- Profile metadata **must not** change `Workspace.storageMode`, which remains
  the canonical privacy gate. A caller cannot enable Local Library through
  `AppConfig.privacy` on ordinary saves.
- No switch in live diagnostics: disabling a Pack flag in stored metadata
  does not yet disable existing Fast/Deep/Idle Rules. AP-03b+ will explicitly
  integrate this only after config v1→v2 migration and regression evidence.

## Security boundaries

- Unknown fields in the new analysis subtree fail closed, to avoid persisting
  arbitrary private dictionary bytes, paths or URLs.
- Allowed IDs are bounded, non-path tokens. The runtime must still validate
  the actual asset's hash and origin independently.
- Dictionary IDs are references, not content. This does not authorize
  persistent storage of Private Session documents or user dictionaries.
- A `providerId` in metadata does not start WASM or a Worker. Morphology is
  opt-in and OFF by default.

## Alternatives rejected

1. **Eager destructive v2 migration:** would touch AppConfig, RuleProfile,
   import/export, settings UI and storage simultaneously. More regression risk.
2. **Store the options in GlobalPreferences:** would share the selection
   across unrelated Workspaces and Profiles.
3. **Use an opaque JSON blob:** would silently accept private text or arbitrary
   plugin/URL payloads, risking privacy and future compatibility.

## Meaningful tests

`tests/analysis/profile-analysis-settings.test.ts` includes:

- Old Profile remains structurally unchanged after read/validation.
- Required core and morphology OFF defaults, with no mutation of inputs.
- Unknown nested keys, invalid providers/flags, URLs/path-like IDs,
  duplicate references and invalid lengths are rejected.
- AppConfig v1 saves preserve Analysis flags but not altered privacy intent.
- Real WorkspaceService.saveConfig path preserves the stored Profile metadata.
- Memory and IndexedDB v2 read/save round-trips, Profile isolation,
  mutated read copies, malformed-save rejection and clean omission.

## Deferred

AP-03b: AppConfig v2 import/export and schema migration, Profile switch
settings UI, and Pack enablement applied to the Worker with generation gates.
This PR intentionally does **not** change CONFIG_SCHEMA_VERSION, DB_VERSION,
existing diagnostic behavior, dependency versions or CI workflows.
