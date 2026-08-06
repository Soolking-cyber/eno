import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Skeleton } from '@/components/ui/skeleton'
import { ListingCardSkeleton } from '@/components/marketplace/listing-card-skeleton'

// Mirrors /c/[category]: breadcrumb → h-display title → measured lede →
// "By area" chip row → masthead hairline → sort strip + SellerListings grid →
// "Refine in full search" button → hairlined "Other categories" chip cloud.
// Same containers/margins as the real page.
export default function CategoryLoading() {
  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-6 pb-12">
        {/* Breadcrumb (text-sm → 20px line) */}
        <Skeleton className="mb-4 h-5 w-40" />

        {/* h-display title */}
        <Skeleton className="h-9 w-72 max-w-full" />

        {/* Measured lede (text-base leading-relaxed, max-w-prose, ~2 lines) */}
        <div className="mt-3 max-w-prose space-y-1.5">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>

        {/* "By area:" label + district chips (rounded-full px-3.5 py-1.5 text-xs → 28px) */}
        <div className="mt-6 flex flex-wrap gap-2">
          <Skeleton className="h-4 w-12 self-center" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-20 rounded-full" />
          ))}
        </div>

        {/* Masthead hairline — same full-bleed coupling as the page */}
        <div aria-hidden className="mt-8 -mx-3 border-t border-border sm:-mx-6 lg:-mx-8" />

        {/* Sort strip (44px tablist row) */}
        <Skeleton className="mt-6 h-10 w-80 max-w-full" />

        {/* Listings grid — mirrors SellerListings */}
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <ListingCardSkeleton key={i} />
          ))}
        </div>

        {/* "Refine in full search" button (px-5 py-2.5 text-sm → 40px) */}
        <div className="mt-8">
          <Skeleton className="h-10 w-48 rounded-xl" />
        </div>

        {/* Other categories */}
        <div className="mt-12 border-t border-border pt-8">
          <Skeleton className="h-6 w-40" />
          <div className="mt-4 flex flex-wrap gap-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-24 rounded-full" />
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
}
