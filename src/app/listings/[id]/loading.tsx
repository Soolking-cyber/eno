import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Skeleton } from '@/components/ui/skeleton'

// Mirrors the listing detail layout so the skeleton → real swap causes no CLS.
// DOM/desktop order: breadcrumb → title header (share/save right) → mobile price
// → gallery (4:3 carousel <md, 2-col mosaic ≥md) → highlight chips; <lg the same
// flex `order-*` re-sequence as the page puts the gallery + price first. Then the
// 12-col grid with the flat sticky contact column (left rule, ContactComposer
// shapes) and the map in the left column's second row. Bottom padding reserves
// the mobile contact bar.
export default function ListingLoading() {
  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-4 pb-[calc(8.5rem+env(safe-area-inset-bottom))] lg:pb-12">
        <div className="flex flex-col">
        {/* Breadcrumb (text-sm → 20px line) */}
        <Skeleton className="order-1 mb-4 h-5 w-48 lg:order-none" />

        {/* Title header — title/location left, share+save right (desktop-only:
            mobile puts them on the gallery overlay, which needs no skeleton) */}
        <div className="order-4 mb-4 flex items-start justify-between gap-3 lg:order-none">
          <div className="min-w-0 flex-1 space-y-1.5">
            {/* h-title */}
            <Skeleton className="h-7 w-2/3 max-w-md" />
            {/* location · posted line (text-sm) */}
            <Skeleton className="h-5 w-56 max-w-full" />
          </div>
          <div className="mt-0.5 hidden shrink-0 items-center gap-2 lg:flex">
            <Skeleton className="h-9 w-9 rounded-full" />
            <Skeleton className="h-9 w-9 rounded-full" />
          </div>
        </div>

        {/* Price under the gallery — mobile only (text-2xl) */}
        <div className="order-3 mt-4 mb-4 lg:hidden">
          <Skeleton className="h-8 w-36" />
        </div>

        {/* Gallery — 4:3 carousel on mobile, 2-col mosaic ≥md */}
        <div className="order-2 lg:order-none">
          <Skeleton className="aspect-[4/3] w-full rounded-2xl md:hidden" />
          <div className="hidden h-[300px] grid-cols-2 gap-2 overflow-hidden rounded-2xl sm:h-[440px] md:grid">
            <Skeleton className="h-full w-full rounded-none" />
            <div className="grid grid-cols-2 grid-rows-2 gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-full w-full rounded-none" />
              ))}
            </div>
          </div>
        </div>

        {/* Highlight chips (rounded-full px-3 py-1.5 text-xs → 28px) */}
        <div className="order-6 flex flex-wrap items-center gap-2 lg:order-none lg:mt-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-20 rounded-full" />
          ))}
        </div>
        </div>

        {/* Content + sticky contact */}
        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-x-10">
          {/* LEFT (row 1): protections strip + description + details */}
          <div className="lg:col-span-7 flex flex-col gap-8">
            {/* ProtectionsRow trust strip (rounded-xl px-3.5 py-2.5 + h-5 icon) */}
            <Skeleton className="h-11 w-full rounded-xl" />
            <div className="space-y-2">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>

            {/* Details dl (rows: text-sm py-2.5 → 40px each) */}
            <div className="space-y-1">
              <Skeleton className="mb-2 h-6 w-24" />
              <div>
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between gap-4 py-2.5">
                    <Skeleton className="h-5 w-28" />
                    <Skeleton className="h-5 w-20" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* RIGHT: flat sticky contact column — left rule, no boxed card */}
          <div className="lg:col-span-5 lg:row-span-2">
            <div className="lg:sticky lg:top-24 space-y-5 lg:border-l lg:border-border/70 lg:pl-10">
              {/* Price — desktop copy (text-3xl) */}
              <Skeleton className="hidden h-9 w-40 lg:block" />

              {/* Seller card — avatar + name/trust chip + honest metrics strip, then
                  the twin Chat / View-shop buttons (matches <SellerCard variant=pdp>) */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-40 max-w-full" />
                    <Skeleton className="h-3 w-52 max-w-full" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Skeleton className="h-10 flex-1 rounded-xl" />
                  <Skeleton className="h-10 flex-1 rounded-xl" />
                </div>
              </div>

              {/* ContactComposer — offer chip, 2-row message box, send, footnote */}
              <div className="space-y-2">
                <Skeleton className="h-7 w-24 rounded-full" />
                <Skeleton className="h-[60px] w-full rounded-xl" />
                <Skeleton className="h-10 w-full rounded-xl" />
                <Skeleton className="mx-auto h-4 w-56" />
              </div>

              {/* Safe trading tips link */}
              <Skeleton className="h-4 w-32" />

              {/* Report row (right-aligned) */}
              <div className="flex items-center justify-end">
                <Skeleton className="h-4 w-14" />
              </div>
            </div>
          </div>

          {/* LEFT (row 2): map + safety note */}
          <div className="lg:col-span-7 flex flex-col gap-8">
            <div className="space-y-2">
              <Skeleton className="h-6 w-28" />
              <Skeleton className="h-[260px] w-full rounded-2xl" />
            </div>
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
}
