# Phase 4A — Paragraph sentence-density review

## Goal

Introduce the first low-risk **document-level** writing-structure hint in
Japanese Writing Toolkit. A long paragraph is not necessarily incorrect:
users receive an informational review suggestion, never automatic rewriting.

## Rule

`style/paragraph-density` (idle tier) reports once when a prose paragraph has
more than a configured number of completed sentences (default: 5, range: 2–20).

The rule highlights the first beyond-limit sentence; the message reports the
total number in the paragraph. It uses the existing `splitSentences` and
`isSubstantiveSentence` utilities, and accepts only explicit Japanese
sentence-terminal punctuation. Incomplete phrases without a terminal are not
counted. Grouped punctuation (e.g. `！？`) counts as one ending.

A soft newline is part of the current paragraph. A blank line, heading,
list item, block quote, indented code line, table row or fully masked line
ends the current prose segment. Japanese quoted examples and Markdown code,
URLs and metadata are ignored without shifting UTF-16 offsets.

## UX policy

- General, Technical, Strict: enabled as `info` with `max=5`.
- Minimal: disabled.
- Configurable rule options in RuleProfile.
- No Safe Fix, no replacement and no quality score claim.
- No topic coherence, causal or semantic judgment.
- Scope intentionally excludes list-based prose; future work may cover
  list-item paragraph structures after independent tests.

## Quality gates

The regression suite includes a 5/6/7-sentence boundary, grouped punctuation,
Unicode, multi-line prose, blank paragraphs, headings, blockquotes, lists,
code fences, tables, and quotations. Also check precise highlighted spans,
options metadata, registry/profile integration and unchanged formatter output.

Run TypeScript typecheck, all Vitest suites, production build, Pages build and
asset-path validation for the PR's exact final HEAD. Verify no new dependency,
network request, migration or new persistent data.

## Limitations

Counting explicit completed sentences is a coarse readability proxy. It
does not capture complexity from a single very long sentence and is unsuitable
as a universal content quality score. A synthetic regression suite cannot
establish a statistically meaningful real-world false-positive rate.
