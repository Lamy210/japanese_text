# Phase 3C — Conservative additive-conjunction concentration hint

Status: implementation. Based on main `4e58a0bfbca9ea127b9172398ec3042b29310be3`.

## Purpose

Assist Japanese writing without pretending to judge sentence meaning. The
`style/additive-conjunction-density` rule proposes reviewing prose that begins
three consecutive sentences with three **different** additive connectives.

Example: `また、...。さらに、...。加えて、...。`

## Semantics and scope

- Recognize only explicit sentence-initial `また`, `さらに`, `加えて`,
  `そのうえ`, `あわせて` immediately followed by a Japanese comma.
- Trigger when the **last 3 consecutive prose sentences** all have different
  listed markers; mark only the third and subsequent qualifying markers.
- Reset on non-matching/intervening sentences, blank paragraphs, Markdown
  headings, block quotes, lists, tables, code and quoted dialogue.
- Do not count `また` used without a following comma.
- Keep exact UTF-16 offsets, and use the existing masked text in the Worker.
- `info` only; no correction, suggestion replacement or Safe Fix.
- Presets: General, Technical, Strict = `info`; Minimal = off.
  RuleProfile users can disable it.

The established `style/consecutive-conjunction` rule already reports
consecutive **identical** markers; this rule requires three **different**
markers to avoid redundant warnings about identical pairs.

## Non-goals

- This is not a grammar violation; rhetorical parallelism can be intentional.
- Do not assert that `しかし` is semantically invalid, or choose `そのため`
  on a user's behalf.
- Do not interpret clause scope, morphology or implicit discourse relations.
- Do not add a model, backend, external request, dictionary or dependency.

## Checks

Run the dedicated adversarial cases, then `bun run lint`, `bun run test`,
`bun run build`, `bun run build:pages` and Pages worker asset-path checks.
Cases cover positive triples and quadruples, Unicode offsets, distinctness,
negative interruptions, quote/code masking, Markdown boundaries, and
no-autofix behavior.
