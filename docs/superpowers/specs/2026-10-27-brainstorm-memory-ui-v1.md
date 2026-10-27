# P2-B: Memory-only solo brainstorming UI (initial)

> As implemented on 2026-10-27, based on Thought Graph V1 (#100), deterministic questions (#102), and existing SolidJS editor shell. This is the first **interactive** vertical slice, not a completed AI brainstorming product.

## Goals

Offer a usable zero-cloud/zero-LLM solo brainstorming workflow in the existing frontend:
1. Start a theme and see an initial problem-framing question.
2. Record a thought. The chosen ThoughtNode kind depends on the current phase.
3. Skip to another question, or navigate across seven adjacent phases.
4. Review or remove recorded thoughts and manually export the V1 graph as JSON.
5. Leave or close the dialog without modifying the document or triggering persistence.
6. Switch workspace and ensure the prior workspace's private brainstorm is discarded.

## Scope and compatibility

- `src/core/thinking/memory-session.ts`: memory-only per-workspace controller for Graph mutations, consumed prompts and JSON export.
- `src/components/BrainstormDialog.tsx` and `BrainstormDialog.css`: accessible dialog, text input, prompt, notes, phase navigation, export and explicit destructive reset.
- `Header.tsx` / `App.tsx`: entry point and persistent dialog component; no new dependency or app-state schema.
- README and regression tests for controller state.

Existing: unchanged `Fast/Deep/Idle`, Formatter, RuleProfiles, IndexedDB version, NLP Worker and CoreRule API. No new CI workflow or model assets.

## Privacy model

**All brainstorm content is ephemeral** even when Workspace storageMode is `local-library`. The controller has no repository or storage dependency. Closing the dialog only hides it, retaining the current in-memory data until the tab reloads or the active workspace changes. Switching the active workspace clears graph **and** consumed prompt history. The UI explicitly warns about data loss and offers manual JSON download.

JSON export only occurs on explicit button action, using `Blob` + local object URL, and no network request. It is a snapshot of the versioned V1 schema only; imports and auto-recovery are not supported yet. Node/source metadata is plain text, rendered by SolidJS text nodes—not interpreted as HTML.

## User interaction & failure modes

- Empty theme/notes disabled; V1 parser rejects unexpected/oversized records.
- Adding an answer consumes the old active question **only if the graph write succeeds**, avoiding false progress on a failed input.
- Skipping questions advances the in-memory history without incrementing graph revision. Consumed prompt history is bounded.
- Node deletion cascades incident edges via the domain reducer.
- Phase moves to an adjacent phase; no phase is skipped automatically; no hard gate on incomplete content.
- Workspaces are isolated; notes do not follow the user into another workspace.
- Closing and reopening within the same workspace preserves the in-memory notes; refresh, tab exit and workspace changes destroy them.
- The dialog traps first/last Tab navigation and returns focus to the launch button when closed. Mouse backdrop click/Escape close it.

## Alternatives and decision

| Approach | Risks / benefits | Outcome |
|---|---|---|
| Immediate IndexedDB/autosave | Complex privacy migration, surprise durable data, inconsistent Private behavior | Defer |
| New full-screen app with XState / graph rendering | Large impact on existing editor, high test surface | Defer |
| Simple SolidJS modal + memory-only controller | Minimal dependencies, simple rollout and easy rollback; no persistence | Adopt |

## Verification

- Unit: workspace switching resets graph, question history and notes; newly constructed controller has no prior data; malformed notes cannot advance prompts; manual export round-trips through strict parser.
- CI: TypeScript, Vitest, dictionary reproducibility, analysis smoke, normal and Pages build.
- Manual smoke still required: Chrome/Firefox/Safari, small screens, keyboard focus, downloading JSON, leaving/reopening modal, workspace switch with private text, reload removes notes.

## Deferred features

- Import/restore history, actual question-answer relationships and answer-completeness checks.
- Rich graph relations/visualization, model-assisted brainstorm and semantic role labeling.
- Explicit user confirmation for AI-suggested node promotion.
- Automated UI E2E and browser storage boundary instrumentation.
