# P2-D — 一人ブレストの同一ワークスペース限定JSON復元

> 2026-10-27. Implements explicit import of the V1 Thought Graph format already exported by the memory-only Brainstorm dialog.

## Goal

Enable users to restore manually exported graph snapshots after a browser reload, without surprising persistence, corrupting an existing graph, or leaking content across workspaces.

## Requirements and implementation

1. **Explicit user action only.** Restore button is visible even before a new brainstorm is started. The user chooses a local JSON file. There is no automatic restore, network fetch, periodic backup, or IndexedDB write.
2. **Import file cap.** Reject files larger than 16 MiB before `file.text()`; accept only JSON after `JSON.parse`. The V1 strict parser applies additional caps (1,000 nodes, 5,000 edges, bounded strings and enums).
3. **Atomic validation.** `BrainstormMemorySession.importSnapshot(unknown)` fully parses via `parseBrainstormSnapshot` and rejects invalid data without modifying the current graph or consumed-question history.
4. **Workspace boundary.** Imported `session.workspaceId` must equal the memory controller's currently bound workspace. The UI captures the active workspace before asynchronous file reading, verifies it is unchanged afterward, and aborts on a switch.
5. **Overwrite consent.** A non-empty existing session is replaced only after an explicit `window.confirm`; errors retain the old data.
6. **Privacy contract.** Imported content lives only in memory and is discarded on workspace switch, tab close or reload. It never modifies the document or auto-saves to Local Library. The user may export again manually.
7. **Versioning.** Only `schemaVersion: 1` accepted; unknown/future versions must not be silently migrated. The snapshot parser makes fresh immutable copies.
8. **Known limitation.** The consumed/skipped template prompt history is not part of V1 export. After importing, the question queue restarts for the imported phase/focus; previously saved nodes and `answers` edges remain intact.

## Review and acceptance

- Valid export/import round-trip including question→answer relation and subsequent revision-safe edits.
- Cross-workspace import rejection even into an empty session.
- Invalid, future-version, and malformed JSON never overwrite existing graph/history.
- Post-import mutation of input objects cannot change the validated session.
- Oversized file rejected before content read; workspace switch mid-load aborts.
- Browser tests for file input interaction, focus and manual downloads still required for production UX acceptance.

No dependency addition, CI workflow change, NLP/LLM provider, IndexedDB migration, CoreRule or Formatter modification.
