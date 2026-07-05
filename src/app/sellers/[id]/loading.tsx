import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollToTop } from '@/components/marketplace/scroll-to-top'
import { ListingCardSkeleton } from '@/components/marketplace/listing-card-skeleton'

// Mirrors /sellers/[id]: back link → avatar + name/badge/reviews/bio/report →
// FLAT trust-stat grid (no card, spacing only) → "Listings by" section with the
// in-catalog search bar + card grid. Same containers/margins as the real page.
export default function SellerLoading() {
  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <ScrollToTop />
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-4 pb-12">
        {/* Back link */}
        <div className="mb-5">
          <Skeleton className="h-5 w-32" />
        </div>

        {/* Seller header */}
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <Skeleton className="h-20 w-20 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            {/* h-title name + "Active account" badge */}
            <div className="flex flex-wrap items-center gap-2">
              <Skeleton className="h-7 w-48" />
              <Skeleton className="h-4 w-28" />
            </div>
            {/* review count (text-sm) */}
            <Skeleton className="mt-1 h-5 w-40" />
            {/* bio line */}
            <Skeleton className="mt-2 h-4 w-full max-w-2xl" />
            {/* report button (text-[11px]) */}
            <Skeleton className="mt-3 h-4 w-16" />
          </div>
        </div>

        {/* Trust stats — flat grid (no box): trust score · rating · member since */}
        <div className="mt-6 grid grid-cols-3 gap-x-4 gap-y-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2.5">
              <Skeleton className="h-4 w-4 shrink-0 rounded" />
              <div className="space-y-1">
                <Skeleton className="h-5 w-12" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
          ))}
        </div>

        {/* Listings by this seller — heading + searchable catalog */}
        <section className="mt-10 space-y-4">
          <Skeleton className="h-6 w-48" />
          <div className="space-y-4">
            {/* "Search this seller" bar (px-3 py-2 + text-sm → 36px) */}
            <Skeleton className="h-9 w-full rounded-xl" />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
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
