import { redirect } from 'next/navigation'
import { dashboardTabTarget } from '@/lib/dashboard-redirect'

// MOVED into the Settings section as a tab (2026-09-01). Redirect keeps the old /dev link working and
// carries any incoming query params onto the tab.
export default async function DevRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  redirect(dashboardTabTarget('/dashboard/settings', 'developers', await searchParams))
}
