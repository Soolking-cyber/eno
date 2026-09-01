import { redirect } from 'next/navigation'
import { dashboardTabTarget } from '@/lib/dashboard-redirect'

// MOVED into the Payments section (2026-09-01). Kept as a redirect so bookmarks, emails and the
// old `publishBlockedBody`-style deep links land on the right tab instead of 404ing. Incoming query
// params are carried through (dashboardTabTarget) so a deep link keeps whatever it arrived with.
export default async function PayoutRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  redirect(dashboardTabTarget('/dashboard/payments', 'payout', await searchParams))
}
