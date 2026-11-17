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
 *   · PILL_ON   — a filter that is applied (or a pressed toggle): the SELECTED GREY (`line-strong`, no edge), ink label and
 *                 glyph (`pill-on` keeps it Highlight in forced colours, `icon-own-ink` keeps the glyph ink over the (0,4,0)
 *                 accent recolour).
 *   · PILL_OPEN — while the pill's own panel is open: the field grey under the same hairline. A <CustomSelect> cannot be
 *                 told its open state from outside, so its trigger takes PILL_OPEN_ATTR — the same look, keyed on Base
 *                 UI's `data-popup-open` — whose attribute selector deliberately outranks PILL_REST / PILL_ON.
 * ⛔ WHITE + HAIRLINE, SELECTED = INK (owner-approved 2026-11-14, cook r05: "after this cook round build all best options
 * and deploy"). It reverses the 2026-10-18 tinted pill with the brand-tint selection: the redesign's chips are "36
 * visible / 44 tap, white, 1px line-strong, ink 700 14/20; selected = ink fill, white text; pressed = field". The 1px
 * border sits inside min-h-9 (34px of content + 2), so nothing grows.
 * ⛔ SELECTED IS GREY, NEVER INK (owner, 2026-11-17: "make sure mobile top navigation is consistent … the black pressed state
 * was replaced by gray all experience should follow across the app cohesive harmonized experience", then "Grey everywhere" and,
 * for the /post pick, "Yes, follow it"). It reverses the 11-14 ink fill above and hub Q15's ink applied pill and ink /post pick.
 * One grey ladder for every chip: rest `--muted` (filled strips) or white + hairline, pressed or open `--secondary`, selected or
 * applied `--line-strong` (#d6d6d6 light, #414141 dark), the label ink in every state. Buttons (Buy, Chat, Publish) are not chips.
 * A WELL (the category plate's subcategory and model panels) is the field grey, and its pick ui/segmented's white pill with its
 * shadow (WELL_*).
 * ⛔ …EXCEPT IN THE FEED STRIPS ON A PHONE: FILLED (owner, 2026-11-16, hub Q15: "one chip look … filled strips on the feeds";
 * cook r12 R2 — build 8, owner-approved 2026-11-15, had done it for the goods strips alone, StockX's pills; it reverses, there,
 * the white + hairline above and the 2026-10-18 one chip style): a strip that carries `data-pills="filled"` paints every
 * RESTING pill in it the field grey with no edge (the 1px stays, transparent, so nothing grows and forced colours still draw
 * it), pressed or open one step deeper (`--secondary`); an applied pill is PILL_ON's selected grey. Two strips carry it, always:
 *   · explorer-toolbar.tsx SortStrip — every ListingsExplorer feed: the home and its searches and category feeds, and a shop's
 *     /s/[handle] grid (the explorer with `sellerId`);
 *   · seller-listings.tsx PinnedStrip — a SellerListings with `pinStrip`: the /c category and /c district pages.
 * …and one in flow: a storefront's (/[handle], /sellers/[id] — seller-storefront.tsx passes SellerListings `strip="filled"`, hub
 *   Q15 "filled strips on feeds and shops"). It neither pins nor sits under #explorer-toolbar, so the rule below does not reach
 *   it: the same values ride its sort pill (seller-listings.tsx `FILLED_PILL_*`).
 * ⚠️ NOT FILLED: the vehicle hubs' SellerListings strip (no `pinStrip`, no `strip`) keeps the white + hairline pills above.
 * One globals.css rule reaches every pill a filled strip holds — its own, the facet bar's, the scope chip, the view pick —
 * through the markers below (`pill-rest`, `pill-open`), so no pill component needs to know which strip it is in. Below 40rem
 * only; a chip outside those strips, and every width from sm, is as above.
 * ⚠️ A PLAIN MODULE, NOT ui/chip.tsx: that file is `'use client'`, and a server component that imports a constant
 * from a client module gets a client reference, not the string — the /c landing page (a server page) wears these.
 */
export const PILL_BOX = 'relative tap-44 min-h-9 rounded-full px-3.5 text-sm font-bold'
// `pill-rest`: the marker the filled strips' look keys on (the note above) — it styles nothing by itself. `icon-own-ink`: an
// open pill's glyph goes bold but keeps the label's colour, not the pressed blue (globals.css — owner, 2026-11-17: "Grey everywhere").
export const PILL_REST = 'pill-rest border border-line-strong bg-background text-foreground hover:bg-muted active:bg-muted icon-own-ink'
// The ON look owns its hover and press too, so PILL_REST's `hover:bg-muted` beside it never lightens a selected pill.
export const PILL_ON = 'pill-on border border-transparent bg-line-strong text-foreground hover:bg-line-strong active:bg-line-strong icon-own-ink'
// `pill-open`: the same marker for the open state (the filled strips open a step deeper, with no edge).
export const PILL_OPEN = 'pill-open border border-line-strong bg-muted text-foreground icon-own-ink'
export const PILL_OPEN_ATTR = 'data-popup-open:border-line-strong data-popup-open:bg-muted data-popup-open:text-foreground'
/**
 * THE WELL (owner, 2026-11-17, "Grey everywhere" — mock r14 B, the one the owner saw): the category plate's subcategory panel,
 * the brand rail's and the model cascade's line panels — the field grey, as the search field and the filled strips are. Its PICK
 * is ui/segmented's selected pill: the canvas white WITH `shadow-sm`, because white on the field grey alone is ~1.1:1, no
 * visible selection (segmented.tsx has the measurement; it reverses, here, the 10-18 flat chosen chip that sat on a blue
 * tint). In dark, where the canvas is darker than the well, one step up (`line-strong`) and no shadow; a count on it lifts to
 * `muted-foreground` (the ink-4 count was 3.90:1 there). Resting items step down to the body grey, so the label steps too.
 * A dropdown opened from a well goes a step deeper (WELL_DEEP); where it becomes a phone sheet (white), its pick is the
 * selected grey instead (WELL_SHEET_PICK).
 */
export const WELL = 'bg-muted'
export const WELL_DEEP = 'bg-secondary'
export const WELL_PICK = 'bg-background text-foreground shadow-sm dark:bg-line-strong dark:shadow-none dark:[&_.text-ink-4]:text-muted-foreground'
// A resting item hovers one step off the well, never toward the pick (the gate, 2026-11-17: a whitish hover read as the pick):
// `--secondary` is darker than the well in light and between the well and the pick in dark (#262626 < #303030 < #414141).
export const WELL_ITEM = 'text-body hover:bg-secondary hover:text-foreground'
// …and in a dropdown opened from a well, which IS `--secondary` (WELL_DEEP), a row hovers back up to the well's grey.
export const WELL_MENU_ITEM = 'text-body hover:bg-muted hover:text-foreground'
export const WELL_SHEET_PICK = 'max-sm:bg-line-strong max-sm:shadow-none'
/**
 * A picked ROW or card (a report reason, a mark-sold buyer, a selected dashboard row): the selected grey with an ink label; its
 * secondary text lifts to `ink-3`, because `muted-foreground` and `ink-4` fall under AA on it (light #d6d6d6: 4.46:1 and less;
 * dark #414141: ink-4 3.90:1). Lifted: light ink-3 #3d3d3d ≈ 8:1, dark ink-3 #d4d4d4 6.89:1 (measured 2026-11-17; owner:
 * "Grey everywhere").
 */
export const SELECTED_ROW = 'border-line-strong bg-line-strong text-foreground [&_.text-muted-foreground]:text-ink-3 [&_.text-ink-4]:text-ink-3'
