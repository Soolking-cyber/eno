/**
 * ⛔ ONE CHIP STYLE ON THE BROWSE SURFACES (owner, 2026-10-18: "make it look super professional … like top
 * marketplace"). Six chip looks used to share the first screen — flush text pills in the sticky filter strip,
 * a raised white plate under the category rail, 44px ladder chips, 32px recents, square-ish search-panel chips —
 * and on a phone the strip's borderless pills read as a row of bold links, not filters. Every chip there is
 * now ui/chip's `md` chip: a 36px tinted pill with an invisible 44px hit area.
 * Most of those controls cannot BE a <Chip>: they are a select's trigger (<CustomSelect>), a popover or drawer
 * trigger composed through `render`, a toggle beside a tablist, a link on a server page. So the look is also
 * exported as classes:
 *   · PILL_BOX  — the md geometry and type, plus `tap-44` (which needs the `relative` it carries). ⚠️ A scroller
 *                 that holds pills must leave 4px above and below them (`py-1`), or its overflow clip cuts
 *                 the hit area back to the visible 36px.
 *   · PILL_REST — at rest: the neutral tint, body ink, no border. Hover deepens the ink only — the tint's own
 *                 hover twin (`--muted`) is the same colour, and the brand tint would read as "applied".
 *   · PILL_ON   — a filter that is applied (or a pressed toggle): the brand tint and accent ink.
 *   · PILL_OPEN — while the pill's own panel is open. A <CustomSelect> cannot be told its open state from
 *                 outside, so its trigger takes PILL_OPEN_ATTR — the same look, keyed on Base UI's
 *                 `data-popup-open` — whose attribute selector deliberately outranks PILL_REST / PILL_ON.
 * ⚠️ `--tint` and `--muted` are the same colour today (#f5f5f5 / #262626), so an open pill differs from a
 * resting one by its full ink and its turned chevron; it still names the muted token so the two can part.
 * ⚠️ A PLAIN MODULE, NOT ui/chip.tsx: that file is `'use client'`, and a server component that imports a constant
 * from a client module gets a client reference, not the string — the /c landing page (a server page) wears these.
 */
export const PILL_BOX = 'relative tap-44 min-h-9 rounded-full px-3.5 text-sm font-semibold'
export const PILL_REST = 'bg-tint text-body hover:text-foreground'
export const PILL_ON = 'bg-brand-50 text-accent-foreground'
export const PILL_OPEN = 'bg-muted text-foreground'
export const PILL_OPEN_ATTR = 'data-popup-open:bg-muted data-popup-open:text-foreground'
