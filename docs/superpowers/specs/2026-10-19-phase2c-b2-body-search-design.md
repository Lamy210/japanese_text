# Phase 2C-B2 — Workspace Body Search (2026-10-19)

Status: implementation specification. Base: main `ec2d65c1578c01863d6ae503f07bf474faf2f177`.

## Goal
Provide explicit, local-only **body** search across documents in the current Workspace, preserving Private Session / Local Library isolation, unsaved-editor correctness, and deterministic result navigation. Existing name-only sidebar filtering stays unchanged.

## Scope / UX
- A collapsible **Search bodies** section in Documents sidebar. The user submits a query explicitly with Enter/Search; no remote request, persisted query, indexed search database, or automatic background scanning.
- One matching snippet per occurrence, at most **3 hits/document and 50 total**. Stable order: `createdAt ASC, id ASC` for documents, occurrence position ascending within each document. Show document name and excerpt. Results are ordinary escaped text (not injected HTML).
- Empty/whitespace-only query returns [] without loading documents. Trim query. Maximum **80 Unicode code points**; show a validation message if longer.
- Literal matching, Unicode-aware case-insensitive. Escape regex metacharacters. Match positions are **UTF-16 offsets in original document** for CodeMirror navigation. Never normalize the source document for offsets.
- Selecting a hit opens the document and, after editor projection, selects the matched occurrence only if current content still matches. Otherwise open the document without stale highlighting.
- Query/error/results are ephemeral component state, cleared on Workspace transition; outdated asynchronous responses cannot overwrite newer queries.
- Search results include current unsaved editor contents, overriding that document's stored value. No writes from search.

## Architecture
- Define `DocumentSearchHit` in `src/document/types.ts`.
- Implement pure `searchDocumentBodies(documents, query, limits)` in `src/document/body-search.ts`; no Solid/DOM/storage dependency. Caps must be enforced before rendering.
- Extend `DocumentService.search(workspace, query, activeDocument?)`: Private Session reads only `SessionDocumentLibraryStore.list(workspace.id)`; Local Library reads only `repositories.documents.listByWorkspace(workspace.id)`; overlay active document **only when it already belongs to this Workspace and is in the list**. No cross-Workspace results, no historical snapshot bodies, no migration, no persistence.
- `DocumentController.searchWorkspaceDocuments(query)` captures active Workspace/Document identity + editor projection before awaits; stale Workspace change causes rejection. A switched active document during search invalidates the result (rather than silently substituting a new override).
- UI under `DocumentSidebar`; consume `DocumentController`, never a persistence adapter directly.
- No schema version bump, new dependency, Web Worker, search index, service worker cache or LLM. This is on-demand bounded linear scan suitable for the current personal-scale library.

## Safety and failure behavior
- Query never leaves the browser and is not written to IndexedDB, localStorage or sessionStorage.
- No full-body display in result previews. Cap snippets to bounded context, escape as JSX text, never use innerHTML.
- No writes during search, including no implicit Workspace creation or active selection repair. Local read errors surface as visible error; do not silently search another Workspace.
- Guard against regex injection, overlapping stale searches, concurrent document mutations, Workspace switching, body changes between search and navigation.
- Public UI and API treat Private/Local equally while routing through canonical mode.
- Body remains canonical in DocumentService; search doesn't read snapshot/history data.

## Required tests
1. Japanese substring, English case-insensitive, literal regex punctuation, exact UTF-16 offsets, stable order, bounded hit count, empty query and 80-codepoint cap.
2. Private search never uses durable document repository; Local search ignores other Workspace; active unsaved text overrides saved version without writing.
3. Search query does not mutate document selection or persistence and stale request results are not applied.
4. Navigation to a matching hit never overwrites document content; stale offsets skip jumping.
5. Lint, full tests, production and Pages build, Pages worker path; PR exact-head CI success and review gate before merge.

## Deferred
Indexed/tokenized search, fuzzy Japanese morphology, cross-Workspace search, searches across snapshots, saved searches, worker offloading, complex highlighting/ranking, multi-tab sync. Reconsider only if measured latency demands them.
