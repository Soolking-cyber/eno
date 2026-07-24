# Flat surfaces — the eno design language, phase 2

Owner, 2026-07-24 (verbatim): *"develop a design language for eno where we use minimal boxes as
much as open borders with lines between elements … adapt it to all pages … it means background
color as uniform as possible almost no boxes"*, with a reference screenshot of a flat canvas,
hairline rules between blocks, and one outlined button.

Planned with both external reviewers (codex GPT-5.6 · Gemini 3.6 Flash). **Both CONFIRMED the
plan.** Where they disagreed, the disagreement is recorded below rather than averaged away.

## Where we start (measured 2026-07-24)

| signal | count |
|---|---|
| files using `rounded-2xl` | 77 |
| `bg-card` usages | 112 |
| files using the `<Card>` primitive | 14 |
| `divide-y` (the line-based pattern we want) | 6 |

Tokens today: `--background: #fafafa`, `--card: #ffffff`, `--tint: #f5f5f5`, `--border: #e5e5e5`.
**Card and background differ by ~2%** — that near-invisible delta is exactly what makes every
panel read as a faint box. This is a token problem before it is a component problem.

## The rules

1. **ONE canvas.** `--card` collapses into `--background` in light AND dark. That flattens all
   112 call sites without touching them. `--tint` stays for genuine wells/chips; `--border`
   stays for hairlines. **Do not introduce a second general-purpose panel colour** — that just
   recreates the faint box (codex).
2. **Lines, not boxes.** Related rows are separated by `divide-y divide-border`; sections by a
   single `border-t border-border` plus vertical rhythm. No outer border, no radius, no fill.
3. **Elevation must MEAN something.** Surface + shadow survive only where the element genuinely
   floats above the page and the boundary is the information: dialogs, popovers/menus, toasts,
   sticky bars, the media lightbox. Everything in normal flow goes flat.
4. **Structure survives flattening.** Removing a fill removes a *visual* grouping, so the
   semantic one has to be real: headings, `<section>`, list markup, `fieldset` where it applies.
   Focus rings must stay clearly visible against the flat canvas, and hairlines that identify a
   control must keep non-text contrast (WCAG 1.4.11). Both reviewers raised this independently.

## ⚠️ The one thing the reviewers disagreed about — PRODUCT GRIDS

- **Gemini:** grids don't need card boxes; rules + rhythm are enough.
- **codex:** *"Do not flatten boundaries that communicate item identity … titles, prices and
  actions cannot appear to belong to adjacent products."*

**Decision: the feed/grid is OUT of the first pass and needs the owner's eyes before it moves.**
A marketplace's core job is saying *this is one item*; getting that wrong costs conversions, and
the owner's reference screenshot is a settings-like surface, not a product grid. Chrome, forms
and lists flatten now; the grid is a separate, reviewable decision with a before/after.

## Sequence

**Phase 0 — foundations, ONE lane (mine), landed before anything else.** codex specifically
warned against splitting while tokens/primitive/lint are still moving.
- collapse `--card` → `--background` (light + dark)
- new `ui/rows` primitive: divided list, no outer border/radius/fill
- canon updated (`docs/design-language.md`) — this file is the *plan*, the canon is the *rule*
- audit what the collapse exposes: images bleeding into the canvas, skeletons, nested wells,
  dark-mode contrast. Anything that legitimately needs separation gets `--tint` or a hairline,
  never a restored card.

**Phase 1 — surfaces, two lanes, split by file (no shared files).**
- dashboard sections · settings · account · visa cases
- chat panels · PDP non-grid chrome · storefront header

**Phase 2 — enforcement.** Extend `design-lint` to fail `border + rounded-2xl + bg-card` on an
in-flow container, with an allowlist for rule 3. Gemini would defer this until after migration;
codex would keep it narrow. **Deferred to last** — a lint rule written before the call sites
move would fail the build on code we have not migrated yet.

## Reconciling with today's inset-card Settings work

Murat shipped Settings as native iOS "inset grouped" cards hours before this directive. Both
reviewers read it the same way and so do I: **the new directive supersedes the container
treatment, and none of the rest is wasted.** The row density, section structure and
content-shaped skeletons all survive; only the card wrapper becomes open rows on a flat canvas.
