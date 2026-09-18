import { redirect } from 'next/navigation'
import { dashboardTabTarget } from '@/lib/dashboard-redirect'

// MOVED into the Payments section (2026-09-01) — see the Payout redirect note. Query params carried
// through so a funding return or deep link keeps its arguments across the hop.
export default async function WalletRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  redirect(dashboardTabTarget('/dashboard/payments', 'wallet', await searchParams))
}
