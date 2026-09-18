'use client'

import { useEffect, useRef } from 'react'
import { useLanguage, Tr, useTr } from '@/context/language-context'
import { detectContentLang } from '@/lib/detect-lang'
import { CategoryIcon } from './category-icons'
import { CategoryTileGlyph } from './category-art'
import { SUBCATEGORIES } from '@/lib/subcategories'
import { CountChip, optionCount, railDimension } from './count-chip'
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
  /** How many chips the plate will hold — read here because the hook's key needs it (see below) and
   *  `subs` itself is assembled further down, after the counts it renders with. */
  const subCount1 = categories.some((c) => c.slug === activeCategory) ? (SUBCATEGORIES[activeCategory] ?? []).length : 0
  /**
   * The chip plate's own arrows. ⚠️ `watch` IS REQUIRED: the scroller's box does not change when the
   * chips do — only its `scrollWidth` — so a ResizeObserver alone computes "no overflow" once and
   * never corrects (the hook's own note says so). Opening a category with more chips than the last
   * one is exactly that case, now that nothing is folded into a dropdown.
   * ⚠️ THE COUNTS ARE IN THE KEY TOO. Each chip carries a `<CountChip>`, so the plate gets WIDER the
   * moment the facet payload lands — without the box resizing. Watching the category alone left the
   * arrows deciding on the pre-count width (a reviewer's catch); `countsPending` flips exactly when
   * that width changes.
   * ⛔ AND THE CHIP COUNT, BECAUSE THE PLATE CAN MOUNT LATE. The scroller does not exist while
   * `categories` is empty (the home page's `getData()` catch, or a slow first payload), so the
   * effect that attaches the scroll listener finds a null ref and never runs again on its own — the
   * arrows would be dead for the whole visit (three reviewers, two rounds).
   */
  const { scrollerRef: subsRef, canLeft: subsLeft, canRight: subsRight, page: subsPage, arrowTop: subsArrowTop } =
    useScrollArrows<HTMLDivElement>({ watch: `${activeCategory}:${countsPending}:${lang}:${subCount1}` })

  // When a category is chosen, slide the rail so that category sits at the left edge
  // — the user immediately sees their pick with its subcategories rolled out beside it.
  useEffect(() => {
    // Only scroll when OPENING a category (bring it to the left). On close/clear
    // ('all') leave the scroll position untouched so the user keeps their place.
    if (activeCategory === 'all') return
    const container = railRef.current
    /* ⛔ A DATASET LOOKUP, NOT AN INTERPOLATED SELECTOR. `activeCategory` comes from `?category=` —
       a value carrying a quote or bracket makes `querySelector` throw SyntaxError, which in an
       effect takes the whole rail down with it (a reviewer's catch; the same pattern was here
       before and is fixed in both effects). */
    const el = ([...(container?.querySelectorAll('[data-cat]') ?? [])] as HTMLElement[])
      .find((n) => n.dataset.cat === activeCategory) ?? null
    if (!container || !el) return
    // Scroll ONLY this rail (see brand-rail): el.scrollIntoView would also scroll the
    // document horizontally and clip the whole results view. Move scrollLeft instead.
    const left = container.scrollLeft + (el.getBoundingClientRect().left - container.getBoundingClientRect().left)
    container.scrollTo({ left, behavior: scrollBehavior() })
    // ⚠️ `categories.length` FOR THE SAME REASON AS THE PLATE EFFECT BELOW: with a deep link into a
    // category, the tiles can mount AFTER this first runs (empty first payload), and without it the
    // rail never slides the chosen tile to the left edge (a reviewer's catch, applied to both).
  }, [activeCategory, categories.length])


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
  // (The dimension itself is no longer read here — the tiles carry no count since the owner removed
  // them in 2026-08-12 — but the reasoning above is why a held-over payload is safe on THIS rail.)

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
  // FUNCTION, which `??` does not catch. `subCount` clamps that to undefined rather than printing
  // a function into a chip. (It also fed a comparator until 2026-09-18, where a NaN would have made
  // the sort order implementation-defined; the sort is gone, the hardening stays.)
  const legacySubCount = (slug: string): number | undefined =>
    Object.hasOwn(subcategoryCounts, slug) ? subcategoryCounts[slug] : undefined
  const subCount = (slug: string): number | undefined => optionCount(subDim, slug) ?? legacySubCount(slug)

  /**
   * ⛔ THE CHIPS ARE IN TAXONOMY ORDER, WHICH IS WHERE THE HIERARCHY LIVES (owner, 2026-09-18: "make
   * rentals follow 58.com hierarchy"). They used to be sorted by listing count and then FROZEN per
   * category, because the plate cut to seven chips plus a "+N" dropdown and the cut had to fall on
   * the most-used ones. The plate shows every chip now, so there is no cut to rank for — and a rail
   * that reorders itself when the counts land is the defect that freezing existed to prevent
   * (owner, 2026-08-29: "it jumps to another place so annoying"). Taxonomy order cannot jump: it is
   * the same before and after the counts arrive, and it is the order src/lib/taxonomy.ts states, so
   * a grouping decision made there — homes, then stays, then commercial, then vehicles — is what
   * the visitor sees. The counts still ride along on each chip.
   */

  // `.press` (icon-language §8): the browse rail's tiles press with the same spring as the
  // home grid's — one tile, one feel, wherever the grid appears.
  /**
   * ⛔ A TWO-ROW SWIPEABLE GRID, NOT A ONE-ROW STRIP (owner, 2026-09-18, from the 58 study: "2 rows
   * of catogories rest reveal upon swipe", and on mobile "bigger … big top 4 categories rest reveal
   * in 3 rows"). 58's home opens on a paged icon grid and that is what this now is.
   *
   * ONE grid expresses both shapes, with no duplicated DOM and no JS breakpoint:
   *   mobile  — 3 rows, every tile one cell → 3 COLUMNS × 3 ROWS = 9 tiles per screen, the rest a
   *             swipe right (owner, 2026-09-18: "grid 3x3 not 2x2").
   *   sm+     — 2 rows, every tile one cell, so 8 COLUMNS × 2 ROWS = 16 tiles per screen; the rest
   *             are a swipe away. (Measured at 1280: 16 of the 18 tiles fully visible, 1.38 pages.
   *             An earlier version of this line said "8 per screen", which is the column count — a
   *             reviewer read it as the tile count, and the tile count is what a reader wants.)
   * `grid-flow-col` fills column by column, which is what makes the overflow horizontal.
   */
  // `h-full justify-center` so a tile FILLS its cell instead of sitting at the top of it — measured
  // when the cells were larger: without it a tile drew 93px of content inside a 134px cell and the
  // grid read as icons adrift in whitespace. Still true at 3×3, where a cell is ~85px tall.
  const tileCls = 'press group flex h-full w-full snap-start flex-col items-center justify-center gap-1.5 py-1 text-center cursor-pointer select-none'
  /**
   * ⛔ EVERY TILE IS ONE CELL SINCE 2026-09-18 — owner, looking at the 2×2 extra-large phone grid:
   * "mobile initial one … grid 3x3 not 2x2". So the shape is 3 rows × 3 columns on a phone (NINE
   * tiles on the first screen, the rest a swipe right) and 2 rows × 8 columns from `md` up. That
   * deletes the whole `col-span-2 row-span-3` / `row-span-2` span system this file carried, and with
   * it three defects its own review rounds had to chase: XL tiles had to come in even numbers, a
   * short rail stranded one tile beside four stretched-empty row tracks, and the tile count per
   * screen depended on which index a tile happened to land at. A uniform cell has none of those
   * cases — the only imperfection left is a part-filled LAST column, which is where the list ends.
   */
  /**
   * The BOX the glyph is centred in — 56px tall on a phone, 44px from `md`. ⚠️ The GLYPH itself is
   * `iconCls`' 44px at every width; the taller box is breathing room in a ~85px phone tile, not a
   * bigger icon (a reviewer read the old wording as a size claim).
   */
  const GLYPH_BOX = 'flex h-14 items-center justify-center md:h-11'
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

  /**
   * ⛔ THE SUBCATEGORY PLATE IS COMPUTED ONCE FOR THE ACTIVE CATEGORY AND RENDERED BELOW THE GRID.
   * It used to be spliced INTO the rail, to the right of the active tile — impossible now that the
   * tiles are a swipeable icon grid: a panel inside the grid becomes a grid cell and breaks the rows.
   *
   * ⛔ AND ONLY FOR A CATEGORY THIS EDITION ACTUALLY SHOWS. Inside the old `categories.map` that was
   * implicit; below the grid it has to be said, or `?category=<slug>` in the URL opens the chips for
   * a category belonging to the OTHER edition (three reviewers found this independently).
   */
  const subs = categories.some((c) => c.slug === activeCategory) ? SUBCATEGORIES[activeCategory] ?? [] : []

  const prevSub = useRef(activeSubcategory)
  /**
   * ⚠️ AND THE SELECTED CHIP HAS TO BE ON SCREEN, which stopped being free when the "+N" dropdown
   * went: the plate used to PROMOTE the active subcategory into its visible nine, so it could not be
   * out of sight. Now every chip is in one scrolling row, and a deep link like
   * `?category=electronics&subcategory=printers` opens the plate at scrollLeft 0 with the chosen
   * chip past the right edge — filtered results, and no visible sign of which chip did it (a
   * reviewer's catch). Same mechanism as the rail above: move `scrollLeft`, never `scrollIntoView`,
   * which would also scroll the document sideways.
   */
  useEffect(() => {
    const container = subsRef.current
    const cleared = prevSub.current !== 'all' && activeSubcategory === 'all'
    prevSub.current = activeSubcategory
    if (activeSubcategory === 'all') {
      // ⚠️ CLEARING SCROLLS BACK TO THE START — "All" is the FIRST chip, so releasing the filter from
      // a plate scrolled to its right-hand end lights a chip nobody can see (a reviewer's catch).
      // ⛔ ONLY ON THE CHANGE ITSELF, hence `prevSub`: this effect also runs when the counts land or
      // the language flips, and an unconditional reset would yank a plate the visitor had just
      // scrolled back to zero under their finger (the same reviewer, the round after).
      if (cleared && container && container.scrollLeft > 0) container.scrollTo({ left: 0, behavior: scrollBehavior() })
      return
    }
    const el = ([...(container?.querySelectorAll('[data-subcat]') ?? [])] as HTMLElement[])
      .find((n) => n.dataset.subcat === activeSubcategory) ?? null
    if (!container || !el) return
    const elLeft = el.getBoundingClientRect().left - container.getBoundingClientRect().left
    const elRight = elLeft + el.offsetWidth
    // Only move when it is actually outside the box — an already-visible chip must not jump.
    if (elLeft >= 0 && elRight <= container.clientWidth) return
    container.scrollTo({ left: container.scrollLeft + elLeft - 12, behavior: scrollBehavior() })
    // ⚠️ `countsPending` IS A DEPENDENCY, NOT NOISE: every chip grows a `<CountChip>` when the facet
    // payload lands, so the row re-flows and a chip that was just brought into view can be pushed
    // back out of it (a reviewer's catch). Re-checking on that flip costs one measurement.
    // ⚠️ `lang` TOO: the chip labels are Vietnamese or English, the widths differ, and a switch
    // re-flows the row under the same selection (a reviewer's catch).
    // ⚠️ `subs.length` IS A DEPENDENCY BECAUSE THE PLATE CAN ARRIVE LATE: with `categories: []` on
    // first paint there is no plate at all, and when the categories land the chips mount without any
    // of the other dependencies changing (a reviewer's catch).
  }, [activeCategory, activeSubcategory, countsPending, lang, subs.length])

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
      /* ⚠️ THE COLUMN WIDTH SUBTRACTS ITS SHARE OF THE GAPS, AND THE FIRST VERSION DID NOT. Three
         columns at a bare `33.333%` are already the whole viewport, so the two 8px gaps push the
         third column off screen; `calc(33.333% - 0.3333rem)` is `33.333% − 2/3 × gap`, and the
         desktop row's `calc(12.5% - 0.65625rem)` is `12.5% − 7/8 × gap`. Two reviewers caught the
         arithmetic when this was a four-column grid; the rule survives the shape change.
         ⚠️ THE SNAP IS PER COLUMN, NOT PER PAGE, and that is deliberate. Re-measured on a 390px
         phone after the 3×3 change: the scroller settles at 125 / 374 / 499, and 499 IS the maximum
         scroll (the last tile's right edge lands exactly on the rail's), so every tile is reachable
         and none is ever half-cut. Page-level snap points would strand the tail behind a position
         the scroller cannot reach. */
      className="grid grid-flow-col grid-rows-3 auto-cols-[calc(33.333%-0.3333rem)] gap-x-2 gap-y-1 overflow-x-auto overscroll-x-contain scrollbar-none snap-x snap-mandatory py-1 md:grid-rows-2 md:auto-cols-[calc(12.5%-0.65625rem)] md:gap-x-3 md:gap-y-2"
    >
      {/* ⛔ NO "ALL" TILE (owner, 2026-09-18: "remove All category from both desktop and mobile").
          Clearing a category is still one tap — a category tile is a TOGGLE, `onCategory(isActive ?
          'all' : cat.slug)` — and `activeCategory === 'all'` remains the unfiltered state everywhere
          else; only its tile is gone. The subcategory plate keeps its own "All" chip, which resets
          the SUB filter and is a different control. */}
      {/* eno's own products — see the `shortcuts` prop note. A plain <Button>, like every other
          tile here: <Button asChild><Link> CONCATENATES the child's className without
          tailwind-merge, so the base `inline-flex` would beat `flex flex-col` and the base
          `[&_svg:not([class*='size-'])]:size-4` would shrink the 44px glyph. */}
      {shortcuts?.map((sc) => (
        <Button key={sc.key} variant="bare" size="none" data-shortcut={sc.key} onClick={() => onShortcut?.(sc)} className={cn('whitespace-normal', tileCls)}>
          <span className={GLYPH_BOX}>
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
                className={cn('shrink-0 select-none object-contain transition-[filter] duration-200', !shortcutActive(sc) && 'grayscale', iconCls(shortcutActive(sc)))} />
            ) : (
              <CategoryIcon name={sc.icon} className={iconCls(shortcutActive(sc))} />
            )}
          </span>
          <span className="flex w-full flex-col items-center gap-0.5">
            <span className={nameCls(false)}><TileLabel text={lang === 'vi' ? sc.nameVi : sc.name} /></span>
          </span>
        </Button>
      ))}

      {categories.map((cat) => {
        const isActive = activeCategory === cat.slug
        return (
          <Button key={cat.id} variant="bare" size="none" data-cat={cat.slug} aria-pressed={isActive} onClick={() => onCategory(isActive ? 'all' : cat.slug)} className={cn('whitespace-normal', tileCls)}>
              <span className={GLYPH_BOX}>
                <CategoryTileGlyph slug={cat.slug} icon={cat.icon} className={cn(iconCls(isActive))} selected={isActive} />
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
          {intents.map((s) => {
            const active = activeType === s.type
            return (
              <Button key={s.type} variant="bare" size="none" data-intent={s.type} onClick={() => onIntent?.(s.type)} className={cn('whitespace-normal', tileCls)}>
                {/* Sized BY INDEX like every other tile, not by a hardcoded `h-11`: same answer
                    today (intents always sit past `bigCount`), but a reviewer was right that a
                    hardcoded box is the half of the pair that would not follow if that changed. */}
                <span className={GLYPH_BOX}>
                  <CategoryTileGlyph slug={s.type} icon={s.icon} className={cn(iconCls(active))} selected={active} />
                </span>
                <span className={nameCls(active)}><TileLabel text={lang === 'vi' ? s.nameVi : s.name} /></span>
              </Button>
            )
          })}
        </>
      )}
    </div>
      <ScrollArrows canLeft={canLeft} canRight={canRight} page={page} arrowTop={arrowTop} tight />

      {/* The active category's subcategories — a full plate, and it scrolls like the grid above it
          (owner, 2026-09-18: "make the subcategory plate fully no dropdown similar to category one
          if overflow swipe to the right"). The arrows are the same `ScrollArrows` the grid uses, so
          a pointer user has the same affordance in both rows; on touch it is a swipe. */}
      {subs.length > 0 && (
        <div className="relative">
          {/* `key` REMOUNTS THE SCROLLER PER CATEGORY: shared below the grid it otherwise keeps the
              previous category's scrollLeft, and opens already scrolled past the first chips. */}
          <div ref={subsRef} key={activeCategory} className="mt-2 flex items-center gap-2 overflow-x-auto overscroll-x-contain scrollbar-none animate-in fade-in slide-in-from-top-1 duration-200">
          {/* A 3-row plate, column-filled: "All" first, then every subcategory in taxonomy order.
              It used to cut at seven chips plus a "+N" dropdown; it holds all of them now and the
              row scrolls instead. */}
          <div className="grid grid-rows-3 grid-flow-col auto-cols-max gap-x-1.5 gap-y-0.5 rounded-2xl bg-brand-50 p-1.5">
            {/* "All" = this rail released, every other filter still applied — so it is
                legitimately larger than the chips beside it sum to (rows carrying no
                subcategorySlug come back when the rail is cleared). Never a sum. */}
            <Button variant="bare" size="none" aria-pressed={activeSubcategory === 'all'} onClick={() => onSubcategory('all')} className={cn('block', subChip(activeSubcategory === 'all'))}>
              {tr('All', 'Tất cả')}
              <CountChip pending={countsPending} count={subDim?.all} className="ml-1" />
            </Button>
            {/* ⛔ NO "MORE" DROPDOWN SINCE 2026-09-18 (owner: "make the subcategory plate fully no
                dropdown similar to category one if overflow swipe to the right"). Every
                subcategory is a chip in the plate; when they outgrow the width the plate scrolls
                sideways exactly like the category grid above it, with the same arrows on a pointer
                device. That deletes the promote-the-active-chip machinery this file carried: with
                nothing hidden, a selected chip can no longer be folded away inside a +N badge. */}
            {subs.map((sub) => {
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
          </div>
          </div>
          <ScrollArrows canLeft={subsLeft} canRight={subsRight} page={subsPage} arrowTop={subsArrowTop} tight />
        </div>
      )}
    </div>
  )
}
