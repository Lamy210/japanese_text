# Phase 6B-1 — Read-only dictionary pack manifest

## Goal

Make dictionary metadata explicit before adding any external corpus, separate
pack, storage migration or network loader. This change is metadata-only and
keeps the existing eight curated spelling pairs and their diagnostic behavior.

## Manifest v1

`src/core/dictionary/manifest.ts` provides a validated, immutable data
contract:

- `schemaVersion: 1`
- `packId`: lowercase alphanumeric components joined with hyphens
- `version`: three-part numeric version with optional prerelease suffix
- `locale: ja-JP`
- `kind`: typo, terminology, lexicon, or confusable
- `distribution`: bundled or optional (no executable plugin support)
- `entryCount`: positive safe integer, maximum 10,000,000
- `provenance.origin`: first-party or third-party
- `provenance.licenseId`: SPDX-like identifier or first-party NOASSERTION
- `provenance.reviewStatus`: pending or approved
- `provenance.sourceUrl`: HTTPS only, no URL-embedded credentials; mandatory
  for third-party packs

Validation clones and freezes the manifest, leaving caller input unmodified.
For third-party provenance, a source URL and declared license identifier are
required, but **neither their presence nor reviewStatus is legal proof** of
permission to redistribute the dataset.

The bundled eight-pair curated dictionary advertises:
`curated-common-typo-ja` version `1.0.0`, with first-party / NOASSERTION /
pending provenance. The repository-wide redistribution license is not inferred
from public GitHub visibility.

## Out of scope

- Fetching dictionary data at runtime or trusting arbitrary third-party packs
- Signing/hashing dictionary assets (planned when external bytes are packaged)
- Changing rules, RuleProfiles, `AppConfig`, IndexedDB or private document data
- Automatically declaring third-party licenses approved
- Automatically enabling or loading morphology / WASM assets

## Test strategy

- Built-in manifest count exactly matches reviewed in-memory entries.
- Deep immutability and caller object isolation.
- Bad versions, pack IDs, kinds, sizes and provenance are rejected.
- Third-party packs without HTTPS sources or declared licenses are rejected.
- Pending third-party provenance can be represented without granting approval.

## Follow-on tasks

1. Phase 6B-2: deterministic asset build, integrity hashes and package registry.
2. Phase 6B-3: opt-in static pack loader, size bounds, error fallback, and
   performance baseline in actual browsers.
3. Phase 6B-4: Profile-scoped enablement with migration and privacy regression.
4. Phase 6C: review-backed vocabulary expansion, negative examples, and
   separate licenses/attributions for any included external dataset.
