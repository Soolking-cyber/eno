
/**
 * ⛔ THE FLOATING MAP PILL (owner-approved 2026-11-15 (build 8), cook r08 rentals — /c/rentals and the rentals feed, below `sm`).
 * Once the page's head has scrolled away, the page's EXISTING one-tap Map control leaves its row and floats as ONE ink pill,
 * bottom centre, 16px above the tab bar, so the map is one thumb tap away anywhere in a one-column list of 5,000 homes (Airbnb's
 * move). Nothing is added: the same element, its words and its target, restyled —
 *   · /c/rentals: the strip's own Map link (category-map-chip.tsx, the row's third chip in the head) — "Map" / "Bản đồ";
 *   · the feed: the results line's own "Map view" toggle (explorer-toolbar.tsx ViewToggles; the desktop row's, `max-sm:hidden`
 *     until now) — its name shown in words, "Map view" / "Bản đồ". The phone's view pick keeps every view as before.
 * It reverses, on those two pages: back-to-top.tsx "⛔ NO FLOATERS ON A PHONE'S BROWSE PAGES" (owner, 2026-10-18), for this one
 * control; category-map-chip.tsx "the strip's chip look" and "THE ICON IS INK" (once floated it is the ink FILL with the
 * page-colour glyph); listings-explorer.tsx ViewChoices "a phone gets the ONE view pill instead" (for the Map toggle).
 *
 * HOW, with no measuring and no script moving anything:
 *   · the HOST (PinnedStrip on /c/rentals, ViewChoices' toggle box on the feed) is `group/mapfloat` and renders
 *     `data-map-float` (mapFloatHost): absent while the head is on screen — the control is where it always was — and once the
 *     head is past the top of the screen (src/hooks/use-scrolled-past.ts, one IntersectionObserver) "shown" or "hidden";
 *   · ⛔ IT RIDES THE TAB BAR, ALL THE WAY (the blind critics marked the mock's always-on pill BROKEN: over the next card's
 *     price row, the photo's pips and its watermark): "shown" while the bars show (a scroll up, or a page at rest after one),
 *     "hidden" while they are away (a scroll down — the reader is reading the cards). The same useHideOnScroll signal the tab
 *     bar and the header follow; the owner's 2026-09-25 rule for the back-to-top chevron ("shows ONLY while the user scrolls
 *     UP") for the same reason. Hidden = faded, 16px lower, no pointer — but still in the tab order: focus brings it back
 *     (`focus-visible:`), as it brings the tab bar back (mobile-nav.tsx);
 *   · the reveal eases in with the bar (250ms ease-out, the bar's own); the hide and the jump out of the row are instant — the
 *     transition is declared only on "shown", so a pill leaving the row never fades out on screen;
 *   · `z-sticky`, page chrome: over the cards, UNDER the popup scrims (40) and every overlay (50), so an open sheet or select
 *     dims it with the page — no per-popup stand-down (the document-level `:has()` those would need is banned, design-lint).
 *     Gone while the keyboard is up (`html.kb-open`, the tab bar's own rule), the voice concierge is open, or in the app sheet;
 * ⚠️ THE ONE MOVE IT COSTS: on /c/rentals the link leaves the pinned row, so the district chips after it close up by one chip as
 * the head scrolls away and open again when it comes back — measured on a static probe at 390×844, 0.0017 of layout shift per
 * crossing (the pill itself, fixed, scores nothing). On the feed the toggle was `display:none` on a phone, so nothing moves.
 * From `sm` none of it applies: every class is `max-sm:`.
 */
export const MAP_FLOAT_HOST = 'group/mapfloat'

/** The floated look (all `max-sm:` and keyed on the host's `data-map-float`), on top of the control's own classes. */
export const MAP_FLOAT = [
  'max-sm:group-data-[map-float]/mapfloat:fixed',
  'max-sm:group-data-[map-float]/mapfloat:inset-x-0',
  'max-sm:group-data-[map-float]/mapfloat:mx-auto',
  'max-sm:group-data-[map-float]/mapfloat:w-fit',
  'max-sm:group-data-[map-float]/mapfloat:bottom-[calc(4.5rem+var(--tabbar-inset))]',
  'max-sm:group-data-[map-float]/mapfloat:z-sticky',
  'max-sm:group-data-[map-float]/mapfloat:inline-flex',
  'max-sm:group-data-[map-float]/mapfloat:items-center',
  'max-sm:group-data-[map-float]/mapfloat:justify-center',
  'max-sm:group-data-[map-float]/mapfloat:gap-2',
  'max-sm:group-data-[map-float]/mapfloat:h-12',
  'max-sm:group-data-[map-float]/mapfloat:min-h-12',
  'max-sm:group-data-[map-float]/mapfloat:pl-4.5',
  'max-sm:group-data-[map-float]/mapfloat:pr-5',
  'max-sm:group-data-[map-float]/mapfloat:py-0',
  'max-sm:group-data-[map-float]/mapfloat:rounded-full',
  'max-sm:group-data-[map-float]/mapfloat:border-0',
  'max-sm:group-data-[map-float]/mapfloat:bg-foreground',
  'max-sm:group-data-[map-float]/mapfloat:text-background',
  'max-sm:group-data-[map-float]/mapfloat:text-base',
  'max-sm:group-data-[map-float]/mapfloat:leading-5',
  'max-sm:group-data-[map-float]/mapfloat:font-bold',
  'max-sm:group-data-[map-float]/mapfloat:whitespace-nowrap',
  'max-sm:group-data-[map-float]/mapfloat:shadow-search',
  'max-sm:group-data-[map-float]/mapfloat:[&_svg]:size-5',
  'max-sm:group-data-[map-float]/mapfloat:hover:bg-foreground',
  'max-sm:group-data-[map-float]/mapfloat:hover:text-background',
  'max-sm:group-data-[map-float]/mapfloat:active:bg-foreground',
  'max-sm:group-data-[map-float]/mapfloat:active:text-background',
  'max-sm:group-data-[map-float]/mapfloat:active:scale-[0.96]',
  // The keyboard, the voice concierge's window and the app's page sheet own the screen's foot (back-to-top.tsx's three).
  'max-sm:[html.kb-open_&]:group-data-[map-float]/mapfloat:hidden',
  'max-sm:[html[data-concierge]_&]:group-data-[map-float]/mapfloat:hidden',
  'max-sm:[html.app-sheet_&]:group-data-[map-float]/mapfloat:hidden',
  // Shown: eases in with the tab bar.
  'max-sm:group-data-[map-float=shown]/mapfloat:transition-[opacity,translate,scale]',
  'max-sm:group-data-[map-float=shown]/mapfloat:duration-[250ms]',
  'max-sm:group-data-[map-float=shown]/mapfloat:ease-out',
  'max-sm:group-data-[map-float=shown]/mapfloat:motion-reduce:transition-none',
  // Hidden with the bars: faded, 16px lower, no pointer; focus brings it back.
  'max-sm:group-data-[map-float=hidden]/mapfloat:translate-y-4',
  'max-sm:group-data-[map-float=hidden]/mapfloat:opacity-0',
  'max-sm:group-data-[map-float=hidden]/mapfloat:pointer-events-none',
  'max-sm:group-data-[map-float=hidden]/mapfloat:focus-visible:translate-y-0',
  'max-sm:group-data-[map-float=hidden]/mapfloat:focus-visible:opacity-100',
  'max-sm:group-data-[map-float=hidden]/mapfloat:focus-visible:pointer-events-auto',
].join(' ')

/** A label that shows only while floated (the feed's toggle is icon-only in its row): `hidden` everywhere else. */
export const MAP_FLOAT_LABEL = 'hidden max-sm:group-data-[map-float]/mapfloat:inline'

/**
 * The host's attributes: `data-map-float` once the head is `away` ("hidden" while the bars are, "shown" otherwise). Nothing
 * until then, so the server HTML and the first client render are the same. (It also lifted the pill 5rem over the renters'
 * availability-check basket pill until that feature was removed, 2026-11-25.)
 */
export function mapFloatHost(away: boolean, barsHidden: boolean): { 'data-map-float'?: 'shown' | 'hidden' } {
  if (!away) return {}
  return { 'data-map-float': barsHidden ? 'hidden' : 'shown' }
}
