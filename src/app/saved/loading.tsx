import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Skeleton } from '@/components/ui/skeleton'
import { ListingCardSkeleton } from '@/components/marketplace/listing-card-skeleton'

// Skeleton for the saved-listings page during the route transition. Mirrors the
// real page: h-title heading, count line, then the same card grid the page shows
// while its own favorites fetch resolves (ListingCardSkeleton — no reshaping).
export default function SavedLoading() {
  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-6 pb-12">
        {/* h-title (≈28px) + count line (text-sm → 20px) */}
        <Skeleton className="mb-1 h-7 w-40" />
        <Skeleton className="mb-6 h-5 w-28" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <ListingCardSkeleton key={i} />
          ))}
        </div>
      </main>
      <Footer />
    </div>
  )
}
