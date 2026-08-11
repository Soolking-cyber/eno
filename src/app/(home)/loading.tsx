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
 *         ├ <WhyEno/>        122   / 108.3    (border-t + pt-8 + h-12 glyph band + label)
 *         ├ category grid    230   / 256      (2 rows × 103/112px tiles)
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
            <Skeleton className="min-h-[188px] w-full rounded-2xl sm:min-h-[212px] lg:min-h-[232px]" />

            {/* WHY eno — hairline + a row of five bare glyphs with a label under each.
                -mx-3/px-3 is COUPLED to the page frame's px-3, same as the real band. */}
            <div className="border-t border-border pt-8">
              <div className="-mx-3 flex gap-3 px-3 sm:mx-0 sm:gap-4 sm:px-0">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex w-24 shrink-0 flex-col items-center sm:w-auto sm:flex-1">
                    {/* h-12 band holds the row's vertical rhythm; the glyph itself is size-8 */}
                    <span className="flex h-12 shrink-0 items-center justify-center">
                      <Skeleton className="size-8 rounded-lg" />
                    </span>
                    <Skeleton className="mt-2 h-4 w-16 sm:h-[19px] sm:w-24" />
                    {/* The titles wrap to two lines on a phone and one line from sm up. */}
                    <Skeleton className="mt-0.5 h-4 w-12 sm:hidden" />
                  </div>
                ))}
              </div>
            </div>

            {/* CATEGORY GRID — two fixed rows, horizontally scrolled. 16 tiles:
                15 demand-ordered categories + the one intent tile (Free & Giveaways). */}
            <div className="space-y-4">
              <div className="relative">
                <div className="mx-auto grid w-fit max-w-full grid-rows-2 grid-flow-col auto-cols-[7rem] sm:auto-cols-[9rem] gap-x-4 gap-y-6 sm:gap-x-6 sm:gap-y-8 overflow-hidden px-3">
                  {Array.from({ length: 16 }).map((_, i) => (
                    <div key={i} className="flex flex-col items-center justify-center gap-2 p-2">
                      <Skeleton className="h-11 w-11 rounded-full sm:h-12 sm:w-12" />
                      {/* Label: text-sm/leading-tight on a phone, text-base from sm — two
                          lines either way, which is what sets the 103/112px tile height. */}
                      <div className="flex w-full flex-col items-center">
                        <Skeleton className="h-[17px] w-16 sm:h-5 sm:w-20" />
                        <Skeleton className="mt-0.5 h-[17px] w-10 sm:mt-0 sm:h-5 sm:w-12" />
                      </div>
                    </div>
                  ))}
                </div>
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
