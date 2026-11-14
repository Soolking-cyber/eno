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
 *   · PILL_REST — at rest: white, a 1px `line-strong` hairline, ink label; hover and press fill the field grey.
 *   · PILL_ON   — a filter that is applied (or a pressed toggle): the INK FILL, white label and glyph (`pill-on` keeps it
 *                 Highlight in forced colours, `icon-own-ink` keeps the glyph white over the (0,4,0) accent recolour).
 *   · PILL_OPEN — while the pill's own panel is open: the field grey under the same hairline. A <CustomSelect> cannot be
 *                 told its open state from outside, so its trigger takes PILL_OPEN_ATTR — the same look, keyed on Base
 *                 UI's `data-popup-open` — whose attribute selector deliberately outranks PILL_REST / PILL_ON.
 * ⛔ WHITE + HAIRLINE, SELECTED = INK (owner-approved 2026-11-14, cook r05: "after this cook round build all best options
 * and deploy"). It reverses the 2026-10-18 tinted pill with the brand-tint selection: the redesign's chips are "36
 * visible / 44 tap, white, 1px line-strong, ink 700 14/20; selected = ink fill, white text; pressed = field". The 1px
 * border sits inside min-h-9 (34px of content + 2), so nothing grows. Dark: #f0f0f0 fill under #1c1d1f ink.
 * ⚠️ A PLAIN MODULE, NOT ui/chip.tsx: that file is `'use client'`, and a server component that imports a constant
 * from a client module gets a client reference, not the string — the /c landing page (a server page) wears these.
 */
export const PILL_BOX = 'relative tap-44 min-h-9 rounded-full px-3.5 text-sm font-bold'
export const PILL_REST = 'border border-line-strong bg-background text-foreground hover:bg-muted active:bg-muted'
// The ON look owns its hover and press too (commit review): beside PILL_REST's `hover:bg-muted` a plain ink fill turned grey
// under the pointer while its label stayed white — the label vanished.
export const PILL_ON = 'pill-on border border-foreground bg-foreground text-background hover:bg-foreground hover:text-background active:bg-foreground active:text-background icon-own-ink'
export const PILL_OPEN = 'border border-line-strong bg-muted text-foreground'
export const PILL_OPEN_ATTR = 'data-popup-open:border-line-strong data-popup-open:bg-muted data-popup-open:text-foreground'
