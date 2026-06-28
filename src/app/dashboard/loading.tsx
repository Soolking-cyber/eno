import { Header } from '@/components/marketplace/header'

// Instant skeleton while the dashboard segment loads (no blank flash on nav).
export default function DashboardLoading() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 px-3 py-6 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 shrink-0 rounded-full shimmer" />
          <div className="space-y-1.5">
            <div className="h-5 w-40 rounded shimmer" />
            <div className="h-3 w-28 rounded shimmer" />
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-[72px] rounded-2xl shimmer" />)}
        </div>
        <div className="mt-8 space-y-2.5">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-[92px] rounded-2xl shimmer" />)}
        </div>
      </main>
    </div>
  )
}
