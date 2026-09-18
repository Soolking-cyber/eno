import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Skeleton } from '@/components/ui/skeleton'
import { ListingCardSkeleton, SAVED_SKELETON_COUNT } from '@/components/marketplace/listing-card-skeleton'

// Skeleton for the saved-listings page during the route transition. Mirrors the
// real page: h-title heading, count line, then the same card grid the page shows
// while its own favorites fetch resolves (ListingCardSkeleton — no reshaping).
// ⚠️ The card count is SHARED with saved/page.tsx's own pre-hydration skeleton
// (SAVED_SKELETON_COUNT). This file cannot know the favourites count — it renders on
// the server — but the page CAN once its effect has run, so the only honest contract
// is "these two agree until the real number is known". They were 8 and 2.
export default function SavedLoading() {
  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-6 pb-12">
        {/* h-title + count line — measured on the rendered page: the <h1> line box is
            24px (this said 28), the count paragraph is 20px. */}
        <Skeleton className="mb-1 h-6 w-40" />
        <Skeleton className="mb-6 h-5 w-28" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: SAVED_SKELETON_COUNT }).map((_, i) => (
            <ListingCardSkeleton key={i} />
          ))}
        </div>
      </main>
      <Footer />
    </div>
  )
}
