# Phase 2E-B1 — Workspace RuleProfile Duplication and Switching

Base: main `04e984b66dc2036b5d1a351ea0bf273a3469ec9d`.

## Goal
Enable multiple named RuleProfiles per Workspace with safe duplicate-and-activate and active-profile switching. Reuse existing `ruleProfiles` storage and application settings; no LLM, network, storage version bump, or new dependencies.

## Data model and compatibility
- `Workspace.ruleProfileIds?: string[]`, optional for legacy records. Legacy implied membership: `[activeRuleProfileId]`.
- Persisted memberships contain unique, nonempty IDs, include `activeRuleProfileId`, and may not be empty.
- Newly cloned profiles are independent copies of the existing active profile (rules, NG words, terms, citation, formatter). No document bodies/history are copied.
- Profile IDs, not profile names, determine identity. Duplicate names allowed. Names trimmed, nonempty, <=80 Unicode code points, no control characters.
- Profile listing is Workspace-scoped; no cross-workspace switching.
- Switch atomically checks both membership and existence of target profile, then changes active ID without mutating inactive profiles.
- Duplication atomically inserts profile and updates membership + active ID with collision detection and no partial writes.
- Workspace deletion deletes its owned profiles only when no other Workspace references them (legacy shared-profile safety).
- Profile removal/renaming and custom declarative/regex rules are deferred to B2/B3.

## Application/UI
- WorkspaceController flushes active document and saves current config before profile switching/cloning to avoid losing settings.
- After success, load the new profile config, reset diagnostics and relint; no document navigation.
- Workspace Manage displays current profile, select, and duplicate actions, with pending-state locks and useful errors.
- Private Session/Local Library storage mode is unchanged. No new contents persist beyond existing config metadata.

## Tests / Acceptance
1. Legacy workspace validates without `ruleProfileIds`; malformed/duplicate/mismatched memberships rejected.
2. In-memory and IndexedDB adapters enforce clone+activate atomicity, collision rejection and foreign-profile selection rejection.
3. Switching A->B->A retains different rule/NG word/terminology settings.
4. Deleted workspace removes only its unreferenced profiles, preserving another Workspace's profile.
5. Controller persists config before switching, reloads new config, relints and refuses navigation during pending history mutation.
6. Full bun lint/test/build/build:pages and asset path CI pass. Author review checks privacy, legacy compatibility, stale selection, schema constraints.
7. PR head green and unresolved review threads 0 before user-approved squash merge; main CI/Pages verified afterwards.
