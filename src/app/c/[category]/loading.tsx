import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Skeleton } from '@/components/ui/skeleton'

export default function CategoryLoading() {
  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-6 pb-12">
        <Skeleton className="mb-4 h-4 w-48" />
        <Skeleton className="h-9 w-64 max-w-full" />
        <Skeleton className="mt-2 h-4 w-full max-w-xl" />
        {/* area chips */}
        <div className="mt-5 flex flex-wrap gap-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-7 w-20 rounded-full" />)}
        </div>
        {/* listings grid — mirrors SellerListings */}
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex flex-col h-full w-full">
              <Skeleton className="aspect-[4/3] w-full rounded-xl" />
              <div className="flex flex-1 flex-col gap-1 px-0.5 pt-2.5">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </main>
      <Footer />
    </div>
  )
}
