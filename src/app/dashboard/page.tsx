import { Suspense } from 'react'
import type { Metadata } from 'next'
import { getCurrentProfile } from '@/lib/admin'
import { db } from '@/lib/db'
import { Spinner } from '@/components/ui/spinner'
import { fetchForumVisaApplications } from '@/lib/forum-visa'
import type { ForumActivity } from './forum/forum-client'
import { loadForumActivity } from './forum/load-activity'
import { redirect } from 'next/navigation'
import type { SavedItinerary } from './trips/trip-card'
import { HomeClient } from './home-client'

export const metadata: Metadata = {
  title: 'Dashboard | eno.vn',
  robots: { index: false, follow: false },
}

// Per-user data read from the request cookie — never serve a prerendered shell.
export const dynamic = 'force-dynamic'

/** /dashboard is the dashboard HOME again (owner 2026-07-18): ONE dashboard for both eno
 *  properties, on the eno.forum card design. This server page loads the cross-property
 *  snapshots (forum activity, itineraries, visa) plus the seller-saves aggregate and
 *  hands them to HomeClient; the rest of the marketplace card reads the shared client
 *  store (same source as the nav rail).
 *  DashboardRedirect stays mounted only to honor legacy `?tab=` deep links. */

// Full itinerary rows for the home card — the SAME shape the /api/itineraries GET
// serializer ships (trip-card's SavedItinerary), because the canonical dashboard's
// itinerary rows EXPAND in place to day plans + stay shortlist on both properties
// (owner 2026-07-18), reusing TripCard. Filters mirror that route's GET (owner-scoped,
// non-archived, newest first); take 5 for the home.
async function loadTrips(profileId: string): Promise<SavedItinerary[] | null> {
  try {
    const rows = await db.itinerary.findMany({
      where: { profileId, status: { not: 'archived' } },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      include: {
        dayPlans: { orderBy: { dayNumber: 'asc' } },
        stays: { orderBy: { position: 'asc' } },
      },
    })
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      destinationId: r.destinationId,
      days: r.days,
      budgetId: r.budgetId,
      // Legacy rows may hold 'null'/non-array/bad JSON — always ship an array (the
      // API route carries the same guard).
      interests: ((): string[] => {
        try {
          const v = JSON.parse(r.interests) as unknown
          return Array.isArray(v) ? (v as string[]) : []
        } catch {
          return []
        }
      })(),
      status: r.status,
      estimatedBudget: r.estimatedBudget,
      currency: r.currency,
      updatedAt: r.updatedAt.toISOString(),
      dayPlans: r.dayPlans.map((d) => ({
        id: d.id,
        dayNumber: d.dayNumber,
        area: d.area,
        areaVi: d.areaVi,
        title: d.title,
        titleVi: d.titleVi,
        morning: d.morning,
        morningVi: d.morningVi,
        afternoon: d.afternoon,
        afternoonVi: d.afternoonVi,
        evening: d.evening,
        eveningVi: d.eveningVi,
      })),
      stays: r.stays.map((s) => ({
        id: s.id,
        position: s.position,
        name: s.name,
        nameVi: s.nameVi,
        area: s.area,
        areaVi: s.areaVi,
        note: s.note,
        noteVi: s.noteVi,
        estimatedNightly: s.estimatedNightly,
        currency: s.currency,
      })),
    }))
  } catch (error) {
    // P2021 = itinerary tables not migrated here — honest empty, like the API's 503 soft path.
    if ((error as { code?: string }).code === 'P2021') return []
    return null // anything else: the card renders its could-not-load body, never crashes the home
  }
}

// 'Saves on your listings' — the SERVER-side sum of the user's listings' savedCount.
// Deliberately NOT the device-local favorites count: that is a buyer metric that cannot
// cross origins; the canonical dashboard shows the SELLER's demand signal on both sites.
async function loadSaves(profileId: string): Promise<number | null> {
  try {
    const agg = await db.listing.aggregate({
      where: { seller: { ownerId: profileId } },
      _sum: { savedCount: true },
    })
    return agg._sum.savedCount ?? 0 // no storefront / no listings = an honest zero
  } catch {
    return null // fail-soft: the tile shows an em dash, never crashes the home
  }
}

async function HomeBody() {
  // Best-effort server loads: a missing session (auth race on a fresh sign-in) or a
  // failed source degrades to that card's empty/unavailable body. The signed-out VIEW
  // is owned by the client useAuth gate in HomeClient, exactly like the other sections.
  const profile = await getCurrentProfile().catch(() => null)
  if (!profile) return <HomeClient forum={null} trips={null} visa={{ state: 'signed-out' }} saves={null} />
  const [forum, trips, visa, saves] = await Promise.all([
    loadForumActivity(profile.id).catch((): ForumActivity | null => null),
    loadTrips(profile.id),
    // Cannot reject by contract (every path returns a state) — belt only.
    fetchForumVisaApplications().catch((): Awaited<ReturnType<typeof fetchForumVisaApplications>> => ({ state: 'unavailable' })),
    loadSaves(profile.id),
  ])
  return <HomeClient forum={forum} trips={trips} visa={visa} saves={saves} />
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
