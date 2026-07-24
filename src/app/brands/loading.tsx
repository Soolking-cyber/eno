import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Skeleton } from '@/components/ui/skeleton'

// Structural mirror of /brands: title + intro + the 2/3/4/5-col logo-tile grid,
// so the skeleton swaps to content with zero layout shift.
export default function BrandsLoading() {
  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-10 pb-16">
        {/* h1: text-2xl sm:text-3xl */}
        <Skeleton className="h-8 w-64 max-w-full sm:h-9" />
        {/* intro: mt-2 text-sm (20px line), max-w-2xl */}
        <Skeleton className="mt-2 h-5 w-full max-w-md" />
        <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 15 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-3 rounded-2xl bg-tint px-4 py-6">
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
