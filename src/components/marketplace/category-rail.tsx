'use client'

import { useEffect, useMemo } from 'react'
import { useLanguage, Tr, useTr } from '@/context/language-context'
import { detectContentLang } from '@/lib/detect-lang'
import { CategoryIcon } from './category-icons'
import { CategoryTileGlyph } from './category-art'
import { SUBCATEGORIES } from '@/lib/subcategories'
import { CountChip, optionCount, railDimension } from './count-chip'
import { MoreOverflow } from './more-overflow'
import { Button } from '@/components/ui/button'
import { STROKE_UI } from '@/lib/icon-tokens'
import { useScrollArrows, ScrollArrows } from '@/hooks/use-scroll-arrows'
import { cn } from '@/lib/utils'
import type { SerializedCategory } from '@/lib/types'
// Type only — erased at compile time, so the client bundle never reaches for the module's
// Prisma/`server-only` chain. It is imported rather than restated so the rail's prop and the
// payload the route ships are literally the same type.
import type { FacetCounts } from '@/lib/facet-counts'
import { scrollBehavior } from '@/lib/reduced-motion'

/**
 * A TILE LABEL, WHICH IS `Tr` PLUS ONE SUBSTITUTION: ASCII hyphens become NON-BREAKING ones.
 *
 * ⚠️ A HYPHEN IS A LINE-BREAK OPPORTUNITY, AND IN A 4.75rem COLUMN IT IS USUALLY THE WRONG ONE.
 * Owner, 2026-08-17, on the "Vietnam e-Visa" tile: "move e below vietnam on top and e-Visa below".
 * It broke as "Vietnam e-" / "Visa", because the browser takes the LAST opportunity that fits and
 * the hyphen sits further along the line than the space. U+2011 is not an opportunity at all, so
 * the space becomes the only place to wrap — the reading the owner asked for, and the right one for
 * any hyphenated label rather than for this one string.
 *
 * ⛔ THE SUBSTITUTION HAPPENS AFTER TRANSLATION, NOT BEFORE, AND THE ORDER IS THE WHOLE POINT.
 * `Tr` looks the string up in the machine-translation dictionary BY ITS TEXT. Feeding it a label
 * that already contains U+2011 would miss every prewarmed entry, so every hyphenated category name
 * would silently lose its translation in the nine languages that are not en/vi — trading a wrap
 * nobody dies from for a content regression. Translate first, then adjust the glyph.
 *
 * ⚠️ THE TAXONOMY KEEPS A PLAIN ASCII HYPHEN. The data still matches what anyone would type or
 * search for, and a U+2011 — invisible in a diff, easy to "correct" back — never has to survive in
 * a source file someone edits. This is presentation, so it lives at the render site.
 *
 * ⚠️ IT DOES NOT TOUCH `break-words` on the label, which stays for the case it was added for: a
 * single token longer than the tile. The two coexist. Wrapping each word in `whitespace-nowrap`
 * would have been the obvious alternative and it suppresses that fallback entirely.
 *
 * The `lang` wrapper mirrors `Tr` (WCAG 3.1.2) — an untranslated Vietnamese label on an English
 * page still gets voiced correctly.
 */
function TileLabel({ text }: { text?: string | null }) {
  const { lang } = useLanguage()
  const out = useTr(text).replace(/-/g, '\u2011')
  const cl = detectContentLang(out)
  return cl && cl !== lang ? <span lang={cl}>{out}</span> : <>{out}</>
}

// Line 1 of the search header. Large, flat category tiles (icon + name + live count, on the
// canvas — no background fill, matching the home grid) in one horizontally
// scrollable line. Tapping a category rolls its subcategories OUT to the right
// (pushing the categories after it further along); tapping it again collapses.
//
// The counts answer "how many results if I tap this, GIVEN everything else I have already
// chosen" — they are conditional, not global (src/lib/facet-counts.ts). Every one of them is
// optional: with no `facets` prop this renders exactly the countless strip it was before.
export function CategoryRail({
  categories,
  activeCategory,
  activeSubcategory,
  subcategoryCounts,
  facets,
  countsPending = false,
  onCategory,
  onSubcategory,
  intents,
  activeType,
  onIntent,
  shortcuts,
  onShortcut,
}: {
  categories: SerializedCategory[]
  activeCategory: string
  activeSubcategory: string
  subcategoryCounts: Record<string, number>
  /**
   * ⚠️ IS A NUMBER ON ITS WAY? Passed straight to every `CountChip` below so a chip whose count has
   * not landed reserves the width instead of rendering bare and growing when it does — the reflow
   * the owner reported as "revealing category subcateogory is gittery". The rail cannot work this
   * out for itself: an absent dimension looks identical whether the feed is mid-flight or the
   * payload simply has nothing to say, and only the explorer holds the query's fetching state.
   */
  countsPending?: boolean
  /**
   * Live chip counts from the feed response's `facets` key (src/lib/facet-counts.ts). Omit — or
   * pass `{}` — and the rail renders exactly as it did before counts existed.
   *
   * ⚠️ AN ABSENT DIMENSION IS "NOT COMPUTED", NEVER ZERO. `facets` is `{}` on a load-more page
   * (`offset > 0`), with `?facets=0`, and when the whole computation is shed under load or fails
   * — all three are all-or-nothing, whole-payload states (`return {}` in computeFacetCounts), not
   * per-dimension ones. Every count below flows through `optionCount`, which returns `undefined`
   * for a missing DIMENSION and `0` for a missing KEY inside a present one.
   *
   * ⚠️ THE CALLER MUST NOT OVERWRITE A COMPUTED PAYLOAD WITH AN EMPTY ONE. Keep the last
   * response that CARRIED facets (`if (Object.keys(d.facets ?? {}).length) setFacets(d.facets)`).
   * That is safe rather than stale because filters only ever change on a page-1 request, and
   * page 1 always computes facets — the only `offset > 0` fetch is load-more, which changes no
   * filter. Clobbering instead would blank every number the moment someone scrolls.
   *
   * ⚠️ REPLACE THE OBJECT WHOLESALE; NEVER MERGE IT DIMENSION BY DIMENSION. Which dimensions a
   * payload carries is a statement about the current filters (no `brand` outside a brand
   * category, no `model` before a brand is picked). Merging would keep a dimension the new
   * filters say should not exist and hand this rail a confident answer to a question nobody asked.
   *
   * ⚠️ AND DROP IT WHEN THE FILTERS CHANGE — THIS IS THE ONE OBLIGATION THE COMPONENT CANNOT TAKE
   * OVER. The payload carries no record of the filters that produced it, and this rail sees only
   * the category axes, so it cannot tell "counted under your current condition + price + district"
   * from "counted under the previous ones". The owner of the filters can: listings-explorer
   * already computes a `filterSig` and resets paging from it, and clearing `facets` on that same
   * signature change is the whole fix. `railDimension` below catches the gross case (a payload
   * keyed by another category's slugs) so a missed invalidation degrades to no numbers rather
   * than to wrong ones — but it cannot catch a scope change that keeps some of the same keys.
   */
  facets?: FacetCounts
  onCategory: (slug: string) => void
  onSubcategory: (slug: string) => void
  // Intent shortcuts (Free / Wanted) — appended after the categories so the results
  // rail matches the home grid, which shows these tiles alongside the categories.
  // They filter the listingType axis (not the category), highlighting when active.
  /**
   * eno's OWN products, pinned immediately after "All".
   *
   * ⚠️ THIS SLOT EXISTS SO THE RAIL CAN REPLACE THE TILE GRID WITHOUT SILENTLY DELETING A
   * MERCHANDISING BET. The grid pinned two tiles ahead of the demand order after a measurement
   * on 2026-07-28: `/` took 570 page views in a week and `/vietnam-evisa` took ZERO — they were
   * never unreachable, just unnamed. The grid's own comment warned that swapping it for this
   * rail "would have deleted the bet silently", which is exactly what a rail with no such slot
   * would have done. Position is preserved: ahead of the categories, not appended at the tail.
   */
  // ⚠️ `art` is the optional 3D tile artwork, supplied only by the aliased services module — see
  // ServicesTile in src/lib/edition-services-copy.ts for why the path lives on the tile.
  shortcuts?: { key: string; href: string; kind?: string; name: string; nameVi: string; icon: string; art?: string }[]
  onShortcut?: (s: { key: string; href: string; kind?: string }) => void
  intents?: { type: string; name: string; nameVi: string; icon: string }[]
  activeType?: string
  onIntent?: (type: string) => void
}) {
  const { lang, tr } = useLanguage()
  // Desktop ← / → arrows, same pair the home rails use (owner, 2026-07-22: "similar to
  // homepage category arrows"). This strip carries ~18 categories plus an expanded
  // subcategory grid, so it overflows at every desktop width — a mouse wheel only scrolls
  // vertically and the scrollbar is hidden, which left pointer users with no way to page it.
  // The hook's ref IS the rail element, so it also serves the scroll-active-into-view effect
  // below — one node, one ref.
  const { scrollerRef: railRef, canLeft, canRight, page, arrowTop } = useScrollArrows<HTMLDivElement>()

  // When a category is chosen, slide the rail so that category sits at the left edge
  // — the user immediately sees their pick with its subcategories rolled out beside it.
  useEffect(() => {
    // Only scroll when OPENING a category (bring it to the left). On close/clear
    // ('all') leave the scroll position untouched so the user keeps their place.
    if (activeCategory === 'all') return
    const container = railRef.current
    const el = container?.querySelector(`[data-cat="${activeCategory}"]`) as HTMLElement | null
    if (!container || !el) return
    // Scroll ONLY this rail (see brand-rail): el.scrollIntoView would also scroll the
    // document horizontally and clip the whole results view. Move scrollLeft instead.
    const left = container.scrollLeft + (el.getBoundingClientRect().left - container.getBoundingClientRect().left)
    container.scrollTo({ left, behavior: scrollBehavior() })
  }, [activeCategory])

  // The category dimension: counted with `category` (and its whole cascade) released, so
  // `values[slug]` is what tapping that tile returns and `all` is what tapping "All" returns.
  // `all` is legitimately LARGER than the visible tiles sum — rows in a category the taxonomy
  // does not list still come back when the rail is cleared — so it is rendered as its own number
  // and never as a total of what is on screen. (It is edition-scoped like every other base:
  // computeFacetCounts wraps each one in `scopedListingWhere`, which excludes the visa/trip desk
  // and THROWS rather than degrading — so "a category the taxonomy does not list" never means a
  // desk SKU counted into a marketplace rail.)
  //
  // ⚠️ THE TILES ARE THE ONE RAIL A STALE PAYLOAD CANNOT HURT, AND IT IS WORTH KNOWING WHY. The
  // `category` base RELEASES category, subcategory, brand, model, price and every attr_*/range_*
  // (releasedParams in src/lib/facet-counts.ts) — which is exactly the set a category tap clears —
  // so what is left is condition + area + type, none of which a category tap touches. These
  // numbers are therefore IDENTICAL before and after the tap: a payload held over from the
  // previous category is not stale here, it is the same answer. `railDimension` is still applied
  // for one rule everywhere; on this rail it is a no-op, because the dimension is seeded with all
  // of the taxonomy's slugs and can never miss them.
  const catDim = railDimension(facets?.category, categories.map((c) => c.slug))

  /**
   * ⚠️ ONE SUBCATEGORY SOURCE, AND `facets.subcategory` IS THE ONE THAT WON. The payload ships the
   * same numbers twice: the long-standing top-level `subcategoryCounts` / `categoryTotal` keys
   * this rail has always read, and `facets.subcategory`, which the route assembles FROM those two
   * (`subcategoryDimension(category, categoryTotal, subcategoryCounts)` in
   * src/app/api/listings/route.ts) over the identical facet base. They cannot disagree by
   * construction, so this is a preference order, not a second opinion — nothing is stacked and no
   * chip ever shows two numbers.
   *
   * `facets.subcategory` is preferred for two things the legacy pair cannot do:
   *  · IT IS ZERO-SEEDED from the taxonomy, so a subcategory with nothing in it reads an honest
   *    "0". The legacy map is groupBy output — a missing key there is indistinguishable from "the
   *    counts have not arrived yet", which is why it can only ever be rendered as `undefined`.
   *  · IT CARRIES `all`, which is the number the subcategory "All" chip needs. Reading
   *    `categoryTotal` for that would have meant a new prop for a value the payload already
   *    publishes here.
   *
   * ⚠️ THE LEGACY MAP IS KEPT AS THE FALLBACK, AND FOR RANKING IT IS THE SAFETY NET. The rail is
   * ORDERED by these counts (see `subs` below), and `subcategoryCounts` ships on EVERY page while
   * `facets` is `{}` for `offset > 0`. Ranking on the fallback chain means the order is computed
   * from the same numbers whichever key is present, so a load-more response cannot re-sort the
   * strip under a reader's finger even if a caller does clobber `facets` with `{}`. Display keeps
   * the same chain purely so a `?facets=0` payload renders precisely what it renders today.
   *
   * ⚠️ AND IT IS PUT THROUGH `railDimension` FIRST, WHICH IS WHAT STOPS A CATEGORY SWITCH PRINTING
   * A GRID OF ZEROS. `facets.subcategory` is seeded with the subcategory slugs of the category it
   * was computed FOR, so the payload held across a Vehicles → Electronics tap misses every
   * Electronics slug — and a miss inside a present dimension is a legitimate 0. Without the guard
   * every chip would read 0 (and rank as 0) until the feed answered. With it the rail falls
   * through to the legacy map, which has no keys for the new category either and therefore renders
   * exactly the numberless, taxonomy-ordered strip it renders today during that same beat.
   *
   * ⚠️ THAT LAST STEP RESTS ON SUBCATEGORY SLUGS BEING GLOBALLY UNIQUE, AND A REVIEWER WAS RIGHT
   * THAT AN UNSTATED ASSUMPTION IS NOT AN ARGUMENT — so it was measured rather than assumed: all
   * 101 subcategory slugs in src/lib/taxonomy.ts are distinct (101 occurrences, 101 distinct), and
   * the taxonomy suffixes the collisions on purpose ('car' vs 'car-rental', 'house' vs
   * 'house-rental'). The legacy map for the previous category therefore cannot key a slug of this
   * one. If a future taxonomy edit reuses a slug across two categories, this fallback starts
   * printing the other category's number on a chip during that beat.
   */
  const subDim = railDimension(facets?.subcategory, (SUBCATEGORIES[activeCategory] ?? []).map((s) => s.slug))
  // ⚠️ BOTH LOOKUPS GO THROUGH `Object.hasOwn`, NOT A BARE INDEX. The first version wrote
  // `subDim.values[slug] ?? 0` here while the sibling helper in count-chip.tsx was being hardened
  // against exactly that — two reviewers caught the inconsistency inside one diff. Neither record
  // is a Map: `values` is built with Object.fromEntries and `subcategoryCounts` is parsed JSON, so
  // both carry Object.prototype and a slug named `constructor` or `toString` indexes to a
  // FUNCTION, which `??` does not catch. `subCount` would merely clamp it to 0, but `subRank`
  // feeds it to `b - a`, and a comparator returning NaN makes the sort order implementation-
  // defined — a rail that reshuffles for no visible reason. No such slug exists today; the point
  // is that the rule was written in this change and must not be skipped in it.
  const legacySubCount = (slug: string): number | undefined =>
    Object.hasOwn(subcategoryCounts, slug) ? subcategoryCounts[slug] : undefined
  const subCount = (slug: string): number | undefined => optionCount(subDim, slug) ?? legacySubCount(slug)
  const subRank = (slug: string) => subCount(slug) ?? 0

  /**
   * ⛔ THE ORDER IS DECIDED ONCE PER CATEGORY AND THEN FROZEN. Owner, 2026-08-29: "the jump is still
   * there when subcategory first opens its in one place once fetches amount of products available
   * it jumps to another place so annoying".
   *
   * Measured on production: at +300ms the row read Phones, Laptops, TVs; at +900ms — the moment the
   * feed answered — it read Cases & covers, Phones, Audio. The chips never MOVED, they REORDERED, so
   * the one being reached for was somewhere else by the time the finger landed. `subRank` falls back
   * to 0 for an unknown count, which quietly means "taxonomy order now, ranked order in a second".
   *
   * ⚠️ THIS IS THE FAILURE brand-rail.tsx REFUSES TO HAVE, and its note is the reasoning: "the rail
   * would paint in one order, sit still long enough to be reached for, and then re-order under the
   * finger". It solves it by ranking on a count that arrives WITH the tiles. This row has no such
   * count, so it freezes instead: whatever order the first render of a category produces is the
   * order that category keeps until the visitor leaves it.
   *
   * ⛔ HIDING THE ROW UNTIL THE COUNTS LAND WAS TRIED FIRST AND IS WORSE. Skeletons in these cells
   * removed the reorder, but they also made the primary navigation untappable for as long as the
   * feed takes — up to the 2.5s `semanticRank` is allowed. Two existing tests say so out loud: a
   * stale or empty payload must leave the chips PRESENT and merely numberless, never absent.
   * ⚠️ THE ACCEPTED COST, STATED: on a cold open the cut (seven chips plus "+N") is made on taxonomy
   * order rather than on the counts, which brand-rail's rule says a cutting rail should avoid. It is
   * the lesser evil and it is not a regression — the previous code cut on taxonomy order in that
   * same window too. It simply also re-sorted a second later, which is the part being removed.
   */
  const frozenOrder = useMemo(
    () => [...(SUBCATEGORIES[activeCategory] ?? [])].sort((a, b) => subRank(b.slug) - subRank(a.slug)).map((sub) => sub.slug),
    /**
     * ⛔ `activeCategory` ALONE, AND THE MISSING DEPENDENCY IS THE ENTIRE MECHANISM. This memo reads
     * `subRank`, which closes over the counts — so recomputing when THOSE change is precisely the
     * re-sort being removed. Freezing means capturing the ranking at the moment a category opens
     * and keeping it until a different category is opened, which is what this dependency list says.
     * ⚠️ A `useRef` written during render was the first version and a reviewer was right to reject
     * it: React may discard a render (an interrupted transition, Suspense, StrictMode's double
     * invoke) and a ref write is not rolled back, so a render begun with empty counts and abandoned
     * would still have recorded taxonomy order. It also ran during SSR. A memo has neither problem.
     * ⚠️ NO `eslint-disable` HERE: the rule is not enabled as an error in this repo, so the
     * directive reported as UNUSED — and a stale disable is how a red pipeline starts. The reason
     * the list is short is written above instead, where it cannot rot into a lint warning.
     */
    [activeCategory],
  )

  // `.press` (icon-language §8): the browse rail's tiles press with the same spring as the
  // home grid's — one tile, one feel, wherever the grid appears.
  /**
   * ⛔ A TWO-ROW SWIPEABLE GRID, NOT A ONE-ROW STRIP (owner, 2026-09-18, from the 58 study: "2 rows
   * of catogories rest reveal upon swipe", and on mobile "bigger … big top 4 categories rest reveal
   * in 3 rows"). 58's home opens on a paged icon grid and that is what this now is.
   *
   * ONE grid expresses both shapes, with no duplicated DOM and no JS breakpoint:
   *   mobile  — 6 unit rows; the first four tiles span 2 cols × 3 rows (→ 2×2 extra-large, one
   *             screenful), every other tile spans 1 col × 2 rows (→ 3 rows of 4 per swipe).
   *   sm+     — 2 rows, every tile one cell, so 8 COLUMNS × 2 ROWS = 16 tiles per screen; the rest
   *             are a swipe away. (Measured at 1280: 16 of the 18 tiles fully visible, 1.38 pages.
   *             An earlier version of this line said "8 per screen", which is the column count — a
   *             reviewer read it as the tile count, and the tile count is what a reader wants.)
   * `grid-flow-col` fills column by column, which is what makes the overflow horizontal.
   */
  // `h-full justify-center` so a tile FILLS the cell it spans instead of sitting at the top of it —
  // measured in the browser: without it an extra-large tile drew 93px of content inside a 134px cell
  // and the grid read as four icons adrift in whitespace.
  const tileCls = 'press group flex h-full w-full snap-start flex-col items-center justify-center gap-1.5 py-1 text-center cursor-pointer select-none'
  const XL_TILE = 'col-span-2 row-span-3 md:col-span-1 md:row-span-1'
  const SM_TILE = 'row-span-2 md:row-span-1'
  /** Every tile is one cell when the rail is short — see `shortRail` below. */
  const FLAT_TILE = 'row-span-1'
  // The first four tiles in render order are the big ones on mobile: All, then whatever follows it
  // (eno.forum's two desk shortcuts, otherwise the top categories by demand).
  const shortcutCount = shortcuts?.length ?? 0
  const leadTiles = 1 + shortcutCount + categories.length
  const totalTiles = leadTiles + (intents?.length ?? 0)
  /**
   * ⛔ A SHORT RAIL DROPS THE SIX-ROW SHAPE ENTIRELY, AND THAT IS THE FIX FOR A HOLE THREE REVIEWERS
   * KEPT FINDING IN DIFFERENT ARITHMETIC. `grid-rows-6` with `row-span-2`/`row-span-3` tiles only
   * looks right when there are enough tiles to fill the columns; with a handful, the last column gets
   * ONE tile and four empty row tracks beside it. The tracks do NOT collapse — `grid-rows-6` is
   * `repeat(6, minmax(0,1fr))` and the full column has already stretched them (measured: 295px tall
   * either way) — so it reads as a void on the FIRST screen, not as the end of a list.
   *
   * ⚠️ REACHABLE, NOT THEORETICAL: the home page's `getData()` catch returns `categories: []`, so any
   * DB failure renders "All" plus the three intent tiles. Below 9 tiles the whole rail fits one
   * screen anyway, so it is laid out as a plain 2-row grid where every tile is one cell: 4 tiles fill
   * two columns, 6 fill three, and the worst case is ONE empty cell at the end instead of a
   * four-row gap. Above that the mobile 2-big-rows + 3-small-rows shape the owner asked for applies.
   *
   * ⚠️ THE LONG RAIL STILL ENDS ON A PART-FILLED COLUMN FOR TWO COUNTS IN EVERY THREE, and that is
   * accepted rather than unnoticed: smalls pack 3 to a column, so the tail is short unless their
   * count divides by 3 (today: 21 tiles → 4 XL + 17 smalls → the last column holds 2). It sits at the
   * far END of the scroll, where a part-filled column reads as the list ending — unlike the short
   * rail, where the same gap was on the first screen. A test pins the property that only the FINAL
   * column can ever be short (category-rail.grid.test.tsx).
   */
  const shortRail = totalTiles <= 8
  /**
   * ⚠️ XL TILES COME IN EVEN NUMBERS, BECAUSE TWO OF THEM FILL ONE TWO-COLUMN BLOCK. An XL tile is
   * `col-span-2 row-span-3`, so a pair stacks rows 1-3 and 4-6 across the SAME two columns (an
   * earlier note here said "one column holds two", which a reviewer rightly called wrong even though
   * the even-count conclusion holds). An odd count leaves the bottom half of that block empty and a
   * `row-span-2` tile cannot fill it — it needs two consecutive free rows and one is left.
   */
  const bigCount = shortRail ? 0 : 4
  const bigAt = (i: number) => i < bigCount
  const spanAt = (i: number) => (shortRail ? FLAT_TILE : bigAt(i) ? XL_TILE : SM_TILE)
  const glyphBoxCls = (i: number) => cn('flex items-center justify-center', bigAt(i) ? 'h-16 md:h-11' : 'h-11')
  const glyphSizeAt = (i: number) => (bigAt(i) ? 'h-16 w-16 md:h-11 md:w-11' : '')
  /**
   * Is one of eno's own product tiles the current view? Only a `filter` shortcut can be — a `route`
   * one navigates away, so it is never "on" while this rail is showing.
   * ⚠️ READ OUT OF THE HREF rather than duplicated as a constant: the href is the single place the
   * filter is already written down, so a shortcut that changes what it points at cannot drift out
   * of sync with what lights up.
   */
  const shortcutActive = (sc: { kind?: string; href: string }) => {
    if (sc.kind !== 'filter') return false
    const q = new URLSearchParams(sc.href.split('?')[1] ?? '')
    const cat = q.get('category')
    const sub = q.get('subcategory')
    return (!cat || cat === activeCategory) && (!sub || sub === activeSubcategory)
  }

  const iconCls = (active: boolean) =>
    cn('h-11 w-11 transition-transform duration-200 group-hover:scale-110', active ? 'text-accent-foreground' : 'text-body group-hover:text-accent-foreground')
  // ⚠️ w-full + break-words. The tile is a FIXED 4.75rem column, but this span is a flex
  // item under `items-center`, so its width is fit-content — a long label (or any label
  // once OS text scaling is on) grew WIDER than the tile and spilled over its neighbours;
  // line-clamp's overflow:hidden can't help, because it's the element, not its content,
  // that overflows. w-full pins it to the tile so the clamp wraps + truncates inside it,
  // and break-words handles a single unbreakable token (a long brand/category word).
  // ⚠️ `hyphens-auto` SITS BEFORE `break-words` IN THE BROWSER'S ORDER OF LAST RESORTS, and that is
  // why it is worth adding: given a token wider than the tile, the browser hyphenates at a real
  // syllable boundary before it resorts to slicing mid-word. Under OS text scaling the app showed
  // "Electroni / cs" (owner's screenshot from inside the Capacitor app, 2026-09-06); with
  // hyphenation the same tile reads "Electron- / ics". `break-words` STAYS as the floor for a
  // token no dictionary can break — a brand name, a slug.
  // ⚠️ It needs the element's language to be known, which `TileLabel` already sets whenever the
  // content language differs from the page's (WCAG 3.1.2) — so the hyphenation follows the word,
  // not the interface.
  const nameCls = (active: boolean) =>
    cn('line-clamp-2 w-full hyphens-auto break-words text-xs font-bold leading-tight transition-colors', active ? 'text-accent-foreground' : 'text-foreground group-hover:text-accent-foreground')



  const subChip = (active: boolean) =>
    cn('w-full shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1 text-left text-sm font-semibold transition-colors cursor-pointer', active ? 'bg-card text-accent-foreground shadow-sm' : 'text-body hover:bg-card/70 hover:text-accent-foreground')

  // ⛔ THE SUBCATEGORY PANEL IS COMPUTED ONCE FOR THE ACTIVE CATEGORY AND RENDERED BELOW THE GRID.
  // It used to be spliced INTO the rail, to the right of the active tile — impossible now that the
  // tiles are a two-row swipeable grid (owner, 2026-09-18, 58's icon-grid layout): a panel inside
  // the grid would become a grid cell and break the rows. Same chips, same order, same overflow.
  // Order subcategories by how many listings they hold (most first); ties keep
  // taxonomy order. Empty counts (pre-load) leave the canonical order.
  // (`subRank` is the reconciled source above — the same numbers whichever key the payload
  // carried, so switching to it changed no order, only where the figure is read from.)
  /**
   * ⚠️ RANK ONCE, THEN REPLAY. The first render for a category sorts on whatever counts exist
   * at that instant and records the result; every later render of the SAME category replays
   * that recorded order, so a payload arriving mid-view cannot reshuffle the chips under a
   * finger. Changing category clears it (above), because a new category is a new question.
   */
  /**
   * ⚠️ REPLAY THE FROZEN ORDER. A slug the memo never saw — only reachable if `SUBCATEGORIES`
   * changed under the same category — keeps its taxonomy position instead of collapsing into
   * one undifferentiated bucket at the end, which a reviewer pointed out a flat fallback does.
   */
  /**
   * ⛔ AND ONLY FOR A CATEGORY THIS EDITION ACTUALLY SHOWS. These chips used to live INSIDE
   * `categories.map`, where that was implicit — the panel could not render for a category the rail
   * had filtered out. Hoisting them below the grid lost the guard: `?category=<slug>` in the URL
   * would open the chips for a category belonging to the OTHER edition. Three reviewers, separately.
   */
  const subs = categories.some((c) => c.slug === activeCategory)
    ? [...(SUBCATEGORIES[activeCategory] ?? [])]
        .map((sub, i) => ({ sub, at: frozenOrder.indexOf(sub.slug), i }))
        .sort((a, b) => (a.at < 0 ? frozenOrder.length + a.i : a.at) - (b.at < 0 ? frozenOrder.length + b.i : b.at))
        .map((e) => e.sub)
    : []
  // 3×3 grid (9 cells): "All" + up to 8 subcats. All+8 fills it exactly, so only
  // collapse into a "More" cell when there are MORE than 8 — at ≤8 show them all.
  // (auto-adjusts as the listing counts above re-rank them.)
  const subsNeedMore = subs.length > 8
  // ⚠️ THE ACTIVE SUBCATEGORY IS PROMOTED INTO THE VISIBLE SET — IT IS NOT LEFT WHEREVER ITS
  // LISTING COUNT PUT IT. A positional slice(0, 7) knows nothing about the selection, so
  // picking the 9th-ranked subcategory filtered the results and then folded the chosen chip
  // away inside +N — leaving NOTHING in the grid lit. Not the chip you picked (hidden), and
  // not "All" either, since that one lights on `activeSubcategory === 'all'` and something
  // else is now selected. So the results were filtered while the strip showed no selection at
  // all, and the only way to clear a filter you cannot see is to guess it is in the overflow
  // menu and reopen it.
  // (It only bites categories with ≥9 subcategories — below that `subsNeedMore` is false and
  // nothing is hidden in the first place.) brand-rail.tsx already does this for models; this
  // is the same fix one rail over, written the same way on purpose so they stay comparable.
  //
  // The cost when it fires, stated exactly because it is visible: All + 8 chips + More = 10
  // cells, and the grid is 3 rows column-filled, so the columns become [All, s0, s1] [s2, s3,
  // s4] [s5, s6, promoted] [More] — a FOURTH column holding the More control on its own. The
  // grid is therefore one column wider for as long as a low-ranked subcategory is selected,
  // which pushes the categories to its right further along the rail. That is accepted: the
  // strip already scrolls sideways, the shift lands after the tap that caused it, and it is
  // the same trade brand-rail already makes. A filter the user cannot see is the worse one.
  // Note `activeSubcategory === 'all'` promotes nothing (no sub carries that slug), so the
  // common case — nothing selected — is byte-for-byte the old layout.
  // The +N badge stays honest through all of this because MoreOverflow is handed
  // `overflowSubs.length`, the real array, never a `subs.length - 7` arithmetic guess.
  const visibleSubs = subsNeedMore ? subs.filter((s, i) => i < 7 || s.slug === activeSubcategory) : subs
  const overflowSubs = subsNeedMore ? subs.filter((s, i) => i >= 7 && s.slug !== activeSubcategory) : []

  return (
    // `relative` anchors the arrows, which sit OUTSIDE the scroller's edges (-left-8).
    <div className="relative">
    <div
      ref={railRef}
      // overscroll-x-contain: a sideways flick that hits either end must not CHAIN out to an
      // ancestor scroller / the iOS WebView's swipe-back. It does not (and cannot) stop a swipe
      // that STARTS in the system edge gutter — see the note on RAIL_SCROLLER in shelf.tsx.
      // ⛔ NO EDGE-FADE MASK HERE. `railEdgeMask` used to spread a linear-gradient mask onto this
      // scroller so the tile at the cut edge dissolved instead of being sliced. Owner removed it
      // 2026-08-26: *"remove these effects on sides of category model rails the cloudy effect"*.
      // ⚠️ The trade is deliberate and known: the tile at the edge now HARD-CLIPS. Do not
      // reintroduce a mask (or a painted gradient overlay — the flat canon bans new fills) as a
      // "fix" for that clipping; it is the requested appearance.
      /* ⚠️ role+label ON THE SCROLLER. A bare overflow-x div is an UNNAMED scrollable region:
         a screen-reader user arrives in a run of buttons with nothing saying what the run IS.
         `group`, not `toolbar` — these are filters, and toolbar semantics would also claim the
         arrow-key roving focus this rail does not implement. */
      role="group"
      aria-label={tr('Categories', 'Danh mục')}
      /* ⚠️ THE COLUMN WIDTH SUBTRACTS THE GAPS, AND THE FIRST VERSION DID NOT. `25%` × 4 columns is
         already the whole viewport, so three 8px gaps pushed the second pair of big tiles off the
         right edge and the snap points stopped landing on a screenful (measured: tiles at x=12 and
         x=213, width 193, in a 369px scroller). Four columns need `25% − 3/4 × gap`; eight need
         `12.5% − 7/8 × gap`. Two reviewers caught the arithmetic independently.
         ⚠️ THE SWITCH IS AT `md`, NOT `sm`, AND THAT IS A MEASUREMENT. Swept at 320 / 360 / 390 /
         430 / 480 / 600 / 639 / 640 / 768 / 1024 / 1280 / 1600 px after a reviewer pointed out only
         two widths had been checked: at `sm` (640px) the 8-column row makes a tile 64px wide and ONE
         LABEL CLIPS; at `md` (768px) the same tile is 80px and nothing clips at any width in the
         sweep. 640-767px therefore keeps the 4-column phone grid, which is 304px-wide tiles at 639px
         — generous, not broken. No width overflows the document.
         ⚠️ THE SNAP IS PER COLUMN, NOT PER PAGE, and that is deliberate — a third reviewer read the
         comment above as promising page snapping. Measured on a 390px phone: the scroller settles at
         187 / 374 / 468 / 561 and 561 IS the maximum scroll, so every tile is reachable and none is
         ever half-cut. Page-level snap points (0 / 374 / 748) would strand the last 187px of content
         behind an unreachable snap position, because `scrollWidth - clientWidth` is 561. */
      className={cn('grid grid-flow-col auto-cols-[calc(25%-0.375rem)] gap-x-2 gap-y-1 overflow-x-auto overscroll-x-contain scrollbar-none snap-x snap-mandatory py-1 md:grid-rows-2 md:auto-cols-[calc(12.5%-0.65625rem)] md:gap-x-3 md:gap-y-2', shortRail ? 'grid-rows-2' : 'grid-rows-6')}
    >
      {/* All */}
      <Button variant="bare" size="none" data-cat="all" aria-pressed={activeCategory === 'all'} onClick={() => onCategory('all')} className={cn('whitespace-normal', tileCls, spanAt(0))}>
        <span className={glyphBoxCls(0)}>
          {/* 'all' is a filter reset, not a category — it has no taxonomy row and no registry
              key (keys mirror DB Category.icon rows and are immutable). It has Solar artwork
              under that slug all the same, so it resolves like every other tile; the 'Layers'
              key is the lucide fallback that now never fires. */}
          {/* ⚠️ FILL IS THE SELECTION, NOT A STYLE (owner, 2026-08-07: "use icons filling only
              when selected, not as default"). Every glyph on this rail takes `selected` from the
              SAME boolean that already paints its label accent — `activeCategory === 'all'` here,
              `isActive` / `subActive` / the intent's `active` below. No new state was introduced:
              if the tile reads as chosen, its glyph fills; otherwise it is pure ink line. */}
          <CategoryTileGlyph slug="all" icon="Layers" className={cn(iconCls(activeCategory === 'all'), glyphSizeAt(0))} selected={activeCategory === 'all'} />
        </span>
        {/* ⛔ NO COUNT UNDER THE TILE NAME (owner, 2026-08-12: "remove counters under categories
            and brands"). It used to be a second line here and on every category tile below —
            `<span className="flex w-full flex-col items-center gap-0.5">` wrapping the name and a
            <CountChip>. The wrapper goes with it: a one-child flex column is not free, it is a
            line of markup claiming to arrange something.
            ⚠️ WHAT THE REMOVAL BUYS BACK IS A TEXT LINE ON THE TALLEST TILE, and the note that
            stood here spent twenty lines proving it cost one. The strip is `items-center`, so its
            height is the tallest tile; counts pushed single-line names to two.
            ⚠️ THE INLINE CHIP COUNTS INSIDE THE ROLLED-OUT PANELS STAY — "All 9", "Phones 3" — and
            that is the literal reading of the instruction, which is about the number UNDER a tile
            name. They read as part of the chip rather than as a second line, and they are what
            tells a visitor which subcategory is worth opening. */}
        <span className={nameCls(activeCategory === 'all')}>{tr('All', 'Tất cả')}</span>
      </Button>

      {/* eno's own products — see the `shortcuts` prop note. A plain <Button>, like every other
          tile here: <Button asChild><Link> CONCATENATES the child's className without
          tailwind-merge, so the base `inline-flex` would beat `flex flex-col` and the base
          `[&_svg:not([class*='size-'])]:size-4` would shrink the 44px glyph. */}
      {shortcuts?.map((sc, si) => (
        <Button key={sc.key} variant="bare" size="none" data-shortcut={sc.key} onClick={() => onShortcut?.(sc)} className={cn('whitespace-normal', tileCls, spanAt(1 + si))}>
          <span className={glyphBoxCls(1 + si)}>
            {/* ⚠️ `sc.art` COMES FROM THE ALIASED SERVICES MODULE, so on a marketplace build it is
                not merely falsy — the string never enters the artifact at all, and the file it
                names is pruned from that image by the Dockerfile. The lucide fallback is what a
                tile without artwork still gets.
                ⛔ AND IT TAKES `selected` LIKE EVERY OTHER TILE. The first version hardcoded grey,
                inheriting `iconCls(false)` from the lucide line it replaced — which was invisible
                while the glyph was a line icon and obvious the moment it became colour artwork:
                filtering to e-Visa lit every category tile blue and left the e-Visa tile itself
                grey, on the two tiles that exist to sell the service. A `kind: 'filter'` shortcut
                is active when the rail's own category and subcategory match its href. */}
            {sc.art ? (
              /* eslint-disable-next-line @next/next/no-img-element -- same reasoning as CategoryArt */
              <img src={sc.art} alt="" aria-hidden width={184} height={184} draggable={false}
                fetchPriority="low" decoding="async"
                className={cn('shrink-0 select-none object-contain transition-[filter] duration-200', !shortcutActive(sc) && 'grayscale', iconCls(shortcutActive(sc)), glyphSizeAt(1 + si))} />
            ) : (
              <CategoryIcon name={sc.icon} className={cn(iconCls(shortcutActive(sc)), glyphSizeAt(1 + si))} />
            )}
          </span>
          <span className="flex w-full flex-col items-center gap-0.5">
            <span className={nameCls(false)}><TileLabel text={lang === 'vi' ? sc.nameVi : sc.name} /></span>
          </span>
        </Button>
      ))}

      {categories.map((cat, ci) => {
        const isActive = activeCategory === cat.slug
        const at = 1 + shortcutCount + ci
        return (
          <Button key={cat.id} variant="bare" size="none" data-cat={cat.slug} aria-pressed={isActive} onClick={() => onCategory(isActive ? 'all' : cat.slug)} className={cn('whitespace-normal', tileCls, spanAt(at))}>
              <span className={glyphBoxCls(at)}>
                <CategoryTileGlyph slug={cat.slug} icon={cat.icon} className={cn(iconCls(isActive), glyphSizeAt(at))} selected={isActive} />
              </span>
              <span className={nameCls(isActive)}><TileLabel text={lang === 'vi' ? cat.nameVi : cat.name} /></span>
          </Button>
        )
      })}

      {/* Free / Wanted intent tiles — mirror the home grid so no shortcut goes missing
          in the results view. Separated from the categories by a hairline so it reads as
          a distinct "intent" group; each toggles the listingType filter. */}
      {intents && intents.length > 0 && (
        <>
          {/* ⚠️ NO VERTICAL HAIRLINE HERE ANY MORE: in the grid it would claim a whole column. The
              intent tiles simply follow the categories, as 58's grid runs its entries together. */}
          {/* ⚠️ `leadTiles + i`, NOT `leadTiles`. Every intent tile used to ask about the same index;
              it gives the right answer today only because all three sit past `bigCount`, so it was a
              latent trap rather than a bug — all three reviewers flagged it in the same round. */}
          {intents.map((s, i) => {
            const active = activeType === s.type
            return (
              <Button key={s.type} variant="bare" size="none" data-intent={s.type} onClick={() => onIntent?.(s.type)} className={cn('whitespace-normal', tileCls, spanAt(leadTiles + i))}>
                {/* Sized BY INDEX like every other tile, not by a hardcoded `h-11`: same answer
                    today (intents always sit past `bigCount`), but a reviewer was right that a
                    hardcoded box is the half of the pair that would not follow if that changed. */}
                <span className={glyphBoxCls(leadTiles + i)}>
                  <CategoryTileGlyph slug={s.type} icon={s.icon} className={cn(iconCls(active), glyphSizeAt(leadTiles + i))} selected={active} />
                </span>
                <span className={nameCls(active)}><TileLabel text={lang === 'vi' ? s.nameVi : s.name} /></span>
              </Button>
            )
          })}
        </>
      )}
    </div>
      <ScrollArrows canLeft={canLeft} canRight={canRight} page={page} arrowTop={arrowTop} tight />

      {/**
       * The active category's subcategories, under the grid (see the note where they are computed).
       *
       * ⚠️ NO ARROWS ON THIS SCROLLER, AND THAT IS MEASURED RATHER THAN OVERLOOKED. A reviewer's point
       * is real in principle — the chips used to be a child of the grid, so the grid's arrows moved
       * them, and below the grid they are their own overflow box. A second `useScrollArrows` was
       * written and then REMOVED: swept across all eight categories at 480 / 640 / 768 / 1024 /
       * 1280 px, not one overflows (the 3-row chip grid is at most ~650px wide), and the only width
       * that does overflow is a 390px phone — where `ScrollArrows` is hidden on purpose and the strip
       * is swiped. Arrows there would have been dead code at every width that renders them. If the
       * taxonomy grows a category past ~9 subcategories, re-measure and add them back.
       */}
      {subs.length > 0 && (
        /* `key` REMOUNTS THE SCROLLER PER CATEGORY. Inside the category's own Fragment it remounted
           for free; shared below the grid it kept the previous category's scrollLeft, so switching
           could open a panel already scrolled past "All" (a reviewer's catch). */
        <div key={activeCategory} className="mt-2 flex items-center gap-2 overflow-x-auto overscroll-x-contain scrollbar-none animate-in fade-in slide-in-from-top-1 duration-200">
          {/* 3×3 grid (column-fill): All first, the 7 most-used in between, More last — plus
              the active subcategory when its count ranked it below those 7 (see the promotion
              above). That is the one case that fills all 9 cells and pushes More alone into a
              4th column. */}
          <div className="grid grid-rows-3 grid-flow-col auto-cols-max gap-x-1.5 gap-y-0.5 rounded-2xl bg-brand-50 p-1.5">
            {/* "All" = this rail released, every other filter still applied — so it is
                legitimately larger than the chips beside it sum to (rows carrying no
                subcategorySlug come back when the rail is cleared). Never a sum. */}
            <Button variant="bare" size="none" aria-pressed={activeSubcategory === 'all'} onClick={() => onSubcategory('all')} className={cn('block', subChip(activeSubcategory === 'all'))}>
              {tr('All', 'Tất cả')}
              <CountChip pending={countsPending} count={subDim?.all} className="ml-1" />
            </Button>
            {visibleSubs.map((sub) => {
              const subActive = activeSubcategory === sub.slug
              const count = subCount(sub.slug)
              return (
                <Button key={sub.slug} variant="bare" size="none" data-subcat={sub.slug} aria-pressed={subActive} onClick={() => onSubcategory(subActive ? 'all' : sub.slug)} className={cn('block', subChip(subActive))}>
                  {/* At 14px the baked display stroke goes wispy — re-tier the ink
                      line to the UI weight (icon-language §2). */}
                  <CategoryIcon name={sub.icon} stroke={STROKE_UI} selected={subActive} className="mr-1 h-3.5 w-3.5 shrink-0 align-[-2px]" />
                  <Tr text={lang === 'vi' ? sub.nameVi : sub.name} />
                  <CountChip pending={countsPending} count={count} className="ml-1" />
                </Button>
              )
            })}
            {overflowSubs.length > 0 && (
              <MoreOverflow count={overflowSubs.length}>
                {overflowSubs.map((sub) => {
                  const subActive = activeSubcategory === sub.slug
                  const count = subCount(sub.slug)
                  return (
                    <Button
                      key={sub.slug}
                      variant="bare"
                      size="none"
                      data-subcat={sub.slug}
                      aria-pressed={subActive}
                      onClick={() => onSubcategory(subActive ? 'all' : sub.slug)}
                      className={cn('flex w-full justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left font-semibold transition-colors active:scale-100', subActive ? 'bg-accent text-accent-foreground' : 'text-body hover:bg-muted hover:text-accent-foreground')}
                    >
                      <span className="flex min-w-0 items-center gap-2"><CategoryIcon name={sub.icon} stroke={STROKE_UI} selected={subActive} className="h-4 w-4 shrink-0 text-ink-4" /><span className="truncate"><Tr text={lang === 'vi' ? sub.nameVi : sub.name} /></span></span>
                      <CountChip pending={countsPending} count={count} className="shrink-0" />
                    </Button>
                  )
                })}
              </MoreOverflow>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
