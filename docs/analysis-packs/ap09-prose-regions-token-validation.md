# AP-09 part 2 — Conservative ProseRegion extraction and atomic byte token validation

## Context

AP-09 part 1 (PR #89) added `Utf8OffsetMap`: exact UTF-8 byte offset to UTF-16 scalar-boundary conversion. The v5 design requires an additional safety boundary: a tokenizer must receive **unmodified contiguous prose** and its output must never be mapped onto code, metadata or a different source revision.

This PR adds three standalone core modules. None are connected to the existing Lint Worker or formatter.

## Contract

- `src/core/nlp/types.ts`: original-text `ProseRegion`, future `MorphToken` metadata shape, raw byte spans and source-verified span shapes.
- `src/core/nlp/prose-regions.ts`: `extractProseRegions(source, 'markdown' | 'text')` returns frozen, deterministic, ordered, nonoverlapping **exact UTF-16 source slices** with source-range IDs.
- `src/core/nlp/token-validator.ts`: `validateByteTokenSequence(source, region, rawTokens)` compares the entire region against the given original source and maps raw UTF-8 spans using `Utf8OffsetMap`.

A token must have safe-integer byte positions at exact scalar boundaries, a nonempty original surface equal to `source.slice(start,end)`, strictly increasing nonoverlapping spans and absolute UTF-16 coordinates within the verified region. Gaps between tokens are allowed. An invalid token or region fails the **whole** validation atomically with a reason; it never returns a misleading partial successful token list. An empty provider result is valid only for a valid region; reporting runtime failures as empty tokens remains forbidden to the future Coordinator.

## Scope of Markdown extraction (conservative interim fallback, not a Markdown AST)

The plan in §8.4 prefers CodeMirror/Lezer syntax trees. That is still an open integration decision for a dedicated Worker. Instead of silently implementing an incomplete parser, this stage:
- Reuses `maskDocument(source).regions` solely to **exclude** code fences, inline code, URL destinations, bare URLs, comments, frontmatter and reference definitions. It never feeds the U+FFFF-masked string to the tokenizer or offset map.
- Extracts source spans from paragraph lines, ATX heading text, list bodies, and visible link-label spans.
- Splits on inline formatting delimiter characters and physical line boundaries; does not create a token/grammar context across noncontiguous formatting syntax.
- Defaults blockquotes **OFF** and excludes table-like lines and raw HTML; those require a more complete AST-based approach. A line with unmasked/malformed backticks is excluded rather than guessed.
- Keeps original CRLF offsets (does not silently convert CRLF to LF), emoji/ZWJ, combining marks and variant selectors.
- Rejects a line containing an unpaired UTF-16 surrogate rather than allowing a lossy U+FFFD encoding.
- For `text` documents, Markdown punctuation is ordinary text rather than markup.

This is deliberately lower recall than a complete Markdown parser. It must not be advertised as full CommonMark handling. A Lezer-compatible Worker extractor should replace/refine this with additional source-span Gold before NLP is enabled.

## Tests and quality gates

`tests/analysis/ap09-prose-regions.test.ts` covers masked fences, inline code, links, frontmatter, metadata, heading/list/link-label kind and source offsets, quotes, tables, raw HTML, malformed code, emoji/ZWJ, combining characters, CRLF and lone surrogates.

`tests/analysis/ap09-token-validator.test.ts` covers exact byte ↔ UTF-16 mapping from extracted prose, duplicate Japanese surfaces, wrong surfaces, byte offsets inside scalars, NaN/Infinity/out-of-range, overlap and token ordering, invalid region identity and source snapshots, and all-or-nothing results.

No new dependency, CI workflow, Worker protocol, UI/Config/DB schema, document migration, external network request or storage write. Existing Fast/Deep/Idle, ignored diagnoses and Safe Formatter remain unmodified.

## Remaining work

AP-09 full acceptance still needs a Markdown syntax-tree extractor and validation of `MorphToken` POS features and inter-token/sentence identities. AP-10 introduces the **separate**, opt-in NLP Worker/Coordinator, with cancellation and snapshot epoch fencing; AP-11/12 cover actual Lindera/kuromojin tokenizers and their dictionary licenses. No tokenizer accuracy or real-browser speed benchmark is claimed here.
