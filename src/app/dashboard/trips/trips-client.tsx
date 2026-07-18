'use client'

import { useCallback, useEffect, useState, useRef, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { RefreshCw, Route } from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { SectionHeader } from '@/components/marketplace/section-header'
import { TripCard, type SavedItinerary } from './trip-card'

/** /dashboard/trips — saved itineraries as a full in-<main> dashboard section.
 *  The DATA is eno.vn's own (Itinerary tables via /api/itineraries, which accepts the
 *  cookie session when no bearer token is sent) — and since 2026-07-18 trip PLANNING
 *  is native too: the "Plan a new trip" CTA opens /dashboard/trips/plan, the ported
 *  itinerary builder, right inside this section (owner: no hop to eno.forum). The
 *  planner has no per-itinerary URL, so saved items keep expanding in place here. */
export function TripsClient() {
  const { user, loading } = useAuth()
  const { tr } = useLanguage()
  const router = useRouter()
  // Server-rendered (or previously fetched) data belongs to the account that loaded it.
  // A cross-tab sign-in can swap the session to ANOTHER user while this page sits open
  // (Supabase broadcasts auth changes across tabs). Refresh inside a transition and
  // HIDE the stale payload for its duration — account A's data must never render
  // under account B, not even while the refresh is in flight.
  const [switching, startSwitch] = useTransition()
  const lastUid = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (user?.id && lastUid.current && user.id !== lastUid.current) startSwitch(() => router.refresh())
    if (user?.id) lastUid.current = user.id
  }, [user?.id, router])


  const [trips, setTrips] = useState<SavedItinerary[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!loading && !user) router.replace('/signin?next=/dashboard/trips')
  }, [loading, user, router])

  const load = useCallback(() => {
    setTrips(null)
    setFailed(false)
    let alive = true
    fetch('/api/itineraries')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!alive) return
        if (Array.isArray(d.itineraries)) setTrips(d.itineraries)
        else setFailed(true)
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (user) return load()
  }, [user, load])

  if (loading || switching || !user) {
    return (
      <div role="status" className="flex min-h-[50vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <>
      {/* Native stack-nav title bar (mobile only) — same established title string. */}
      <SectionHeader title={tr('Itineraries', 'Lịch trình')} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {/* h1 stays for the outline; the SectionHeader carries the visible mobile title. */}
          <h1 className="text-xl font-bold text-foreground max-lg:sr-only">{tr('Itineraries', 'Lịch trình')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {tr('Trips you research with the eno planner, saved to your account.', 'Chuyến đi bạn nghiên cứu cùng công cụ lập lịch trình eno, lưu vào tài khoản của bạn.')}
          </p>
        </div>
        <PlanTripCta />
      </div>

      <div className="mt-6">
        {failed ? (
          <EmptyState
            icon={Route}
            title={tr('Itineraries could not be loaded.', 'Không thể tải lịch trình.')}
            action={
              <Button variant="outline" onClick={load}>
                <RefreshCw className="h-4 w-4" />
                {tr('Try again', 'Thử lại')}
              </Button>
            }
          />
        ) : trips === null ? (
          <div className="space-y-2.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[76px] rounded-2xl" />
            ))}
          </div>
        ) : trips.length === 0 ? (
          <EmptyState
            icon={Route}
            title={tr('No saved itinerary yet', 'Chưa có lịch trình đã lưu')}
            subtitle={tr('Plan your first trip and the finished plan appears here automatically.', 'Lên kế hoạch chuyến đi đầu tiên và kế hoạch hoàn tất sẽ tự động xuất hiện tại đây.')}
            action={<PlanTripCta />}
          />
        ) : (
          <div className="space-y-2.5">
            {trips.map((trip) => (
              <TripCard key={trip.id} trip={trip} />
            ))}
          </div>
        )}
      </div>
    </>
  )
}

/** Internal CTA — the planner is a native sub-page of this section (2026-07-18;
 *  it used to ride the goToForum SSO bridge to eno.forum/itinerary).
 *  No className on the asChild child — it would concatenate, not merge. */
function PlanTripCta() {
  const { tr } = useLanguage()
  return (
    <Button variant="cta" asChild>
      <Link href="/dashboard/trips/plan">{tr('Plan a new trip', 'Lên kế hoạch mới')}</Link>
    </Button>
  )
}
