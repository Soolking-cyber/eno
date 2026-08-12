import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Skeleton } from '@/components/ui/skeleton'
import { ListingCardSkeleton } from '@/components/marketplace/listing-card-skeleton'

/**
 * Instant skeleton for the home landing view — it stands in for <ListingsExplorer>'s
 * `isLandingMode` branch as it renders TODAY, inside the real <Header/> and <Footer/>.
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
 *      GONE — IT LIVES IN THE HEADER NOW. Because this file renders the real <Header/>,
 *      the old skeleton showed a real header search bar AND a fake hero pill at once.
 *   2. 17 category tiles ("15 categories + 2 intent tiles"). INTENT_SHORTCUTS is length 1
 *      and DESK_SHORTCUTS is [] on the marketplace edition — the live grid is 16 tiles.
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
 */
export default function HomeLoading() {
  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-4">
        <section className="relative overflow-hidden pt-5 pb-5 sm:pt-6 sm:pb-8">
          <div className="relative w-full space-y-8 sm:space-y-12">

            {/* PROMO BANNER — the full-width carousel, first child of the landing container. */}
            {/* ⛔ THE lg HEIGHT IS COUPLED TO promo-banner.tsx AND THE TWO MOVE TOGETHER. The banner
                was capped from 300px to 232px at lg so the first grid row clears the fold at 1080p;
                this skeleton was not in that stream's allowlist, so for one commit it reserved 300px
                for a 232px banner — a 68px collapse on every cold desktop load, taking CLS from
                0.002 to roughly 0.14 on the one page deliberately tuned to 0.002. The banner's own
                comment names this file as the other half of the change. Either both move or neither. */}
            {/* ⚠️ THE SAME ASPECT LADDER AS THE REAL BANNER, and it has to move with it — the
                banner's own comment names this file as the other half. It is no longer a fixed
                188/212/232: the banner now matches a PRODUCT IMAGE's height, which is one feed
                column (aspect-square), so it is an aspect ratio of N·W/(W−(N−1)·gap) — 2.04 / 3.14
                / 4.16 at 2 / 3 / 4 columns. A skeleton on the old ladder would under-reserve by
                ~60px at desktop and hand this page back the CLS it paid 0.142 → 0.002 to lose. */}
            <Skeleton className="aspect-[2.04] min-h-[150px] w-full rounded-2xl sm:aspect-[3.14] lg:aspect-[4.16]" />

            {/* THE CATEGORY RAIL — ONE ROW, which is the whole point of the 2026-08-12 layout.
                ⚠️ THIS FILE IS HALF OF THE PAGE'S CLS BUDGET, so it had to change with the layout
                or it becomes the shift. It used to draw TWO blocks that no longer exist: the
                five-item "Why eno" band (~122px) and a 16-tile TWO-ROW category grid (~230px) —
                about 350px of skeleton that would now never fill, on the one page tuned to
                CLS 0.002.
                The real rail is a single horizontal strip of `w-[4.75rem]` tiles: a 44px glyph,
                gap-1.5, then a name that clamps to two lines (text-xs/leading-tight). Twelve are
                drawn because that is roughly what fits before the edge mask at desktop width; the
                strip is a scroller, so drawing too few costs nothing and too many costs nothing. */}
            <div className="relative">
              <div className="flex gap-4 overflow-hidden px-3">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="flex w-[4.75rem] shrink-0 flex-col items-center gap-1.5 py-1">
                    <Skeleton className="h-11 w-11 rounded-lg" />
                    <div className="flex w-full flex-col items-center gap-0.5">
                      <Skeleton className="h-[15px] w-14" />
                      <Skeleton className="h-[15px] w-9" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* THE FEED — "Latest listings" header (SECTION_HEADER_ROW + a text-lg
                SECTION_TITLE whose line box is 28px, not 24) over the first page of 12. */}
            <div>
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Skeleton className="h-4 w-4" />
                  <Skeleton className="h-7 w-36" />
                </div>
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
                  hairline, shown whenever there is more than one page. Measured 71px
                  including the rule and its pt-6 — without it the skeleton's footer sat ~95px
                  high and the whole page shortened as the real ending landed. */}
              <div className="mt-6 border-t border-border pt-6">
                <Skeleton className="h-[46px] w-full rounded-xl" />
              </div>
            </div>

          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
