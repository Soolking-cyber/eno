/**
 * THE GLYPHS THAT MUST NOT ARRIVE LATE — the critical half of the icon sprite.
 *
 * ⛔ WHY THIS FILE EXISTS, AND IT IS A REGRESSION I SHIPPED. On 2026-08-14 the 243-glyph icon set
 * moved out of a 626 KB JS chunk into ONE external SVG sprite drawn with `<use>`. That removed
 * 169 KB gzip of JavaScript from every page and was the right move — but it shipped all 486 symbols
 * in a single 185 KB file, and an external `<use>` target is fetched at Chrome's `Low` priority.
 * Measured on the 1.6 Mbps / 4x-CPU profile the audience actually has: the sprite does not finish
 * until **5.9–7.3 s**, and at 2.2 s there are **310 `<use>` elements with a zero-size box** — the
 * bottom nav renders as five bare text labels and cards have no heart or location glyph, while the
 * text and the photographs are fully painted. The icons were verified to RENDER; nobody checked
 * WHEN. This file is the fix.
 *
 * ⚠️ THE LIST IS MEASURED, NOT CURATED. It is the union of every `#symbol` id referenced by the
 * initial DOM of the four highest-traffic routes — home, a listing page, a category page and a
 * search result — on a 412x915 mobile viewport, 2.5 s after DOMContentLoaded. 39 glyphs of 243.
 * Re-derive it rather than editing it by hand; a guessed list drifts and the drift is invisible
 * until someone profiles again:
 *
 *   const ids = [...new Set([...document.querySelectorAll('use')]
 *     .map((u) => (u.getAttribute('href') || '').split('#')[1]).filter(Boolean))]
 *   // collect per route, union them, strip the -r / -o weight suffix
 *
 * ⚠️ A WRONG PARTITION COSTS ONE REQUEST, NEVER A BLANK ICON — that property is deliberate and it
 * is why this is safe to get slightly wrong. `gen-icons.mjs` writes each glyph's OWN sprite URL
 * into its component, so a glyph that should have been critical still renders; it just arrives with
 * the second file. There is no lookup that can miss and no fallback that can fail. Do not
 * "optimise" that into a shared default.
 *
 * ⚠️ ADDING TO THIS LIST IS NOT FREE. Every entry is bytes on the critical path of every page. If
 * an icon is only ever seen after an interaction — inside a dialog, a menu, the post wizard, the
 * dashboard — it belongs in the deferred file, whatever it costs in tidiness.
 */
export const CRITICAL_GLYPHS = [
  'AlertTriangle', 'ArrowRight', 'ArrowUpDown', 'BadgeCheck', 'Bell', 'Building2',
  'ChevronDown', 'ChevronLeftIcon', 'ChevronRight', 'ChevronRightIcon', 'ChevronUp',
  'ChevronsUpDown', 'Clock', 'Coins', 'Compass', 'Eye', 'Flag', 'Heart', 'Images',
  'LayoutGrid', 'Map', 'MapPin', 'Megaphone', 'MessageCircle', 'MessageSquare', 'Play',
  'Plus', 'Rows3', 'Search', 'Share2', 'ShieldCheck', 'Sparkles', 'Star', 'Tag',
  'TrendingUp', 'User', 'VolumeX', 'X', 'Zap',
]

/** Measured 2026-08-14 so a later reader can tell whether the split still earns its complexity. */
export const CRITICAL_MEASUREMENT = {
  derivedOn: '2026-08-14',
  routes: ['/', '/listings/<id>', '/c/electronics', '/?q=iphone'],
  symbolsPerRoute: { home: 58, pdp: 48, category: 36, search: 52 },
  unionSymbols: 78,
  totalGlyphs: 243,
}
