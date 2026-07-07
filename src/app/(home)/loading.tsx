import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Skeleton } from '@/components/ui/skeleton'
import { ListingCardSkeleton } from '@/components/marketplace/listing-card-skeleton'

// Card width inside horizontal rails — one card == one feed-grid column
// (matches ForYouRail/BusinessRail/CategoryRails exactly).
const RAIL_CARD_W =
  'w-[calc((100%-0.5rem)/2)] shrink-0 snap-start sm:w-[calc((100%-2rem)/3)] lg:w-[calc((100%-3rem)/4)]'

// Instant skeleton shown while the homepage server component fetches — turns a
// frozen tab-tap into immediate visual feedback (and lets Next prefetch this shell).
// Mirrors ListingsExplorer's landing mode as it renders TODAY: hero (wordmark +
// eyebrow tagline + rounded-2xl search pill, max-w-4xl) → 2-row horizontally
// scrolling category-tile grid (15 categories + 2 intent tiles) → the For You +
// Outstanding-businesses rails (which SSR their own card skeletons) → the
// 2/3/4-col infinite feed grid. Kept structurally faithful to avoid layout shift.
export default function HomeLoading() {
  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-4">
        <section className="relative overflow-hidden pt-2 pb-5 sm:pt-3 sm:pb-8">
          <div className="relative w-full space-y-8 sm:space-y-12">

            {/* HERO SEARCH AREA */}
            <div className="pb-2 text-center">
              <div className="flex flex-col items-center justify-center mb-4 sm:mb-6">
                {/* Wordmark (h-14 sm:h-20, the SVG is 4:1) */}
                <Skeleton className="h-14 w-56 max-w-full mb-2 rounded-2xl sm:h-20 sm:w-80 sm:mb-4" />
                {/* Eyebrow tagline */}
                <Skeleton className="h-3 w-44 max-w-full" />
              </div>

              {/* Centered rounded-2xl search pill (icons py-2.5 sm:py-3 → 44/52px) */}
              <div className="relative max-w-4xl w-full mx-auto">
                <Skeleton className="h-11 w-full rounded-2xl sm:h-[52px]" />
              </div>
            </div>

            {/* CATEGORY GRID — two fixed rows of big tiles, horizontal scroll */}
            <div className="space-y-4">
              <div className="mx-auto grid w-fit max-w-full grid-rows-2 grid-flow-col auto-cols-[7rem] sm:auto-cols-[9rem] gap-x-4 gap-y-6 sm:gap-x-6 sm:gap-y-8 overflow-hidden px-3">
                {Array.from({ length: 17 }).map((_, i) => (
                  <div key={i} className="flex flex-col items-center justify-center gap-2 p-2">
                    <Skeleton className="h-11 w-11 rounded-xl sm:h-12 sm:w-12" />
                    <Skeleton className="h-4 w-16 sm:h-5" />
                    <Skeleton className="h-3 w-10 sm:h-3.5" />
                  </div>
                ))}
              </div>
            </div>

            {/* HORIZONTAL RAILS — For You + Outstanding businesses (each SSRs a
                header + a row of card skeletons; card width == one feed column) */}
            {Array.from({ length: 2 }).map((_, row) => (
              <section key={row} className="mb-7">
                <div className="mb-2.5 flex items-center gap-2">
                  <Skeleton className="h-4 w-4 rounded" />
                  <Skeleton className="h-5 w-36" />
                </div>
                <div className="flex gap-2 overflow-hidden snap-x sm:gap-4">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <ListingCardSkeleton key={i} className={RAIL_CARD_W} />
                  ))}
                </div>
              </section>
            ))}

            {/* INFINITE FEED GRID — first page is 12 cards */}
            <div className="grid grid-cols-2 gap-2 sm:gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 12 }).map((_, i) => (
                <ListingCardSkeleton key={i} />
              ))}
            </div>

          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
