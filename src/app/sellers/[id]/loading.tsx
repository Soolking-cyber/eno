import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollToTop } from '@/components/marketplace/scroll-to-top'

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
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Skeleton className="h-7 w-56" />
              <Skeleton className="h-6 w-28 rounded-full" />
            </div>
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-full max-w-2xl" />
          </div>
        </div>

        {/* Trust stats */}
        <div className="mt-6 grid grid-cols-2 gap-4 rounded-2xl bg-card p-5 sm:grid-cols-4 shadow-pop">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2.5">
              <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
          ))}
        </div>

        {/* Listings by this seller */}
        <section className="mt-10 space-y-4">
          <Skeleton className="h-7 w-48" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="aspect-[4/3] w-full rounded-2xl" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ))}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
