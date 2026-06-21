import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Skeleton } from '@/components/ui/skeleton'

// Instant skeleton shown while the homepage server component fetches — turns a
// frozen tab-tap into immediate visual feedback (and lets Next prefetch this shell).
// Mirrors ListingsExplorer's landing mode: hero (wide logo + tagline + rounded-full
// search pill) → "Browse by Category" 3/6-col flat icon grid → curated horizontal
// CardRow carousels. Kept structurally faithful to avoid layout shift on hydration.
export default function HomeLoading() {
  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-4">
        <section className="relative overflow-hidden py-5 sm:py-8">
          <div className="relative w-full space-y-12">

            {/* HERO SEARCH AREA */}
            <div className="pt-4 pb-2 sm:pt-10 text-center">
              <div className="flex flex-col items-center justify-center mb-6">
                {/* Wide logo (h-20 w-auto in the real page) */}
                <Skeleton className="h-20 w-52 max-w-full mb-4 rounded-2xl" />
                {/* Tagline (eyebrow) */}
                <Skeleton className="h-3.5 w-44 max-w-full" />
              </div>

              {/* Centered rounded-full search pill */}
              <div className="relative max-w-2xl w-full mx-auto">
                <Skeleton className="h-[52px] w-full rounded-full" />
              </div>
            </div>

            {/* CATEGORY GRID (3 cols mobile, 6 cols desktop — flat icon tiles) */}
            <div className="space-y-4">
              <div className="flex justify-center">
                <Skeleton className="h-3.5 w-40" />
              </div>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-3 sm:gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex flex-col items-center justify-center gap-2.5 p-4">
                    <Skeleton className="h-8 w-8 rounded-lg" />
                    <Skeleton className="h-3.5 w-16" />
                    <Skeleton className="h-2.5 w-10" />
                  </div>
                ))}
              </div>
            </div>

            {/* CURATED BROWSE ROWS (horizontal CardRow carousels) */}
            <div className="space-y-10">
              {Array.from({ length: 2 }).map((_, row) => (
                <div key={row} className="space-y-3">
                  {/* Row header: title + view-all/arrows */}
                  <div className="flex items-center justify-between gap-3">
                    <Skeleton className="h-5 w-48 max-w-[60%]" />
                    <div className="flex items-center gap-2 shrink-0">
                      <Skeleton className="h-4 w-16" />
                      <div className="hidden sm:flex items-center gap-1">
                        <Skeleton className="h-8 w-8 rounded-full" />
                        <Skeleton className="h-8 w-8 rounded-full" />
                      </div>
                    </div>
                  </div>
                  {/* Horizontal scroll of fixed-width cards */}
                  <div className="flex gap-4 overflow-hidden pb-1 -mx-1 px-1">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="w-[180px] sm:w-[220px] shrink-0 space-y-2">
                        <Skeleton className="aspect-[4/3] w-full rounded-xl" />
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-4 w-1/2" />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
