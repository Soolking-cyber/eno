import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Skeleton } from '@/components/ui/skeleton'

// Mirrors the listing detail layout so the skeleton → real swap causes no CLS.
// Flat single-canvas page: flat sticky contact column (left rule, no boxed card),
// a single full-width CTA, grid-cols-12 with gap-8 lg:gap-10.
export default function ListingLoading() {
  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-4 pb-12">
        {/* Back link */}
        <Skeleton className="mb-5 h-5 w-40" />

        {/* Title header */}
        <div className="mb-4 space-y-1.5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-2/3 max-w-md" />
          <Skeleton className="h-4 w-40" />
        </div>

        {/* Gallery mosaic */}
        <div className="grid h-[300px] grid-cols-2 gap-2 overflow-hidden rounded-2xl sm:h-[440px]">
          <Skeleton className="h-full w-full rounded-none" />
          <div className="grid grid-cols-2 grid-rows-2 gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-full w-full rounded-none" />
            ))}
          </div>
        </div>

        {/* Content + sticky contact */}
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10">
          {/* LEFT: details */}
          <div className="lg:col-span-7 flex flex-col gap-8">
            {/* Description */}
            <div className="space-y-2">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>

            {/* Details dl */}
            <div className="space-y-1">
              <Skeleton className="mb-2 h-6 w-24" />
              <div>
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between gap-4 py-2.5">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                ))}
              </div>
            </div>

            {/* Location map */}
            <div className="space-y-2">
              <Skeleton className="h-6 w-28" />
              <Skeleton className="h-[260px] w-full rounded-2xl" />
            </div>

            {/* Safety note line */}
            <Skeleton className="h-4 w-3/4" />
          </div>

          {/* RIGHT: flat sticky contact column — left rule, no boxed card */}
          <div className="lg:col-span-5">
            <div className="lg:sticky lg:top-24 space-y-5 lg:border-l lg:border-border/70 lg:pl-10">
              {/* Price */}
              <Skeleton className="h-9 w-40" />

              {/* Verified pill */}
              <Skeleton className="h-8 w-full rounded-lg" />

              {/* Single full-width Message CTA */}
              <Skeleton className="h-11 w-full rounded-full" />

              {/* Seller row */}
              <div className="flex items-center gap-3 pt-4">
                <Skeleton className="h-11 w-11 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>

              {/* Posted / meta row */}
              <div className="flex items-center justify-between gap-3">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
}
