import { Suspense } from 'react'
import type { Metadata } from 'next'
import { getCurrentProfile } from '@/lib/admin'
import { db } from '@/lib/db'
import { Spinner } from '@/components/ui/spinner'
import { fetchForumVisaApplications } from '@/lib/forum-visa'
import type { ForumActivity } from './forum/forum-client'
import { loadForumActivity } from './forum/load-activity'
import { redirect } from 'next/navigation'
import { HomeClient, type HomeTrip } from './home-client'

export const metadata: Metadata = {
  title: 'Dashboard | eno.vn',
  robots: { index: false, follow: false },
}

// Per-user data read from the request cookie — never serve a prerendered shell.
export const dynamic = 'force-dynamic'

/** /dashboard is the dashboard HOME again (owner 2026-07-18): ONE dashboard for both eno
 *  properties, on the eno.forum card design. This server page loads the cross-property
 *  snapshots (forum activity, itineraries, visa) and hands them to HomeClient; the
 *  marketplace card reads the shared client store instead (same source as the nav rail).
 *  DashboardRedirect stays mounted only to honor legacy `?tab=` deep links. */

// Compact itinerary rows for the home card (title · days · updated) — the FULL trips
// experience (expansion, day plans) stays on /dashboard/trips, which client-fetches
// /api/itineraries. Filters mirror that route's GET (owner-scoped, non-archived,
// newest first).
async function loadTrips(profileId: string): Promise<HomeTrip[] | null> {
  try {
    const rows = await db.itinerary.findMany({
      where: { profileId, status: { not: 'archived' } },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: { id: true, title: true, days: true, updatedAt: true },
    })
    return rows.map((r) => ({ id: r.id, title: r.title, days: r.days, updatedAt: r.updatedAt.toISOString() }))
  } catch (error) {
    // P2021 = itinerary tables not migrated here — honest empty, like the API's 503 soft path.
    if ((error as { code?: string }).code === 'P2021') return []
    return null // anything else: the card renders its could-not-load body, never crashes the home
  }
}

async function HomeBody() {
  // Best-effort server loads: a missing session (auth race on a fresh sign-in) or a
  // failed source degrades to that card's empty/unavailable body. The signed-out VIEW
  // is owned by the client useAuth gate in HomeClient, exactly like the other sections.
  const profile = await getCurrentProfile().catch(() => null)
  if (!profile) return <HomeClient forum={null} trips={null} visa={{ state: 'signed-out' }} />
  const [forum, trips, visa] = await Promise.all([
    loadForumActivity(profile.id).catch((): ForumActivity | null => null),
    loadTrips(profile.id),
    // Cannot reject by contract (every path returns a state) — belt only.
    fetchForumVisaApplications().catch((): Awaited<ReturnType<typeof fetchForumVisaApplications>> => ({ state: 'unavailable' })),
  ])
  return <HomeClient forum={forum} trips={trips} visa={visa} />
}

// Legacy `?tab=` deep links (notifications, old mobile nav) — resolved SERVER-side so a
// tabbed hit never pays for the home's data loads before bouncing.
const TAB_TO_ROUTE: Record<string, string> = {
  listings: '/dashboard/listings',
  account: '/dashboard/settings',
  disputes: '/dashboard/disputes',
  forum: '/dashboard/forum',
  trips: '/dashboard/trips',
  visa: '/dashboard/visa',
  dev: '/dashboard/dev',
  help: '/dashboard/help',
  post: '/post',
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams
  // Object.hasOwn: `?tab=toString`/`__proto__` must NOT resolve through the prototype
  // chain into a bogus redirect target.
  const route = tab && Object.hasOwn(TAB_TO_ROUTE, tab) ? TAB_TO_ROUTE[tab] : undefined
  if (route) {
    // redirect() throws NEXT_REDIRECT — it must stay OUTSIDE any try/catch. And a
    // TRANSIENT profile-lookup failure must surface as an error, not masquerade as
    // signed-out: catching here sent a signed-in browser into a signin↔dashboard
    // bounce loop until the lookup recovered.
    const profile = await getCurrentProfile()
    if (!profile) redirect('/signin?next=' + encodeURIComponent(`/dashboard?tab=${tab}`))
    redirect(route)
  }
  return (
    <Suspense
      fallback={
        <div role="status" className="flex min-h-[50vh] items-center justify-center">
          <Spinner size="lg" />
        </div>
      }
    >
      <HomeBody />
    </Suspense>
  )
}
