# AP-09 (part 1) — Strict original-text UTF-8 byte to UTF-16 offset map

## Baseline and scope

The Analysis Packs × NLP detailed design v5, §8.2, requires Lindera WASM
token offsets expressed in **UTF-8 byte positions relative to a prose
region** to become the original document's absolute UTF-16 offsets.
Conversion must reject unpaired surrogates, interior byte offsets, and
provider surfaces which do not exactly match the original text. A
`maskDocument()` string uses U+FFFF substitution and does not preserve UTF-8
byte lengths. It must never be passed to this map.

This PR implements the isolated, synchronous **position mapping primitive**
only. No NLP Worker, tokenizer, WASM, dictionary download, provider selection,
new rule or config behavior is added.

## API

`new Utf8OffsetMap(regionText)` scans Unicode scalar values once, building
exact maps for UTF-8 byte ↔ UTF-16 offsets and code-point boundaries.

- `utf16AtByte(byteOffset)`: exact boundary conversion or `null`.
- `byteAtUtf16(utf16Offset)`: exact reverse conversion; rejects a split
  surrogate pair.
- `utf16AtCodePoint(index)`: 0-based Unicode code-point boundary.
- `mapToken(byteStart, byteEnd, surface, regionStartUtf16)`: validates a
  **nonempty, exact source slice** and returns absolute UTF-16
  `[startUtf16,endUtf16)`; returns `null` for invalid input.

The constructor throws for isolated UTF-16 surrogates rather than replacing
them as TextEncoder would. Boundary maps prevent rounding or assuming one
UTF-8 byte equals one UTF-16 unit. Zero-length regions are accepted, but
zero-length tokens are rejected.

For valid scalars, UTF-8 widths are computed without per-character
`TextEncoder` allocations; the tests cross-check every boundary against
`TextEncoder()` reference results.

## Test cases / failure detection

- CJK, ASCII, astral emoji, combining marks, CRLF, ZWJ sequences.
- A non-boundary byte offset and a split-surrogate UTF-16 index return null.
- Valid token spans with nonzero absolute region start.
- NFC/NFD surface mismatch is rejected rather than silently normalized.
- Negative, fractional, NaN, Infinity, reversed, out-of-range and overflowing
  positions are refused.
- Lone high/low surrogates raise an exception, not a lossy U+FFFD mapping.
- Empty regions produce a well-defined boundary at zero.
- Byte lengths and all code-point boundaries are compared to an independent
  `TextEncoder`-based reference in tests.

## Review choices and remaining risks

**Confirmed by design:** mask text cannot preserve UTF-8 byte lengths and
must not be used; offsets refer to original `ProseRegion.text`.

Alternative 1: index UTF-16 code units as if they were bytes. Rejected:
breaks with Japanese script, emoji and combining marks.

Alternative 2: encode the entire prefix for each mapping lookup. Rejected:
O(n) per lookup and quadratic behavior for many tokens.

**Chosen:** one-pass O(n) index, O(1) boundary lookup, O(n) memory. This
supports future many-token provider output without repeatedly encoding
substrings.

**Not implemented yet:** validation of ordered/overlapping tokens, matching
`ProseRegion.text` against `source.slice()`, tokenizer-specific position
semantics, the NLP Coordinator lifecycle, and browser WASM tests. Those belong
to AP-09 part 2 / AP-10 and must not be claimed as complete.

No new dependency, Worker protocol, CI workflow, IndexedDB migration, network
operation or user-data persistence is introduced. Existing Fast/Deep/Idle and
Formatter behavior is unchanged.
