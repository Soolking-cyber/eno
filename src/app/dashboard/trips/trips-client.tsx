'use client'

import { useCallback, useEffect, useState, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw, Route } from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { SectionHeader } from '@/components/marketplace/section-header'
import { ItineraryBuilder } from './plan/itinerary-builder'
import { TripCard, type SavedItinerary } from './trip-card'

/** /dashboard/trips — the Itineraries section opens straight into the planner (owner
 *  2026-07-18: no list-first hop, no /plan sub-page), with the user's saved-itinerary
 *  HISTORY as a feed beneath the builder. Each saved item can be re-downloaded as a
 *  styled Word file. Data is eno.vn's own (Itinerary tables via /api/itineraries); a new
 *  build auto-saves and the feed refreshes in place via the builder's onSaved callback. */
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

  // The saved feed stays out of the way on first run (the builder's own empty state
  // already invites the first plan); it appears while loading, on error, or once there
  // is at least one saved itinerary.
  const showFeed = trips === null || failed || trips.length > 0

  return (
    <>
      {/* Native stack-nav title bar (mobile only) — same established title string. */}
      <SectionHeader title={tr('Itineraries', 'Lịch trình')} />
      {/* The planner opens directly (onSaved refreshes the history feed below). */}
      <ItineraryBuilder onSaved={load} />

      {showFeed && (
        <section aria-labelledby="saved-itineraries-title" className="mt-4 border-t border-border pt-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="saved-itineraries-title" className="text-xl font-bold text-foreground">
                {tr('Your saved itineraries', 'Lịch trình đã lưu')}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {tr('Every plan you build is saved here — expand one to review it or download the Word file.', 'Mỗi kế hoạch bạn tạo được lưu tại đây — mở rộng để xem lại hoặc tải tệp Word.')}
              </p>
            </div>
          </div>

          <div className="mt-5">
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
                {Array.from({ length: 2 }).map((_, i) => (
                  <Skeleton key={i} className="h-[76px] rounded-2xl" />
                ))}
              </div>
            ) : (
              <div className="space-y-2.5">
                {trips.map((trip) => (
                  <TripCard key={trip.id} trip={trip} />
                ))}
              </div>
            )}
          </div>
        </section>
      )}
    </>
  )
}
