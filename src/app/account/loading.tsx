import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Skeleton } from '@/components/ui/skeleton'

// Account is force-dynamic (per-user fetch) — this skeleton fills the tap→render
// gap so the bottom-nav tap feels instant instead of frozen.
export default function AccountLoading() {
  return (
    <div className="flex min-h-screen flex-col bg-[#fafafa]">
      <Header />
      <main className="mx-auto w-full max-w-4xl flex-1 px-3 py-8 sm:px-6">
        {/* Identity header */}
        <div className="flex items-center gap-4">
          <Skeleton className="h-16 w-16 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-44 max-w-full" />
            <Skeleton className="h-4 w-52 max-w-full" />
          </div>
        </div>
        {/* Quick links */}
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-16 rounded-2xl" />
          <Skeleton className="h-16 rounded-2xl" />
        </div>
        {/* Listings section */}
        <Skeleton className="mt-10 h-6 w-40" />
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="aspect-[4/3] w-full rounded-2xl" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ))}
        </div>
      </main>
      <Footer />
    </div>
  )
}
