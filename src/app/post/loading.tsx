import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Skeleton } from '@/components/ui/skeleton'

// Skeleton for the post wizard while categories load. Mirrors PostWizard's
// step-1 layout: progress block (back row + bar), heading, category grid,
// and a right-aligned pill button — so the swap has no layout shift.
export default function PostLoading() {
  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-2xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-6 pb-12">
        {/* Progress block */}
        <div className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-3 w-12" />
          </div>
          <Skeleton className="h-1.5 w-full rounded-full" />
        </div>

        {/* Step 1: heading + category grid */}
        <div className="space-y-4">
          <Skeleton className="h-8 w-56 max-w-full" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[104px] rounded-2xl" />
            ))}
          </div>
        </div>

        {/* Footer nav: right-aligned pill button */}
        <div className="mt-8 flex justify-end">
          <Skeleton className="h-11 w-32 rounded-full" />
        </div>
      </main>
      <Footer />
    </div>
  )
}
