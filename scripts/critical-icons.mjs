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
 *
 * ⛔ AND THE DERIVATION MUST COVER **BOTH EDITIONS**, WHICH IT DID NOT UNTIL 2026-08-17. The four
 * routes above were all measured on eno.vn, and one sprite partition serves both deployments — so
 * anything above the fold ONLY on eno.forum was invisible to the measurement and silently landed in
 * the deferred file. The desk tiles are exactly that case: `DESK_SHORTCUTS` is
 * `IS_SERVICES ? SERVICES_DESK_TILES : []` (src/lib/taxonomy.ts), so on the marketplace the two
 * tiles do not exist to be measured. Owner, 2026-08-17: "in categories icon essential pack add
 * evisa and trip planner icons so they dont load late".
 * ⚠️ Re-measured on the LIVE eno.forum home, 412x915, 2.5 s after load: 27 glyphs in the initial
 * DOM, of which EXACTLY TWO came from the deferred file — `Stamp` and `CalendarDays`. Everything
 * else that page paints was already critical, so this is the whole gap, not a sample of it.
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
  // ⛔ SERVICES EDITION, ABOVE THE FOLD — see the note on both-edition derivation above. These are
  // the two `DESK_SHORTCUTS` tiles on eno.forum's home page (`Stamp` = e-Visa, `CalendarDays` =
  // Trip planner, src/lib/edition-services-copy.ts). They cost eno.vn bytes it does not paint,
  // which is the accepted price of one shared partition across two deployments — and it is small:
  // two glyphs against the 5.9-7.3s late-arrival this file exists to prevent.
  'Stamp', 'CalendarDays',
  /**
   * ⛔ RE-DERIVED 2026-09-06, AND THE PARTITION HAD LEAKED ON THE BUSIEST PAGE OF ALL. Measured on
   * the LIVE home page: 44 glyphs came from the core file and exactly TWO came from the deferred
   * one — `Pause` and `SupportDialog` — and those two cost the full **161 KB** of
   * `glyphs-rest.svg`, the single largest resource on the page, on a connection this audience pays
   * for by the megabyte. The file's own comment above said the deferred sprite is "never fetched on
   * home". It was, on every visit, for two icons.
   *
   * How they got there is worth keeping, because both are the same mistake:
   *  · `Pause` — `Play` was critical from day one, but a play control becomes a PAUSE control the
   *    moment the clip runs, and the feed autoplays. The pair was split across the two files.
   *  · `SupportDialog` — the floating help bubble is always mounted on the home page. It was never
   *    in the derivation because the original four routes were sampled before it shipped.
   *
   * `ArrowDown` / `ArrowUp` / `Info` came out of the same re-derivation. They are cheap and they
   * are painted on arrival, so they belong here by the same rule as everything above.
   */
  'Pause', 'SupportDialog', 'ArrowDown', 'ArrowUp', 'Info',
]

/** Measured so a later reader can tell whether the split still earns its complexity. */
export const CRITICAL_MEASUREMENT = {
  derivedOn: '2026-09-06',
  /**
   * ⚠️ FIVE ROUTES ACROSS BOTH EDITIONS, not four on one — the 2026-08-17 note above records why a
   * marketplace-only derivation silently deferred the forum's above-the-fold tiles.
   */
  routes: ['/', '/listings/<id>', '/c/electronics', '/?q=iphone', 'eno.forum /'],
  symbolsPerRoute: { home: 23, pdp: 20, category: 13, search: 22, forumHome: 21 },
  unionSymbols: 34,
  totalGlyphs: 243,
  /**
   * ⚠️ THE UNION IS SMALLER THAN THE LIST, AND NOTHING WAS REMOVED ON THAT BASIS. Five routes
   * sampled signed-out at one moment cannot prove a glyph is never above the fold — `Plus`,
   * `Star` and `Eye` are all plausible in states this sweep did not enter. A wrong partition costs
   * one request and never a blank icon, so the asymmetry is deliberate: add what is measured,
   * remove only with evidence that it is unreachable on first paint.
   */
  note: 'additive re-derivation; entries are never dropped on a single sweep',
}
