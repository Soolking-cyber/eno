import { redirect } from 'next/navigation'
import { dashboardTabTarget } from '@/lib/dashboard-redirect'

// MOVED into the Services section as a tab (2026-09-01). Detail routes /trips/[id] and /trips/plan
// are untouched; only this index redirects so old links land on the Trips tab. Incoming query params
// are preserved across the hop.
export default async function TripsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  redirect(dashboardTabTarget('/dashboard/services', 'trips', await searchParams))
}
