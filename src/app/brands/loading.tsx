import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Skeleton } from '@/components/ui/skeleton'

// Structural mirror of /brands: title + intro + the 2/3/4/5-col logo-tile grid,
// so the skeleton swaps to content with zero layout shift.
export default function BrandsLoading() {
  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-6 pb-12">
        {/* Breadcrumb (text-sm → 20px line) */}
        <Skeleton className="mb-4 h-5 w-40" />
        {/* h1: h-display */}
        <Skeleton className="h-9 w-72 max-w-full" />
        {/* lede: mt-3 text-base leading-relaxed, max-w-prose */}
        <Skeleton className="mt-3 h-4 w-full max-w-md" />
        {/* Masthead hairline — same full-bleed coupling as the page */}
        <div aria-hidden className="mt-8 -mx-3 border-t border-border sm:-mx-6 lg:-mx-8" />
        <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 15 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-3 rounded-2xl border border-border px-4 py-6">
              {/* BrandLogo size=44 (square monotone mark) */}
              <Skeleton className="h-11 w-11 rounded-lg" />
              {/* name: text-sm (20px) · count: text-xs (16px) */}
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </main>
      <Footer />
    </div>
  )
}
