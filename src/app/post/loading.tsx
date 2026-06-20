import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Skeleton } from '@/components/ui/skeleton'

// Skeleton for the post wizard while categories load.
export default function PostLoading() {
  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 sm:px-6 lg:px-8 pt-6 pb-12">
        <Skeleton className="h-8 w-56 max-w-full" />
        <Skeleton className="mt-2 h-4 w-72 max-w-full" />
        {/* category chips */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
        </div>
        <Skeleton className="mt-6 h-11 w-full rounded-full" />
      </main>
      <Footer />
    </div>
  )
}
