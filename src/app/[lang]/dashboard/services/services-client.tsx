'use client'

import { DashboardTabs } from '@/components/marketplace/dashboard-tabs'
import { useLanguage } from '@/context/language-context'
import { Skeleton } from '@/components/ui/skeleton'
import { TripsClient } from '../trips/trips-client'
import { VisaCasesClient } from '../visa/cases-client'

/**
 * ⚠️ REAL Suspense FALLBACK, not a bare boundary. ServicesBody (the server page) awaits two DB reads
 * on a force-dynamic route; without a fallback the reader stares at a BLANK screen for that window
 * (the deleted visa page had `fallback={<VisaCasesSkeleton/>}` for exactly this). It lives here, in
 * the client shell, so it can localise its status label — a server component cannot call `tr`.
 * Neutral shape (heading + tab strip + panel): the section defaults to Trips, so a visa-shaped
 * skeleton would mislead.
 */
export function ServicesFallback() {
  const { tr } = useLanguage()
  return (
    // ⚠️ `w-full`, matching the shell — NOT `max-w-3xl`. DashboardTabs no longer caps its panel, so a
    // capped fallback would make the wide e-Visa cases table jump width the instant it loads.
    <div className="w-full" role="status" aria-label={tr('Loading…', 'Đang tải…')}>
      <Skeleton className="h-7 w-40 rounded-lg max-lg:hidden" />
      <div className="mt-4 flex gap-2">
        <Skeleton className="h-9 w-24 rounded-full" />
        <Skeleton className="h-9 w-24 rounded-full" />
      </div>
      <Skeleton className="mt-4 h-40 w-full rounded-2xl" />
    </div>
  )
}

/** Trips first (the broader service); e-Visa cases behind it. Both mounted content-only. */
export function ServicesClient({ planListingId, threads }: {
  planListingId: string | null
  threads: Record<string, string>
}) {
  const { tr } = useLanguage()
  return (
    <DashboardTabs
      title={tr('Services', 'Dịch vụ')}
      fallbackHref="/dashboard/listings"
      tabs={[
        { value: 'trips', label: tr('My Trips', 'Chuyến đi'), content: <TripsClient planListingId={planListingId} embedded /> },
        { value: 'evisa', label: tr('e-Visa', 'E-Visa'), content: <VisaCasesClient threads={threads} embedded /> },
      ]}
    />
  )
}
