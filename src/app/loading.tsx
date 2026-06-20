import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Skeleton } from '@/components/ui/skeleton'

// Instant skeleton shown while the homepage server component fetches — turns a
// frozen tab-tap into immediate visual feedback (and lets Next prefetch this shell).
export default function HomeLoading() {
  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 pt-4">
        {/* Hero */}
        <div className="flex flex-col items-center gap-3 py-8 sm:py-12">
          <Skeleton className="h-10 w-10 rounded-xl" />
          <Skeleton className="h-8 w-64 max-w-full" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="mt-2 h-12 w-full max-w-xl rounded-full" />
        </div>
        {/* Category row */}
        <div className="flex gap-3 overflow-hidden pb-4">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex shrink-0 flex-col items-center gap-2">
              <Skeleton className="h-14 w-14 rounded-2xl" />
              <Skeleton className="h-3 w-12" />
            </div>
          ))}
        </div>
        {/* Listings grid */}
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="aspect-[4/3] w-full rounded-2xl" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ))}
        </div>
      </main>
      <Footer />
    </div>
  )
}
