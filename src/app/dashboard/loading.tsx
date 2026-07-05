import { Header } from '@/components/marketplace/header'
import { Skeleton } from '@/components/ui/skeleton'

// Instant skeleton while the dashboard segment loads (no blank flash on nav).
// Mirrors DashboardClient's signed-in frame on its default (listings) tab:
// identity header (avatar · name+trust · email, actions right) → tab bar →
// stat-card strip → "My listings" section with the same 92px row placeholders
// the client itself shows while /api/dashboard resolves.
export default function DashboardLoading() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-3 py-6 sm:px-6 lg:px-8">
        {/* Identity header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {/* name (text-lg) + trust badge */}
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              {/* email (text-sm) */}
              <Skeleton className="mt-1 h-4 w-48" />
            </div>
          </div>
          {/* actions (sign out etc.) */}
          <Skeleton className="h-5 w-20" />
        </div>

        {/* Tab bar (px-3 py-2.5 text-sm + border-b-2 → ~42px) */}
        <div className="mt-5 flex flex-wrap items-center gap-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="px-3 py-2.5">
              <Skeleton className="h-5 w-14" />
            </div>
          ))}
        </div>

        {/* Stat cards (p-4 + h-10 icon → 72px) */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-2xl p-4">
              <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
              <div className="space-y-1">
                <Skeleton className="h-5 w-10" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
          ))}
        </div>

        {/* "My listings" section — heading + the client's own 92px row placeholders */}
        <section className="mt-8">
          <Skeleton className="h-6 w-32" />
          <div className="mt-4 space-y-2.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[92px] rounded-2xl" />
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
