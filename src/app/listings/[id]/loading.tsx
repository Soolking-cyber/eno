import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Skeleton } from '@/components/ui/skeleton'

// Mirrors the listing detail layout so the skeleton → real swap causes no CLS.
export default function ListingLoading() {
  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 pt-4 pb-12">
        <Skeleton className="mb-5 h-5 w-40" />
        <div className="mb-4 space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-7 w-2/3 max-w-md" />
          <Skeleton className="h-4 w-40" />
        </div>

        {/* Gallery mosaic */}
        <div className="grid h-[300px] grid-cols-2 gap-2 overflow-hidden rounded-2xl sm:h-[440px]">
          <Skeleton className="h-full w-full rounded-none" />
          <div className="grid grid-cols-2 grid-rows-2 gap-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-full w-full rounded-none" />)}
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12">
          {/* LEFT */}
          <div className="lg:col-span-7 flex flex-col gap-6">
            <div className="space-y-2">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
            <Skeleton className="h-[260px] w-full rounded-2xl" />
          </div>
          {/* RIGHT sticky contact card */}
          <div className="lg:col-span-5">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
              <Skeleton className="h-9 w-40" />
              <Skeleton className="h-8 w-full rounded-lg" />
              <div className="flex gap-2.5">
                <Skeleton className="h-11 flex-1 rounded-full" />
                <Skeleton className="h-11 w-24 rounded-full" />
              </div>
              <div className="flex items-center gap-3 border-t border-slate-100 pt-4">
                <Skeleton className="h-11 w-11 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
}
