import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/admin'

// There is NO dedicated dashboard home (owner 2026-07-18): the rail's sections ARE the
// dashboard — visa on /dashboard/visa, trips on /dashboard/trips, the Help Center on
// /dashboard/help, and the marketplace stats live at the top of /dashboard/listings.
// This route only lands people somewhere sensible and resolves legacy ?tab= links.
export const dynamic = 'force-dynamic'

const TAB_TO_ROUTE: Record<string, string> = {
  listings: '/dashboard/listings',
  account: '/dashboard/settings',
  disputes: '/dashboard/disputes',
  // 'Forum activity' was removed 2026-07-21; the Help Center replaced it as the one
  // community surface, so a bookmarked ?tab=forum lands there instead of nowhere.
  forum: '/dashboard/help',
  trips: '/dashboard/trips',
  visa: '/dashboard/visa',
  dev: '/dashboard/dev',
  help: '/dashboard/help',
  post: '/post',
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams
  // Object.hasOwn: `?tab=toString`/`__proto__` must NOT resolve through the prototype chain.
  const route = tab && Object.hasOwn(TAB_TO_ROUTE, tab) ? TAB_TO_ROUTE[tab] : '/dashboard/listings'
  // redirect() throws NEXT_REDIRECT — keep it OUTSIDE any try/catch. A transient
  // profile-lookup failure must surface as an error, never masquerade as signed-out
  // (that produced a signin↔dashboard bounce loop once).
  const profile = await getCurrentProfile()
  if (!profile) redirect('/signin?next=' + encodeURIComponent(tab ? `/dashboard?tab=${tab}` : '/dashboard/listings'))
  redirect(route)
}
