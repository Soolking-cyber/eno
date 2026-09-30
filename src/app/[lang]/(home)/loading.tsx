import { Skeleton } from '@/components/ui/skeleton'
import { ListingCardSkeleton } from '@/components/marketplace/listing-card-skeleton'

/**
 * Instant skeleton for the home landing view — it stands in for <ListingsExplorer>'s
 * `isLandingMode` branch as it renders TODAY.
 *
 * ⛔ NO HEADER, `<main>`, H1 OR FOOTER HERE (SEO wave B, H1c; contract test). They render once, in
 * `(home)/layout.tsx`, above this boundary, and this skeleton sits inside that layout's `<main>` and on
 * its `home-wash` background (it used to draw its own `blob-bg` wrapper). Drawing them here again is the
 * duplicate header, `<main>` and search box every crawler used to get, and a search box whose typed
 * text the swap deleted.
 *
 * Real order, measured at 390px / 1280px (2026-08-07):
 *   section `pt-5 pb-5 sm:pt-6 sm:pb-8`
 *     ├ hero  — an sr-only <h1> only: ZERO height, so nothing is drawn for it here
 *     └ `space-y-8 sm:space-y-12`
 *         ├ <PromoBanner/>   189.5 / 232      (min-h-[188px] sm:212 lg:232, rounded-2xl)
 *         ├ category rail     ~86  / ~86      (ONE row of w-[4.75rem] tiles: 44px glyph + 2 lines)
 *         └ feed             header 28 + mb-3 + the 2/3/4-col grid
 *
 * ⚠️ THREE THINGS THIS FILE USED TO DRAW THAT THE PAGE DOES NOT HAVE, and they are the
 * reason it was ~150–190px too tall above the fold while being ~310px too short below:
 *   1. A wordmark + eyebrow + a max-w-4xl search pill. The hero wordmark was removed
 *      2026-08-03 and listings-explorer.tsx says in capitals that THE HERO SEARCH BAR IS
 *      GONE — IT LIVES IN THE HEADER NOW. Because this file rendered the real <Header/>,
 *      the old skeleton showed a real header search bar AND a fake hero pill at once.
 *   2. 17 category tiles ("15 categories + 2 intent tiles"). INTENT_SHORTCUTS was length 1 when
 *      that was written; it is 3 since 2026-08-16 (free, wanted, wholesale) and DESK_SHORTCUTS is
 *      [] on the marketplace edition — the live grid is 18 tiles.
 *   3. A third bar per tile for the listing count. The real tile renders that span only
 *      when `cat.verifiedCount >= 20`, and the intent tile never does.
 * And the tile icon is a BARE duotone <CategoryIcon> glyph — there is no tile chrome
 * behind it — so the placeholder is a soft glyph-sized mass, not a rounded box.
 *
 * ⚠️ NO PLACEHOLDER FOR THE THREE RAILS (For You · Outstanding businesses · the
 * per-category rails), DELIBERATELY. Each hides itself below MIN_RAIL_ITEMS = 3 and the
 * category rails additionally wait on /api/category-rails, so none of them is guaranteed
 * to paint at the moment this skeleton is replaced — measured on the live landing view,
 * none of them renders at all. Reserving ~350px per rail for something that may never
 * appear is the same mistake as the hero. If the rails ever become unconditional, add
 * them BETWEEN the category grid and the feed, in that order.
 *
 * ⛔ REWRITTEN 2026-09-30 (home fold trim, owner: "try a little from both categ and filter"). The body
 * below used to draw the PROMO BANNER and a one-row rail — the banner left the page on 2026-09-18 and the
 * rail became the six-unit-row tile grid — so this skeleton had not mirrored the page for twelve days.
 * It now draws what the undirected home renders TODAY, measured (headless, cold, 390×844 and 1440×900):
 *   section `pt-0 pb-5 sm:pt-2 sm:pb-8` → `space-y-3`
 *     ├ category rail   201 / 158   (phone: two opening rows of big tiles in 6 unit rows; md: 2 rows of 71px)
 *     ├ recents row      44 / 44    (`.recents-row`: shown only under html[data-has-recents], like the page)
 *     ├ sort strip       45 / 45    (one 44px row + hairline; a phone had 86 = facet row 44 + tab row 41 + hairline until the 2026-09-30 one-row try)
 *     └ feed            header 44 / 40, 12px, then the grid
 * First card top: 447 at 390×844 (406 since the 2026-09-30 phone one-row try), 367 at 1440×900. If listings-explorer.tsx or category-rail.tsx moves,
 * re-measure and move this with it — this file is half of the home page's CLS budget.
 * The notes above are the history of the earlier layouts and are kept for their reasoning.
 */
export default function HomeLoading() {
  return (
    <section className="relative overflow-hidden pt-0 pb-5 sm:pt-2 sm:pb-8">
      <div className="relative w-full space-y-3">

        {/* THE CATEGORY RAIL. Its height is the real grid's: six unit rows on a phone whose opening
            screen shows two rows of big tiles (60px glyph box), two rows of 71px tiles from md. The
            box carries the height explicitly because the swiped pages' smaller tiles, which set the
            real rows, are off-screen and not drawn here. */}
        <div className="h-[201px] overflow-hidden py-1 md:h-[158px]">
          <div className="grid h-full grid-flow-col grid-rows-2 auto-cols-max gap-x-2 gap-y-0.5 md:gap-x-3 md:gap-y-2">
            {Array.from({ length: 16 }).map((_, i) => (
              <div key={i} className="flex w-[calc((100vw-40px)/3)] flex-col items-center justify-center gap-1 md:w-[141px]">
                <Skeleton className="h-15 w-15 rounded-2xl md:h-12 md:w-12" />
                <Skeleton className="h-[15px] w-14" />
              </div>
            ))}
          </div>
        </div>

        {/* THE RETURNING VISITOR'S RECENTS ROW — the same `.recents-row` the page renders, so the
            pre-paint `data-has-recents` reservation holds in the skeleton too (display:none otherwise). */}
        <div aria-hidden="true" className="recents-row h-11" />

        {/* THE SORT STRIP — one 44px row at every width since the 2026-09-30 phone one-row try: on a phone
            the sort pill + facet pills + Good price share one scrolling line (the tab row is not drawn),
            from sm the facets sit left and the tabs right. (Before the try a phone had the facet row over
            a 41px tab row.) */}
        <div className="border-b border-border">
          <div className="flex flex-wrap items-center gap-x-4">
            <div className="flex h-11 basis-full items-center gap-2 overflow-hidden sm:flex-1 sm:basis-auto">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className={i === 4 ? 'h-5 w-20 shrink-0 sm:hidden' : 'h-5 w-20 shrink-0'} />
              ))}
            </div>
            <div className="hidden h-11 items-center gap-4 overflow-hidden sm:flex">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-5 w-16 shrink-0" />
              ))}
            </div>
          </div>
        </div>

        {/* THE FEED — the results header (title over the count on a phone, 44px; one 40px row from sm)
            over the first page of 12. */}
        <div>
          <div className="mb-3 flex h-11 items-center justify-between gap-2 sm:h-10">
            <div className="flex min-w-0 flex-col gap-0 sm:flex-row sm:items-center sm:gap-2">
              <Skeleton className="h-7 w-36" />
              <Skeleton className="h-4 w-24" />
            </div>
            <Skeleton className="h-8 w-36" />
          </div>
          {/* ⚠️ The rendered grid has THIRTEEN cells for a signed-out visitor —
              <CaptureCard/> is spliced in after the 8th listing and renders null once
              signed in. A server component cannot know which, so the reservation stays
              at the page size the server actually fetches (`take: 12`). */}
          <div className="grid grid-cols-2 gap-2 sm:gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <ListingCardSkeleton key={i} />
            ))}
          </div>
          {/* The landing's ONE ending: a full-width "Browse everything" button over a
              hairline, shown whenever there is more than one page. */}
          <div className="mt-6 border-t border-border pt-6">
            <Skeleton className="h-[46px] w-full rounded-xl" />
          </div>
        </div>

      </div>
    </section>
  )
}
